/* Pickle It: due-date math (data-model 3.1-3.8, Seasonal gaps, Pause-card verdicts).
   Pure functions on local YYYY-MM-DD strings: no storage, no DOM, no dependencies, never reads the clock
   (today is always passed in). Loads in the browser as the global `Due` and in Node via require().
   computeDue takes exactly the shape of the entries in tests/due-date-fixtures.json. */
(function (root) {
  "use strict";
  const BOXES = ["overdue", "due-this-week", "due-this-month", "due-later"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // plain comparison, same on every device
  const ymd = (s) => s.split("-").map(Number);
  const utc = (s) => { const [y, m, d] = ymd(s); return Date.UTC(y, m - 1, d); };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const first = (y, m) => `${y}-${pad(m)}-01`; // m is 1-12
  const monthOf = (s) => ymd(s)[1];

  // ---------- dates (3.1, 3.2) ----------
  // Whole calendar days between two dates; UTC math so daylight saving and the device zone never matter.
  const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 864e5);
  // Day/week add exactly; month/year clamp the day to the target month (Jan 31 + 1 month = Feb 28). n may be negative.
  function addUnits(date, n, unit) {
    if (unit === "day" || unit === "week") return iso(utc(date) + n * (unit === "week" ? 7 : 1) * 864e5);
    const [y, m, d] = ymd(date);
    const t = y * 12 + (m - 1) + n * (unit === "year" ? 12 : 1);
    const ny = Math.floor(t / 12), nm = t - ny * 12;
    return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()))}`;
  }
  // Calendar rules always count from startDate, never from the previous occurrence, so month-ends don't drift.
  const occurrence = (startDate, n, unit, k) => addUnits(startDate, k * n, unit);

  // ---------- active-months window ----------
  // Whole numbers 1-12 for both ends, and not the full year; anything else means "active all year" (null).
  function normaliseWindow(w) {
    const ok = (v) => Number.isInteger(v) && v >= 1 && v <= 12;
    return w && ok(w.from) && ok(w.to) && !(w.from === 1 && w.to === 12) ? { from: w.from, to: w.to } : null;
  }
  const monthOpen = (w, m) => (w.from <= w.to ? m >= w.from && m <= w.to : m >= w.from || m <= w.to);
  const windowOpen = (w, date) => !w || monthOpen(w, monthOf(date));
  // First day of the first month after `date`'s month whose openness equals `open`.
  function monthStartAfter(w, date, open) {
    let [y, m] = ymd(date);
    for (let i = 0; i < 12; i++) {
      if (++m > 12) { m = 1; y++; }
      if (monthOpen(w, m) === open) return first(y, m);
    }
    return null; // unreachable for a normalised window
  }
  const resumeDate = (w, today) => (!w || windowOpen(w, today) ? null : monthStartAfter(w, today, true));
  const chipText = (w, open, resume) =>
    !w ? null : !open ? `Paused until ${MON[monthOf(resume) - 1]} ${+resume.slice(8)}` : w.from === w.to ? MON[w.from - 1] : `${MON[w.from - 1]}-${MON[w.to - 1]}`;

  // The A2 walk: only open months count; start day is day 0; a clock that ends as the window closes resumes on the reopening day.
  function seasonalWalk(w, start, n, unit, today) {
    const S = windowOpen(w, start) ? start : monthStartAfter(w, start, true);
    const P = addUnits(S, n, unit), len = daysBetween(S, P);
    const segs = [];
    let cur = S, rem = len, due;
    for (;;) {
      const end = monthStartAfter(w, cur, false), avail = daysBetween(cur, end);
      segs.push({ start: cur, end, before: len - rem });
      if (rem < avail) { due = addUnits(cur, rem, "day"); break; }
      if (rem === avail) { due = monthStartAfter(w, end, true); break; } // finished as the window closed
      rem -= avail; cur = monthStartAfter(w, end, true);
    }
    let used = 0;
    for (const g of segs) { if (today < g.start) break; used = g.before + Math.min(daysBetween(g.start, today), daysBetween(g.start, g.end)); }
    used = Math.min(used, len);
    return { S, P, len, due, daysUsed: used, daysLeft: len - used };
  }

  // ---------- boxes (3.7, 3.4) ----------
  const dateBox = (days) => (days < 0 ? BOXES[0] : days <= 7 ? BOXES[1] : days <= 27 ? BOXES[2] : BOXES[3]);
  const mostUrgent = (...bs) => bs.filter(Boolean).sort((a, b) => BOXES.indexOf(a) - BOXES.indexOf(b))[0] || null;
  // One meter rule's box. estDays = days to its estimated date, or null when it has none.
  function meterBox(left, remind, estDays) {
    if (left < 0) return BOXES[0];
    const b = estDays != null ? dateBox(estDays) : left === 0 ? BOXES[1] : left <= remind ? BOXES[2] : BOXES[3];
    return b === BOXES[3] && left > 0 && left <= remind ? BOXES[2] : b; // within remind: never Due Later
  }
  // Box for one task from its parts: days/left/remind are the meter rule (days = estimate), timeDays the time rule.
  // The most urgent rule wins (3.4), so a far-off date with a meter at 0 left is Due This Week.
  function boxOf({ days = null, left = null, remind = 0, timeDays = null } = {}) {
    const meter = left != null ? meterBox(left, remind, days) : null;
    const date = left != null ? timeDays : days; // with a meter, `days` is its estimate, not a separate date
    return mostUrgent(meter, date != null ? dateBox(date) : null) || BOXES[3];
  }

  // ---------- time rule (3.2, Seasonal gaps) ----------
  const latest = (logs) => logs.reduce((a, b) => (!a || b.date > a.date || (b.date === a.date && (b.createdAt || "") > (a.createdAt || "")) ? b : a), null);
  function timeInfo(time, win, logs, today) {
    const L = latest(logs);
    let due, extra = {};
    if (time.from === "calendar") {
      const m = L && L.forDue && L.forDue > L.date ? L.forDue : L && L.date;
      let k = 0;
      due = occurrence(time.startDate, time.n, time.unit, 0);
      if (L) while (due <= m && k < 1e5) due = occurrence(time.startDate, time.n, time.unit, ++k);
    } else if (win) {
      const w = seasonalWalk(win, L ? L.date : addUnits(time.startDate, -time.n, time.unit), time.n, time.unit, today);
      due = w.due;
      extra = { S: w.S, P: w.P, len: w.len, daysUsed: w.daysUsed, daysLeft: w.daysLeft, hasPaused: w.due > w.P };
    } else due = L ? addUnits(L.date, time.n, time.unit) : time.startDate;
    return { due, extra };
  }

  // ---------- meter rule (3.3, 3.3b) ----------
  const ceilDiv = (a, b) => (a - (a % b)) / b + (a % b > 0 ? 1 : 0); // exact for integers, no float drift
  const meterField = (key) => (key === "miles" ? { field: "odometer", sc: 1 } : { field: "hours", sc: 10 }); // sc: work in whole units (tenths of an hour)
  // A meter change (a reading row with oldValue) shifts every earlier entry (older date, or same date created earlier) by new - old, at read time.
  const shiftScaled = (e, changes, field, sc) => changes.reduce((s, c) => s + (c !== e && c[field] != null && c.oldValue != null
    && (e.date < c.date || (e.date === c.date && (e.createdAt || "") < (c.createdAt || ""))) ? Math.round(c[field] * sc) - Math.round(c.oldValue * sc) : 0), 0);
  // The shift, in meter units, that a thing's meter changes apply to one dated record (a fill-up, say). Used for the MPG trip math.
  const shiftOf = (e, changes, key = "miles") => { const { field, sc } = meterField(key); return shiftScaled(e, changes, field, sc) / sc; };
  // Every dated entry of one meter (logs and readings of one thing) in the current meter's terms. meterInfo and checkReading share it.
  function meterEntries(key, logs, readings) {
    const { field, sc } = meterField(key), sv = (v) => Math.round(v * sc);
    const entry = (e, isLog) => ({ src: e, isLog, date: e.date, v: sv(e[field]) + shiftScaled(e, readings, field, sc) });
    const es = [
      ...logs.filter((l) => l[field] != null).map((l) => entry(l, true)),
      ...readings.filter((r) => r[field] != null).map((r) => entry(r, false)),
    ];
    return { field, sc, sv, es };
  }
  function meterInfo(key, rule, logs, readings, today) {
    const { sc, sv, es } = meterEntries(key, logs, readings);
    const out = { meter: key, meterDue: null, left: null, currentValue: null, logValue: null, ratePerDay: null, rawEstimate: null, estimatedDate: null, box: BOXES[3] };
    if (!es.length) return out;
    const cur = Math.max(...es.map((e) => e.v));
    const logsV = es.filter((e) => e.isLog).map((e) => e.v);
    const ev = sv(rule.every), rv = sv(rule.remind || 0);
    const due = logsV.length ? Math.max(...logsV) + ev : Math.max(ev, Math.ceil(cur / ev) * ev);
    const left = due - cur;
    // Rate: readings in the last 365 days, at least 30 days apart, rising, latest within 90 days.
    const pool = es.filter((e) => e.date >= addUnits(today, -365, "day"));
    let estimatedDate = null;
    if (pool.length >= 2) {
      const d0 = pool.reduce((a, e) => (e.date < a ? e.date : a), pool[0].date), d1 = pool.reduce((a, e) => (e.date > a ? e.date : a), pool[0].date);
      const v0 = Math.max(...pool.filter((e) => e.date === d0).map((e) => e.v)), v1 = Math.max(...pool.filter((e) => e.date === d1).map((e) => e.v));
      const span = daysBetween(d0, d1), delta = v1 - v0;
      if (span >= 30 && delta > 0 && d1 >= addUnits(today, -90, "day")) {
        out.ratePerDay = `${delta / sc}/${span}`;
        if (left > 0) {
          out.rawEstimate = addUnits(d1, ceilDiv(left * span, delta), "day");
          estimatedDate = out.rawEstimate < today ? today : out.rawEstimate; // a passed estimate means due today, not overdue
        }
      }
    }
    return Object.assign(out, {
      meterDue: due / sc, left: left / sc, currentValue: cur / sc, logValue: logsV.length ? Math.max(...logsV) / sc : null,
      estimatedDate, box: meterBox(left, rv, estimatedDate ? daysBetween(today, estimatedDate) : null),
    });
  }

  // ---------- the whole task ----------
  // { rule:{time?,miles?,hours?}, window?:{from,to}|null, logs:[{date,status,forDue,odometer,hours,createdAt}],
  //   readings:[{date,kind,odometer,hours,oldValue,createdAt}], today }
  function computeDue({ rule, window: win, logs = [], readings = [], today }) {
    const time = rule.time || null;
    const w = time && time.from === "done" ? normaliseWindow(win !== undefined ? win : { from: time.activeFrom, to: time.activeTo }) : null;
    const open = w ? windowOpen(w, today) : null, resume = w ? resumeDate(w, today) : null;
    const t = time ? timeInfo(time, w, logs, today) : null;
    const meters = ["miles", "hours"].filter((k) => rule[k]).map((k) => meterInfo(k, rule[k], logs, readings, today));
    const timeHalfPaused = !!(w && !open && t.due > today);
    // Strict reading (decisions.md Round 12 gap 6): a meter rule un-pauses the task only at left <= 0 or an estimate of today or earlier.
    const rescued = timeHalfPaused && meters.some((m) => m.left != null && (m.left <= 0 || (m.estimatedDate && m.estimatedDate <= today)));
    const paused = timeHalfPaused && !rescued;
    const placed = [];
    if (t && !timeHalfPaused) placed.push({ box: dateBox(daysBetween(today, t.due)), date: t.due });
    for (const m of meters) placed.push({ box: m.box, date: m.estimatedDate });
    const dates = [...placed.map((p) => p.date), ...(paused ? [t.due] : [])].filter(Boolean).sort();
    const dueDate = dates[0] || null, days = dueDate ? daysBetween(today, dueDate) : null;
    const box = paused ? null : mostUrgent(...placed.map((p) => p.box)) || BOXES[3];
    const m0 = meters[0] || {};
    return {
      dueDate, days, box, overdue: box === BOXES[0], overdueByDays: days != null && days < 0 && box === BOXES[0] ? -days : null,
      paused, isPaused: paused, timeHalfPaused, timeDue: t ? t.due : null,
      meter: m0.meter || null, meterDue: m0.meterDue ?? null, left: m0.left ?? null, currentValue: m0.currentValue ?? null, logValue: m0.logValue ?? null,
      ratePerDay: m0.ratePerDay ?? null, rawEstimate: m0.rawEstimate ?? null, estimatedDate: m0.estimatedDate ?? null,
      window: w, windowOpenNow: open, resumeDate: resume, chipText: chipText(w, open, resume),
      S: null, P: null, len: null, daysUsed: null, daysLeft: null, hasPaused: false, ...(t ? t.extra : {}),
      notStarted: paused && t.extra.daysUsed === 0,
      lastDone: logs.filter((l) => l.status !== "skipped").reduce((a, l) => (!a || l.date > a ? l.date : a), null),
    };
  }

  // ---------- text for a meter row (3.3a); en-US, the UI may swap in the device format ----------
  const num = (x) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(x);
  function dateText(d, today) {
    if (d === today) return "Today";
    const [y, m, day] = ymd(d);
    return `${MON[m - 1]} ${day}${d > addUnits(today, 6, "month") ? `, ${y}` : ""}`;
  }
  // A date follows the amount only when there is an estimate (then dueDate is the earlier of it and the time rule's date).
  function rowText(r, today) {
    if (!r.meter) return null;
    const u = r.meter === "miles" ? "mi" : "hr";
    if (r.left == null) return "Add a reading";
    if (r.left < 0) return `${num(-r.left)} ${u} over`;
    if (r.left === 0 || (r.rawEstimate && r.rawEstimate < today)) return "Due now";
    return `${num(r.left)} ${u}${r.estimatedDate ? ` / ${dateText(r.dueDate, today)}` : ""}`;
  }

  // ---------- order inside a box (3.7) ----------
  // Row: { dueDate|null, left|null (units; negative = over), jar, thing, task, id }. Dated first by date, then undated by units left.
  const JARS = ["Vehicles", "Home", "Health", "Finance"];
  const jarRank = (j) => JARS.findIndex((x) => x.toLowerCase() === String(j).toLowerCase()); // rows carry the stored lowercase jar key
  const compareRows = (a, b) =>
    (a.dueDate ? (b.dueDate ? cmp(a.dueDate, b.dueDate) : -1) : b.dueDate ? 1 : cmp(a.left ?? Infinity, b.left ?? Infinity)) ||
    cmp(jarRank(a.jar), jarRank(b.jar)) || cmp(a.thing, b.thing) || cmp(a.task, b.task) || cmp(a.id, b.id);

  // ---------- the Pantry feed (3.7; data-layer-plan 3). Reads stored records, stores nothing. ----------
  const BOX_CAP = 50;
  const JAR_KEYS = ["vehicles", "home", "health", "finance"];
  // A thing has an hour meter when it has starting hours, an hours rule, or is a Home mower or generator (3.4a).
  const hasHourMeter = (t) => t.hours != null || (t.tasks || []).some((k) => k.hours) || (t.jar === "home" && (t.kind === "mower" || t.kind === "generator"));
  const group = (list, key) => { const m = new Map(); for (const x of list) { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); } return m; };

  // The dated readings of a thing that are not logs: its starting odometer and hours, its fill-ups and its readings rows.
  function meterSources(t, fillups, readings, today) {
    const made = String(t.createdAt || "").slice(0, 10) || today; // a starting value with no date counts from the day the thing was made
    const start = [];
    if (t.odometer != null) start.push({ date: t.odometerDate || made, odometer: t.odometer });
    if (t.hours != null) start.push({ date: t.hoursDate || made, hours: t.hours });
    return [...start, ...fillups, ...readings];
  }
  // Add Reading and the Done sheet (B9.3): is a new reading (meter "miles" or "hours", value, date) ok, lower or higher than its neighbours?
  // data = { logs, readings, fillups } of this one thing (any task's logs count). Compared in the current meter's terms, so earlier meter changes are respected.
  // lower: below the highest reading dated on or before `date`. higher: above the lowest reading dated after it. lower wins when both.
  // last and later carry the TYPED number and date, never a shifted number.
  function checkReading({ logs = [], readings = [], fillups = [] }, thing, meter, date, value, createdAt, today = date) {
    const cand = { date, createdAt: createdAt || "9999", [meterField(meter).field]: value };
    const { field, es } = meterEntries(meter, logs.filter((l) => l.thingId === thing.id), [...meterSources(thing, fillups.filter((f) => f.thingId === thing.id), readings.filter((r) => r.thingId === thing.id), today), cand]);
    const me = es.find((e) => e.src === cand), others = es.filter((e) => e !== me);
    const pick = (list, better) => list.reduce((a, e) => (!a || better(e, a) ? e : a), null);
    const last = pick(others.filter((e) => e.date <= date), (e, a) => e.v > a.v || (e.v === a.v && e.date > a.date)), later = pick(others.filter((e) => e.date > date), (e, a) => e.v < a.v || (e.v === a.v && e.date < a.date)); // ties: the nearest to `date`
    const out = (e) => (e ? { typed: e.src[field], date: e.date } : null);
    return { status: last && me.v < last.v ? "lower" : later && me.v > later.v ? "higher" : "ok", last: out(last), later: out(later) };
  }

  // data = { things (tasks embedded), logs, readings, fillups, hiddenJars }. One row per active task of an active thing in a shown jar;
  // paused tasks, inactive tasks/things, hidden jars and one-offs (taskId "other") give no row.
  // all = true (the Assets tab, S2): every task of every thing, including inactive things, hidden jars, paused tasks (box null) and switched-off tasks (off: true).
  // only = a row id ("thingId|taskId"): return just that task's row, even if it is paused or inactive (Done and Skip recompute at Save, B8).
  function pantryTasks({ things = [], logs = [], readings = [], fillups = [], hiddenJars = [] }, today, only = null, all = false) {
    const hidden = new Set(hiddenJars), lg = group(logs, "thingId"), rd = group(readings, "thingId"), fu = group(fillups, "thingId"), rows = [];
    for (const t of things) {
      if (only ? !only.startsWith(t.id + "|") : !all && (!t.active || hidden.has(t.jar))) continue;
      const meter = meterSources(t, fu.get(t.id) || [], rd.get(t.id) || [], today), tl = lg.get(t.id) || [];
      for (const k of t.tasks || []) {
        if (only ? only !== `${t.id}|${k.id}` : (!all && k.active === false) || k.id === "other") continue;
        const mine = tl.filter((l) => l.taskId === k.id);
        // A time rule with no date to count from (no start date and no usable log) can't be placed: drop it, the task waits in Due Later.
        const noDate = !!k.time && !k.time.startDate && !(k.time.from === "done" && mine.length);
        const rule = {};
        if (k.time && !noDate) rule.time = k.time;
        if (k.miles) rule.miles = k.miles;
        if (k.hours) rule.hours = k.hours;
        // Logs of the thing's other tasks (and one-offs) are still odometer/hour readings for this task's current value.
        const r = computeDue({ rule, logs: mine, readings: [...meter, ...tl.filter((l) => l.taskId !== k.id)], today });
        // A "from last done" task with no log, no start date and a closed window has no clock to run: it is paused like any seasonal task (3.5/3.7, 4.17 AC 5d). A meter at 0 left or an estimate of today still brings it forward.
        const w0 = noDate && k.time.from === "done" ? normaliseWindow({ from: k.time.activeFrom, to: k.time.activeTo }) : null;
        if (w0 && !windowOpen(w0, today) && !(r.left != null && r.left <= 0) && !(r.estimatedDate && r.estimatedDate <= today)) {
          r.paused = true; r.box = null; r.chipText = chipText(w0, false, resumeDate(w0, today));
        }
        if (r.box == null && !only && !all) continue; // paused
        const meterRule = r.meter != null;
        rows.push({
          id: `${t.id}|${k.id}`, thingId: t.id, taskId: k.id, task: k.name, thing: t.name, jar: t.jar, kind: t.kind || "",
          box: r.box, over: r.overdue, dueDate: r.dueDate, days: r.days, left: r.left, unit: r.meter === "miles" ? "mi" : r.meter === "hours" ? "hr" : "",
          estDays: r.estimatedDate ? daysBetween(today, r.estimatedDate) : null, meter: meterRule,
          // A combined task with no reading yet is placed by its date, so it shows the date, not "Add a reading".
          text: meterRule && (r.left != null || r.timeDue == null) ? rowText(r, today) : null,
          noDate: noDate && !meterRule,
          // A calendar time rule with no start date and no meter: a log would change nothing, so Done and Skip must not be offered or written (QA B7/B8 bug 1).
          stuck: noDate && !meterRule && k.time.from !== "done",
          // Paused by its season (data-model 3.7): "Paused until Apr 1", shown in the Done/Skip toast.
          paused: !!r.paused, chip: r.paused ? r.chipText : null, off: k.active === false,
          // For Done and Skip (B8): the meter's current value, the task's time-rule due date, its latest log date, and (only mode, vehicles) the odometer.
          currentValue: r.currentValue, timeDue: r.timeDue, lastLogDate: mine.reduce((a, l) => (l.date > a ? l.date : a), ""),
          odometerNow: only && t.jar === "vehicles" ? computeDue({ rule: { miles: { every: 1, remind: 0 } }, readings: [...meter, ...tl], today }).currentValue : null,
        });
      }
    }
    return rows;
  }
  // Rows into the four boxes, each sorted (3.7). attn = Overdue + Due this week (header count); jarDots = jars with one of those.
  function pantryBoxes(rows) {
    const boxes = Object.fromEntries(BOXES.map((b) => [b, []]));
    for (const r of rows) boxes[r.box].push(r);
    for (const b of BOXES) boxes[b].sort(compareRows);
    const attn = boxes[BOXES[0]].concat(boxes[BOXES[1]]);
    return { boxes, attn: attn.length, jarDots: Object.fromEntries(JAR_KEYS.map((j) => [j, attn.some((r) => r.jar === j)])) };
  }

  // The Remind a new Miles or Hours rule starts with (spec 4.20 AC 5; the one rule for the Assets form, the setup row and the importer). Never more than Every.
  const defaultRemind = (meter, every) => (meter === "hours" ? Math.round(every) / 10 : Math.min(every, every <= 15000 ? 1000 : 5000));

  const api = { defaultRemind, BOXES, BOX_CAP, daysBetween, addUnits, occurrence, normaliseWindow, windowOpen, resumeDate, dateBox, mostUrgent, meterBox, boxOf, computeDue, rowText, compareRows, hasHourMeter, meterEntries, meterSources, shiftOf, checkReading, pantryTasks, pantryBoxes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Due = api;
})(typeof self !== "undefined" ? self : this);
