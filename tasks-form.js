/* Pickle It: the task form's rules (spec v1-scope 4.13, 4.14, 4.10 AC 15a; mockup settings-option-c.html C8-C9).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in). Loads in the browser as the global `TaskForm`
   (after due.js) and in Node via require(). The form keeps every field as text; validate() reads only the fields of the chosen
   "Repeats by" and returns a plain task spec for makeTask(), which stays the one place the jar rules are enforced. Nothing is saved here. */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./due.js") : root.Due;
  const BY = { miles: "Miles", time: "Time", hours: "Hours", dates: "Dates" };
  // Repeats by, per jar (data-model 2.2): miles on vehicles only, hours on vehicles and Home, time everywhere. Dates = a fixed calendar date.
  const BY_JARS = { miles: ["vehicles"], time: ["vehicles", "home", "health", "finance"], hours: ["vehicles", "home"], dates: ["vehicles", "home", "health", "finance"] };
  const options = (jar) => Object.keys(BY).filter((k) => BY_JARS[k].includes(jar)).map((key) => ({ key, label: BY[key] }));
  const UNIT_WORD = { day: "Days", week: "Weeks", month: "Months", year: "Months" }; // a year is shown as 12 months
  // Names: spaces collapsed; control, zero-width and bidi-control characters removed; a name of only invisible characters (including ZWNJ/ZWJ, which are kept inside real text) is blank. Keep in step with cleanText in data.js.
  const clean = (t) => { const s = String(t ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "").trim(); return /[^\s\u200c\u200d\ufe0f]/.test(s) ? s : ""; };
  const key = (s) => clean(s).toLowerCase();
  const iso = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

  // One number typed as text. Digits only: no sign, no "e", no hex. whole = no decimal point at all; otherwise one decimal place at most.
  // Returns { blank } for an empty box, { value } or { error }.
  function parseNumber(raw, { whole = false, min = 0, max, what = "number" } = {}) {
    const s = String(raw ?? "").trim();
    if (s === "") return { blank: true };
    if (!/^\d*\.?\d*$/.test(s) || s === ".") return { error: "Use digits only. No letters, signs or exponents." };
    if (whole && s.includes(".")) return { error: `The ${what} must be a whole number.` };
    if ((s.split(".")[1] || "").length > 1) return { error: "Use one decimal place at most." };
    const n = Number(s);
    if (n < min || n > max) return { error: `The ${what} must be from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.` };
    return { value: n };
  }

  // The latest done log's date and readings, for the read-only Last Completed boxes. logs = this task's logs.
  function lastDone(logs) {
    return logs.filter((l) => l.status !== "skipped").reduce((a, l) => (!a || l.date > a.date || (l.date === a.date && (l.createdAt || "") > (a.createdAt || "")) ? l : a), null);
  }

  // ---------- task record -> form ----------
  // ctx = { logs: this task's logs, dueDate: the task's current due date or null }
  function blank(jar) {
    const by = "time";
    return { name: "", by, everyMiles: "", everyHours: "", months: "", lastDate: "", nextDate: "", seasonOn: false, from: "4", to: "10", active: true, monthsUnit: "month",
      lastMiles: "", lastHours: "", remindMiles: "", remindHours: "", rt: { miles: false, hours: false }, _o: { n: null, unit: null, from: "done", startDate: "", milesRemind: null, hoursRemind: null, cal: false, id: "", default: null, lastDate: "", months: "", nextDate: "", name: "", hasLogs: false, jar } };
  }
  function fromTask(task, jar, ctx = {}) {
    const logs = ctx.logs || [], hasLogs = logs.length > 0, last = lastDone(logs), t = task.time || null;
    const by = task.miles ? "miles" : task.hours ? "hours" : t && t.from === "calendar" ? "dates" : "time";
    const st = blank(jar);
    const unit = t ? t.unit : "month", months = t ? String(t.unit === "year" ? t.n * 12 : t.n) : "";
    const w = t && t.from === "done" ? D.normaliseWindow({ from: t.activeFrom, to: t.activeTo }) : null;
    const lastDate = last ? last.date : t && t.from === "done" && t.startDate && !hasLogs ? D.addUnits(t.startDate, -t.n, t.unit) : "";
    Object.assign(st, {
      name: task.name, by, active: task.active !== false,
      everyMiles: task.miles ? String(task.miles.every) : "", everyHours: task.hours ? String(task.hours.every) : "",
      months: by === "dates" ? "" : months, monthsUnit: UNIT_WORD[unit] === "Months" ? "month" : unit,
      lastDate, lastMiles: last && last.odometer != null ? String(last.odometer) : "", lastHours: last && last.hours != null ? String(last.hours) : "",
      remindMiles: task.miles ? String(task.miles.remind) : "", remindHours: task.hours ? String(task.hours.remind) : "", rt: { miles: !!task.miles, hours: !!task.hours }, // a stored Remind is the person's own: it never follows Every (4.20 AC 6)
      nextDate: by === "dates" ? ctx.dueDate || (t && t.startDate) || "" : "",
      seasonOn: !!w, from: w ? String(w.from) : "4", to: w ? String(w.to) : "10",
    });
    st._o = { n: t ? t.n : null, unit: t ? t.unit : null, from: t ? t.from : "done", startDate: t ? t.startDate || "" : "", milesRemind: task.miles ? task.miles.remind : null,
      hoursRemind: task.hours ? task.hours.remind : null, cal: !!(t && t.from === "calendar" && (task.miles || task.hours)), id: task.id, default: task.default ?? null, lastDate, months: st.months, nextDate: st.nextDate, name: task.name, hasLogs, jar };
    return st;
  }

  // ---------- Remind (4.20) ----------
  const EVERY_OPT = { miles: { whole: true, min: 1, max: 999999 }, hours: { min: 0.1, max: 99999.9 } };
  const REMIND_OPT = { miles: { whole: true, min: 0, max: 999999, what: "Remind (Miles)" }, hours: { min: 0, max: 99999.9, what: "Remind (Hours)" } };
  const everyOf = (st, meter) => parseNumber(meter === "miles" ? st.everyMiles : st.everyHours, EVERY_OPT[meter]).value ?? null;
  // One meter's Remind as typed: { value } (blank = the default for the current Every, or null when Every is not a number yet) or { error }. Remind may equal Every, never exceed it (AC 8).
  function remindCheck(st, meter) {
    const r = parseNumber(meter === "miles" ? st.remindMiles : st.remindHours, REMIND_OPT[meter]), ev = everyOf(st, meter);
    if (r.error) return { error: r.error };
    if (r.blank) return { value: ev == null ? null : D.defaultRemind(meter, ev) };
    if (ev != null && r.value > ev) return { error: "Remind can't be more than Every." };
    return { value: r.value };
  }
  // The messages for the chosen meter's Remind right now, by field key: shown when a task with a stored Remind above Every opens (AC 13).
  function remindIssues(st) {
    const out = {};
    for (const m of ["miles", "hours"]) if (st.by === m) { const c = remindCheck(st, m); if (c.error) out[m === "miles" ? "remindMiles" : "remindHours"] = c.error; }
    return out;
  }
  // While the person has not typed in a Remind, it follows Every (AC 6). Returns the meters whose Remind just changed to a number, for the "Remind changed to N." announcement.
  function followRemind(st) {
    const changed = [];
    for (const m of ["miles", "hours"]) {
      if (st.rt[m]) continue;
      const ev = everyOf(st, m), key = m === "miles" ? "remindMiles" : "remindHours", next = ev == null ? "" : String(D.defaultRemind(m, ev));
      if (next !== st[key]) { st[key] = next; if (next !== "") changed.push(m); }
    }
    return changed;
  }

  // What the form shows for this state. Hidden fields keep their typed text; validate() ignores them.
  function view(st) {
    const meter = st.by === "miles" || st.by === "hours", timed = st.by === "time" || meter;
    const o = st._o, calendarKept = meter && o.cal; // a meter task that also counts from a fixed date keeps its rule as it is
    const monthsFilled = clean(st.months) !== "" || st.by === "time";
    // Last Completed (Date) can be typed only before the first history entry; after that the history says when it was done.
    return {
      everyMiles: st.by === "miles", everyHours: st.by === "hours", remindMiles: st.by === "miles", remindHours: st.by === "hours", months: timed, lastMiles: st.by === "miles", lastHours: st.by === "hours",
      lastDate: timed && !calendarKept, lastDateEditable: !o.hasLogs, lastMeterEditable: false, nextDate: st.by === "dates",
      season: timed && !calendarKept && monthsFilled, monthsLabel: `Every (${UNIT_WORD[st.monthsUnit] || "Months"})`,
    };
  }

  // ---------- form -> task spec ----------
  // ctx = { today, otherNames: names of this thing's other tasks, adding: bool, dueDate }
  // Returns { errors: { field: message }, spec } (spec null when there are errors). Hidden fields are ignored, so they are dropped on save.
  function validate(st, jar, ctx) {
    const errors = {}, o = st._o, v = view(st), today = ctx.today, meter = st.by === "miles" || st.by === "hours";
    const name = clean(st.name);
    if (!name) errors.name = "Enter a name for the task.";
    else if (Array.from(name).length > 80) errors.name = "Use 80 characters or fewer.";
    else if ((ctx.adding || key(name) !== key(o.name)) && (ctx.otherNames || []).some((n) => key(n) === key(name))) errors.name = "This thing already has a task called that.";
    if (!options(jar).some((x) => x.key === st.by)) errors.by = "Pick how this task repeats.";
    let miles = null, hours = null, time = null;
    if (st.by === "miles") {
      const r = parseNumber(st.everyMiles, { whole: true, min: 1, max: 999999, what: "miles" });
      if (r.value == null) errors.everyMiles = r.error || "Enter how many miles between services.";
      const rc = remindCheck(st, "miles");
      if (rc.error) errors.remindMiles = rc.error; else if (r.value != null) miles = { every: r.value, remind: rc.value };
    }
    if (st.by === "hours") {
      const r = parseNumber(st.everyHours, { min: 0.1, max: 99999.9, what: "hours" });
      if (r.value == null) errors.everyHours = r.error || "Enter how many hours between services.";
      const rc = remindCheck(st, "hours");
      if (rc.error) errors.remindHours = rc.error; else if (r.value != null) hours = { every: r.value, remind: rc.value };
    }
    if (v.months) {
      const r = parseNumber(st.months, { whole: true, min: 1, max: 999, what: "months" });
      if (r.error) errors.months = r.error;
      else if (r.blank && st.by === "time") errors.months = "Enter how many months between services.";
      else if (r.value != null) {
        // Untouched stays as it was (a yearly task stays "year"); a typed change counts in the task's own unit (months, or days/weeks it already had).
        const same = r.value === Number(o.months) && o.n != null && st.months === o.months;
        const n = same ? o.n : r.value, unit = same ? o.unit : st.monthsUnit;
        let lastDate = "", sd = "";
        if (v.lastDate && v.lastDateEditable) {
          lastDate = clean(st.lastDate);
          if (lastDate && !iso(lastDate)) errors.lastDate = "Enter a real date.";
          else if (lastDate > today && lastDate !== o.lastDate) errors.lastDate = "Last Completed can't be in the future.";
        }
        const from = o.cal && meter ? "calendar" : "done";
        if (from === "calendar") sd = o.startDate;
        else if (!v.lastDateEditable) sd = o.startDate || (o.hasLogs ? "" : D.addUnits(today, n, unit)); // history decides; the start date is not rewritten
        else if (lastDate) sd = lastDate === o.lastDate && n === o.n && unit === o.unit && o.startDate ? o.startDate : D.addUnits(lastDate, n, unit);
        else if (o.n != null && !o.startDate) sd = ""; // an undated task stays undated ("Add a last-done date") until a date is typed
        else sd = n === o.n && unit === o.unit && o.startDate ? o.startDate : D.addUnits(today, n, unit); // "Not sure": the clock starts today
        let af = null, at = null;
        if (v.season && st.seasonOn && from === "done") {
          const f = parseNumber(st.from, { whole: true, min: 1, max: 12 }), e = parseNumber(st.to, { whole: true, min: 1, max: 12 });
          if (f.value == null || e.value == null) errors.season = "Pick both months.";
          else { const w = D.normaliseWindow({ from: f.value, to: e.value }); if (w) { af = w.from; at = w.to; } } // January to December is "off"
        }
        if (!errors.lastDate) time = { n, unit, from, startDate: sd, activeFrom: af, activeTo: at };
      }
    }
    if (st.by === "dates") {
      const d = clean(st.nextDate);
      if (!d) errors.nextDate = "Enter the next date.";
      else if (!iso(d)) errors.nextDate = "Enter a real date.";
      else {
        const keep = o.from === "calendar" && o.startDate && d === o.nextDate; // untouched: the series start is not rewritten
        time = { n: o.from === "calendar" && o.n ? o.n : 1, unit: o.from === "calendar" && o.unit ? o.unit : "year", from: "calendar", startDate: keep ? o.startDate : d, activeFrom: null, activeTo: null };
      }
    }
    if (Object.keys(errors).length) return { errors, spec: null };
    return { errors, spec: { id: o.id, name, miles, hours, time, active: st.active !== false, default: o.default } };
  }

  const NO_SENSITIVE = "Don't enter account, card, insurance or ID numbers, passwords or diagnoses."; // the plain hint under free-text names (privacy review 2026-11-07 M1)
  const api = { NO_SENSITIVE, clean, options, parseNumber, lastDone, blank, fromTask, view, validate, remindCheck, remindIssues, followRemind, UNIT_WORD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaskForm = api;
})(typeof self !== "undefined" ? self : this);
