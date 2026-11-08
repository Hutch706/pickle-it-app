/* Pickle It: the rules of the Add flow (S4b-1; spec v1-scope 4.5 AC 11, 4.6, 4.7 AC 3 and 12, 4.13, 4.16; data-model 2.3a-2.3d, 7.2, 7.5).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in), no network. Loads in the browser as the global `Setup` (after
   due.js, starters.js and tasks-form.js) and in Node via require(). The screen (setup-screen.js) keeps a draft; plan() turns the draft into the
   records that one commit() writes. Nothing here saves anything: the record builders (makeThing / makeTask / makeLog) come in as `deps`, so the
   jar rules stay enforced in one place (data.js). Tested in tests/s4b1-check.mjs.

   S4b-2 adds Home: a draft may carry a kind, its types and an hour meter reading, a starter row may repeat by hours, and buildThing() turns one draft
   into one thing (plan() = the checks + buildThing for the one-thing jars). The Home queue (picks, quantity, names, pages) is in setup-home.js.
   Extension point for S4b-3 (first-run picker): start the Add flow with a jar. */
(function (root) {
  "use strict";
  const req = typeof module !== "undefined" && module.exports;
  const D = req ? require("./due.js") : root.Due, ST = req ? require("./starters.js") : root.Starters, TF = req ? require("./tasks-form.js") : root.TaskForm;
  const JAR_LABEL = { vehicles: "Vehicles", home: "Home", health: "Health", finance: "Finance" };
  // The jars the Add flow offers.
  const ADD_JARS = [
    { key: "vehicles", label: "Vehicles", blurb: "Oil changes, tires, registration.", empty: "Vehicle" },
    { key: "home", label: "Home", blurb: "Your house, appliances, mowers and other small engines.", empty: "House" },
    { key: "health", label: "Health", blurb: "Check-ups and renewals for you and your family.", empty: "Person" },
    { key: "finance", label: "Finance", blurb: "Tax dates, insurance and other money deadlines.", empty: "Household" },
  ];
  // Place icons (4.5 AC 11): Finance offers four, starting on House. Vehicles and Health have no picker.
  const ICON_CHOICES = { home: [["house", "House"], ["apartment", "Apartment"], ["land", "Land"]], finance: [["house", "House"], ["apartment", "Apartment"], ["land", "Land"], ["account", "Account"]] };
  const DEFAULT_NAME = { home: "Home", health: "Me", finance: "Household" }; // the first thing in a jar (4.6 AC 1)
  const STEPS = ["jar", "thing", "tasks", "confirm"];
  const MAX_ODO = 9999999;
  // Does a Home thing of this kind have an hour meter field? Every mower; a generator once Gas is chosen (an electric one has no hours task, mockup H14c).
  const hasMeter = (kind, types = []) => kind === "mower" || (kind === "generator" && types[0] === "gas");

  const clean = TF.clean;
  // Name length (4.16): user-perceived characters, counted as Unicode code points, the same unit data.js cleanText cuts at. shortcut: a grapheme cluster (a flag, a family emoji) counts as several; none is split on cut because a name over 80 is refused, never cut.
  const len = (s) => Array.from(s).length;
  const key = (s) => clean(s).toLowerCase();
  const num = (n) => Number(n).toLocaleString("en-US");
  const iso = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayText = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8)}, ${d.slice(0, 4)}`;
  const monthDay = (md) => `${MON[+md.slice(0, 2) - 1]} ${+md.slice(3)}`;

  // ---------- the draft ----------
  // A starter row: what the library says (orig), and what the person typed (every field is text, as in tasks-form.js).
  // kind: "miles" (a miles rule, maybe with months), "time" (counts from the last Done) or "date" (a fixed date each year).
  function starterRow(t) {
    const tm = t.time, kind = t.miles ? "miles" : t.hours ? "hours" : tm && tm.from === "calendar" ? "date" : "time";
    const months = tm && tm.from === "done" ? String(tm.unit === "year" ? tm.n * 12 : tm.n) : "";
    const unit = tm && tm.from === "done" ? (tm.unit === "year" ? "month" : tm.unit) : "month";
    return { key: "s" + t.id, id: t.id, custom: false, checked: !!t.default, open: false, kind, name: t.name,
      everyMiles: t.miles ? String(t.miles.every) : "", everyHours: t.hours ? String(t.hours.every) : "", months, unit, lastMiles: "", lastHours: "", lastDate: "", nextDate: "", notSure: false,
      remindMiles: t.miles ? String(t.miles.remind) : "", remindHours: t.hours ? String(t.hours.remind) : "", rt: { miles: false, hours: false },
      orig: { remindMiles: t.miles ? String(t.miles.remind) : "", remindHours: t.hours ? String(t.hours.remind) : "", name: t.name, everyMiles: t.miles ? String(t.miles.every) : "", everyHours: t.hours ? String(t.hours.every) : "", months, n: tm ? tm.n : null, unit: tm ? tm.unit : null, hasMonthDay: !!(tm && tm.monthDay), monthDay: (tm && tm.monthDay) || "",
        hasTime: !!tm, pause: t.notSure === "pause" } };
  }
  function customRow(k, jar) {
    return { key: "c" + k, id: "", custom: true, checked: true, open: true, kind: jar === "vehicles" ? "miles" : "time", name: "", everyMiles: "", everyHours: "", months: "", unit: "month", lastMiles: "", lastHours: "", lastDate: "", nextDate: "", notSure: false, remindMiles: "", remindHours: "", rt: { miles: false, hours: false }, orig: null };
  }
  // ctx.existing = the things already saved ({ jar, name }), used only to pick the first free default name.
  // ctx.kind / ctx.types: a Home appliance or engine page (setup-home.js). Its name is typed or left to the queue (d.queued): the name is not checked here.
  function newDraft(jar, ctx = {}) {
    const taken = (n) => (ctx.existing || []).some((v) => v.jar === jar && key(v.name) === key(n));
    const first = DEFAULT_NAME[jar] && !taken(DEFAULT_NAME[jar]) ? DEFAULT_NAME[jar] : "";
    const kind = ctx.kind || null, types = (ctx.types || []).slice(), meter = hasMeter(kind, types);
    const d = { jar, kind, types, hourMeter: meter, hours: "", queued: !!ctx.queued, name: ctx.queued ? "" : first, icon: (ICON_CHOICES[jar] || [])[0]?.[0] || "", odometer: "",
      rows: ST.starterList(jar, kind, types, { hourMeter: meter }).map(starterRow), stash: {}, nextCustom: 1 };
    d.base = snapshot(d);
    return d;
  }
  // The type dropdowns changed: the list is refilled. A task that stays keeps what was typed on it; one that goes is kept aside and comes back if the type does.
  function setTypes(d, types) {
    d.types = types.slice(); d.hourMeter = hasMeter(d.kind, d.types);
    for (const r of d.rows) if (!r.custom) d.stash[r.id] = r;
    const fresh = ST.starterList(d.jar, d.kind, d.types, { hourMeter: d.hourMeter }).map(starterRow);
    d.rows = [...fresh.map((f) => (d.stash[f.id] && d.stash[f.id].kind === f.kind ? d.stash[f.id] : f)), ...d.rows.filter((r) => r.custom)];
    return d;
  }
  function addCustom(d) { d.rows.push(customRow(d.nextCustom++, d.jar)); return d.rows[d.rows.length - 1]; }
  const snapshot = (d) => JSON.stringify([d.name, d.icon, d.odometer, d.hours, d.types, d.rows.map((r) => [r.checked, r.name, r.everyMiles, r.everyHours, r.months, r.lastMiles, r.lastHours, r.remindMiles, r.remindHours, r.lastDate, r.nextDate, r.notSure])]);
  // Has anything been typed or changed since the draft was made? (The jar pick itself is not a change.)
  const isDirty = (d) => snapshot(d) !== d.base;
  const stepPercent = (i) => Math.round((i / (STEPS.length - 1)) * 100); // 0% on the first page, 100% on the confirm page (4.7 AC 10)

  // Remind follows Every until the person types in it (4.20 AC 6). A starter row keeps its library Remind, capped at Every; a custom row follows the capped
  // default (Due.defaultRemind). Returns the meters whose Remind just changed to a number, for the "Remind changed to N." announcement.
  function followRemind(r) {
    const changed = [];
    for (const m of ["miles", "hours"]) {
      if (r.rt[m]) continue;
      const ev = TF.parseNumber(m === "miles" ? r.everyMiles : r.everyHours, m === "miles" ? { whole: true, min: 1, max: 999999 } : { min: 0.1, max: 99999.9 }).value ?? null;
      const key = m === "miles" ? "remindMiles" : "remindHours", lib = r.orig && r.orig[key];
      const next = ev == null ? (r.custom ? "" : lib) : String(r.custom ? D.defaultRemind(m, ev) : Math.min(Number(lib), ev));
      if (next !== r[key]) { r[key] = next; if (next !== "") changed.push(m); }
    }
    return changed;
  }

  // ---------- text for a row ----------
  const span = (n, unit, withOne) => (unit === "month" && n % 12 === 0 ? (n === 12 ? (withOne ? "1 year" : "year") : `${n / 12} years`) : n === 1 ? (withOne ? "1 " : "") + unit : `${num(n)} ${unit}s`);
  // The plain meta line under a task's name (4.7 AC 12; mockup O4). What the library says until the person edits it.
  function rowMeta(r) {
    const parts = [], hr = r.kind === "hours", m = hr ? TF.parseNumber(r.everyHours, { min: 0.1, max: 99999.9 }).value : TF.parseNumber(r.everyMiles, { whole: true, min: 1, max: 999999 }).value, mo = TF.parseNumber(r.months, { whole: true, min: 1, max: 999 }).value;
    if (r.kind === "date") parts.push(r.orig && r.orig.hasMonthDay ? `Each year · ${monthDay(r.orig.monthDay)}` : "Each year · asks for the date");
    else parts.push("Every " + ([m != null && `${num(m)} ${hr ? "hr" : "mi"}`, mo != null && span(mo, r.unit, m != null)].filter(Boolean).join(" or ") || "?"));
    if (!r.checked) parts.push(r.custom ? "Won't be added" : "Starts paused");
    else if (r.kind === "date") { if (iso(clean(r.nextDate))) parts.push(`Next ${dayText(clean(r.nextDate))}`); }
    else parts.push(!r.notSure && iso(clean(r.lastDate)) ? `Last completed: ${dayText(clean(r.lastDate))}` : "Last completed: not sure");
    return parts.join(" · ");
  }
  // Will this ticked starter row be created paused? Only where the library says "not sure: pause" (2.3d) and no date was given (same test as Starters.instantiate).
  const startsPaused = (r) => !!(r.checked && !r.custom && r.orig && r.orig.pause && (r.notSure || !clean(r.kind === "date" ? r.nextDate : r.lastDate)));
  const PAUSED_NOTE = "Starts paused until you add a date";
  const everyLabel = (unit) => `Every (${TF.UNIT_WORD[unit] || "Months"})`;

  // ---------- checks ----------
  // Names clash per jar, trimmed, spaces collapsed, ignoring case (4.16). ctx.nameTaken(jar, name) is the one shared rule in data.js.
  function nameProblem(jar, raw, ctx) {
    const t = clean(raw);
    if (!t) return jar === "vehicles" ? "Give this vehicle a name, like 2021 Subaru Ascent." : jar === "health" ? "Give this person a name, like Me or Sam." : jar === "home" ? "Give your house a name, like Home or Maple Street." : "Give it a name, like Household or Maple Street.";
    if (len(t) > 80) return "Use 80 characters or fewer.";
    if (ctx.nameTaken(jar, t)) return `You already have a thing called that in ${JAR_LABEL[jar]}.`;
    return "";
  }
  function odometerProblem(raw) {
    const r = TF.parseNumber(raw, { whole: true, min: 0, max: MAX_ODO, what: "odometer" });
    return r.error || "";
  }
  const HOURS_OPT = { min: 0, max: 99999.9, what: "hour meter reading" };
  // Page 2. { name?, odometer?, hours? }. A queued Home page (d.queued) has its name checked by the queue, not here; its types are asked for by the queue too.
  function checkThing(d, ctx) {
    const e = {}, n = d.queued ? "" : nameProblem(d.jar, d.name, ctx); if (n) e.name = n;
    if (d.jar === "vehicles") { const o = odometerProblem(d.odometer); if (o) e.odometer = o; }
    if (d.hourMeter) { const h = TF.parseNumber(d.hours, HOURS_OPT); if (h.error) e.hours = h.error; }
    return e;
  }
  // Page 3. { rowKey: { field: message } }. Only ticked rows are checked (an unticked starter row is created switched off, as the library has it).
  function checkRows(d, ctx) {
    const out = {}, today = ctx.today;
    const created = d.rows.filter((x) => !x.custom || (x.checked && clean(x.name))); // a switched-off starter is still created, so its name counts
    const count = (nm) => created.filter((x) => key(x.checked || x.custom ? x.name : x.orig.name) === nm).length;
    const bad = (r, f, m) => { (out[r.key] = out[r.key] || {})[f] = m; };
    for (const r of d.rows.filter((x) => x.checked && (!x.custom || clean(x.name)))) { // a custom row with no name is not created (4.13 AC 3)
      followRemind(r); // an untouched Remind follows Every, so a row changed without the screen (Back, a test) is checked as the screen would show it
      const name = clean(r.name);
      if (!name) bad(r, "name", "Enter a name for the task.");
      else if (len(name) > 80) bad(r, "name", "Use 80 characters or fewer.");
      else if (count(key(name)) > 1) bad(r, "name", "This thing already has a task called that.");
      const miles = r.kind === "miles", date = r.kind === "date", hours = r.kind === "hours";
      if (hours) {
        const h = TF.parseNumber(r.everyHours, { min: 0.1, max: 99999.9, what: "hours" }), mo = TF.parseNumber(r.months, { whole: true, min: 1, max: 999, what: "months" });
        if (h.error) bad(r, "everyHours", h.error); else if (h.blank) bad(r, "everyHours", "Enter how many hours between services.");
        if (mo.error) bad(r, "months", mo.error);
        const rm = TF.remindCheck(r, "hours"); if (rm.error) bad(r, "remindHours", rm.error);
      } else if (miles) {
        const m = TF.parseNumber(r.everyMiles, { whole: true, min: 1, max: 999999, what: "miles" }), mo = TF.parseNumber(r.months, { whole: true, min: 1, max: 999, what: "months" });
        if (m.error) bad(r, "everyMiles", m.error); else if (m.blank && !r.custom) bad(r, "everyMiles", "Enter how many miles between services.");
        if (mo.error) bad(r, "months", mo.error);
        if (r.custom && m.blank && mo.blank) bad(r, "everyMiles", "Enter how often, in miles or months.");
        const rm = TF.remindCheck(r, "miles"); if (rm.error) bad(r, "remindMiles", rm.error);
      } else if (!date) {
        const mo = TF.parseNumber(r.months, { whole: true, min: 1, max: 999, what: "months" });
        if (mo.error) bad(r, "months", mo.error); else if (mo.blank) bad(r, "months", `Enter how many ${(TF.UNIT_WORD[r.unit] || "months").toLowerCase()} between services.`);
      }
      { // a start date is today (or the Last Completed date) plus Every; the data layer refuses one past 2100, so say so here, on the months field
        const moV = TF.parseNumber(r.months, { whole: true, min: 1, max: 999 }).value, lastV = r.notSure ? "" : clean(r.lastDate);
        const lm = TF.parseNumber(r.lastMiles, { whole: true, min: 0, max: MAX_ODO }).value, lh = TF.parseNumber(r.lastHours, { min: 0, max: 99999.9 }).value;
        const hasLog = iso(lastV) && ((miles && lm != null) || (hours && lh != null));
        if (!date && moV != null && !hasLog && !iso(D.addUnits(iso(lastV) ? lastV : today, moV, r.unit || "month"))) bad(r, "months", "That puts the first due date after the year 2100. Use a smaller number.");
      }
      if (r.notSure) continue; // the clock starts today; whatever was typed in the Last Completed boxes is ignored
      const last = clean(r.lastDate), lastMiles = TF.parseNumber(r.lastMiles, { whole: true, min: 0, max: MAX_ODO, what: "miles" });
      if (miles && lastMiles.error) bad(r, "lastMiles", lastMiles.error);
      const lastHours = TF.parseNumber(r.lastHours, { min: 0, max: 99999.9, what: "hours" });
      if (hours && lastHours.error) bad(r, "lastHours", lastHours.error);
      if (last && !iso(last)) bad(r, "lastDate", "Enter a real date.");
      else if (last && last > today) bad(r, "lastDate", "Last Completed can't be in the future.");
      else if (last && (miles && lastMiles.value == null || hours && lastHours.value == null) && TF.parseNumber(r.months, { whole: true, min: 1, max: 999 }).blank) bad(r, "lastDate", `Add the ${miles ? "miles" : "hours"} for that date too, or clear the date.`); // no months rule: a date alone would be dropped
      if (miles && lastMiles.value != null && !last) bad(r, "lastDate", "Enter the date for that reading, or clear the miles.");
      if (hours && lastHours.value != null && !last) bad(r, "lastDate", "Enter the date for that reading, or clear the hours.");
      const meterNow = TF.parseNumber(d.hours, HOURS_OPT).value;
      if (hours && lastHours.value != null && d.hourMeter && meterNow != null && lastHours.value > meterNow) bad(r, "lastHours", "That is more than the hour meter now. Check the number.");
      const odo = TF.parseNumber(d.odometer, { whole: true, min: 0, max: MAX_ODO });
      if (miles && lastMiles.value != null && odo.value != null && lastMiles.value > odo.value) bad(r, "lastMiles", "That is more than the odometer now. Check the number.");
      const next = clean(r.nextDate);
      if (date && next && !iso(next)) bad(r, "nextDate", "Enter a real date.");
    }
    return out;
  }

  // ---------- the records ----------
  // ctx = { today, nameTaken, deps: { makeThing, makeLog, newId } }. Returns { errors: { thing, rows } } or { thing, logs, counts }.
  // Nothing is written here; the caller saves { things: [thing], logs } in one commit().
  function plan(d, ctx) {
    const thingErr = checkThing(d, ctx), rowErr = checkRows(d, ctx);
    if (Object.keys(thingErr).length || Object.keys(rowErr).length) return { errors: { thing: thingErr, rows: rowErr } };
    return buildThing(d, ctx, d.name);
  }
  // One checked draft -> one thing with its tasks and any starting logs, under the given name. The caller has run checkThing and checkRows.
  function buildThing(d, ctx, name) {
    const { today, deps } = ctx, jar = d.jar, thingId = deps.newId("t");
    const logs = [], rows = {}, edits = {}, picked = [];
    const logFor = (taskId, name, date, odometer, hours = null) => {
      const l = deps.makeLog({ thingId, taskId, taskName: name, date, odometer, hours, status: "done", forDue: "" }, jar);
      if (l.error) throw new Error(l.error);
      logs.push(l.rec);
    };
    // How a row's Last Completed turns into data (data-model 2.3d): date + reading (miles or hours) = one log; date alone = a start date; Not Sure or blank = the clock starts today.
    const lastOf = (r) => {
      if (r.notSure) return { date: "", miles: null, hours: null };
      const m = TF.parseNumber(r.lastMiles, { whole: true, min: 0, max: MAX_ODO }).value, h = TF.parseNumber(r.lastHours, { min: 0, max: 99999.9 }).value;
      return { date: clean(r.lastDate), miles: r.kind === "miles" && m != null ? m : null, hours: r.kind === "hours" && h != null ? h : null };
    };
    const hasReading = (l) => l.miles != null || l.hours != null;
    for (const r of d.rows.filter((x) => !x.custom)) {
      if (r.checked) picked.push(r.id);
      if (!r.checked) continue;
      followRemind(r);
      const name = clean(r.name), ed = {}, o = r.orig, last = lastOf(r);
      if (name !== o.name) ed.name = name;
      if (r.kind === "miles" && r.everyMiles !== o.everyMiles) ed.milesEvery = TF.parseNumber(r.everyMiles, { whole: true, min: 1 }).value;
      if (r.kind === "hours" && r.everyHours !== o.everyHours) ed.hoursEvery = TF.parseNumber(r.everyHours, { min: 0.1 }).value;
      // A typed or followed Remind that differs from the library's; blank keeps the library value (capped at Every by Starters.instantiate).
      for (const [k, key, edit] of [["miles", "remindMiles", "milesRemind"], ["hours", "remindHours", "hoursRemind"]]) { const rc = TF.remindCheck(r, k); if (r.kind === k && !TF.parseNumber(r[key], { min: 0 }).blank && r[key] !== o[key] && rc.value != null) ed[edit] = rc.value; }
      if (r.kind !== "date") {
        const mo = TF.parseNumber(r.months, { whole: true, min: 1 });
        if (mo.blank) { if (o.hasTime) ed.noTime = true; }
        else if (!(o.hasTime && mo.value === Number(o.months) && r.unit === (o.unit === "year" ? "month" : o.unit))) { ed.n = mo.value; ed.unit = r.unit; }
      }
      if (Object.keys(ed).length) edits[r.id] = ed;
      if (r.kind === "date") { if (!r.notSure && clean(r.nextDate)) rows[r.id] = { startDate: clean(r.nextDate) }; }
      else if (last.date && hasReading(last)) { rows[r.id] = { hasLog: true, lastDate: last.date }; logFor(r.id, name, last.date, last.miles, last.hours); }
      else if (last.date) rows[r.id] = { lastDate: last.date };
    }
    const specs = ST.instantiate(jar, d.kind || null, d.types || [], { today, picked, rows, edits, hourMeter: !!d.hourMeter });
    const used = new Set(specs.map((s) => s.id));
    let customs = 0;
    for (const r of d.rows.filter((x) => x.custom && x.checked && clean(x.name))) {
      let id; do id = deps.newId("i"); while (used.has(id)); used.add(id);
      const name = clean(r.name), last = lastOf(r), spec = { id, name, miles: null, hours: null, time: null, active: true, default: false };
      const m = TF.parseNumber(r.everyMiles, { whole: true, min: 1 }), mo = TF.parseNumber(r.months, { whole: true, min: 1 });
      if (r.kind === "miles" && m.value != null) spec.miles = { every: m.value, remind: TF.remindCheck(r, "miles").value };
      const hasLog = !!(last.date && hasReading(last));
      if (mo.value != null) spec.time = { n: mo.value, unit: "month", from: "done", startDate: hasLog ? "" : D.addUnits(last.date || today, mo.value, "month"), activeFrom: null, activeTo: null };
      if (hasLog) logFor(id, name, last.date, last.miles, last.hours);
      specs.push(spec); customs++;
    }
    const odo = TF.parseNumber(d.odometer, { whole: true, min: 0, max: MAX_ODO }).value ?? null;
    const hrs = d.hourMeter ? TF.parseNumber(d.hours, HOURS_OPT).value ?? null : null; // the starting hour reading, dated today
    const ty = d.types || [];
    const t = deps.makeThing({ id: thingId, jar, name, kind: d.kind || undefined, type_1: ty[0], type_2: ty[1], type_3: ty[2], icon: ICON_CHOICES[jar] && !d.kind ? d.icon : undefined, odometer: jar === "vehicles" ? odo : null,
      odometerDate: jar === "vehicles" && odo != null ? today : "", hours: hrs, hoursDate: hrs != null ? today : "", tasks: specs });
    if (t.error) return { errors: { thing: {}, rows: {}, general: t.error } };
    const pausedNames = d.rows.filter(startsPaused).map((r) => clean(r.name));
    return { thing: t.rec, logs, counts: { pausedNames, on: specs.filter((s) => s.active).length, off: specs.filter((s) => !s.active).length, custom: customs, logs: logs.length } };
  }

  const api = { followRemind, JAR_LABEL, ADD_JARS, ICON_CHOICES, DEFAULT_NAME, STEPS, hasMeter, newDraft, setTypes, addCustom, isDirty, stepPercent, rowMeta, startsPaused, PAUSED_NOTE, len, everyLabel, nameProblem, checkThing, checkRows, plan, buildThing, clean, key };
  if (req) module.exports = api; else root.Setup = api;
})(typeof self !== "undefined" ? self : this);
