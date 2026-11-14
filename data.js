"use strict";
/* Pickle It: the data layer. No screens in here.
   - Storage: IndexedDB in this browser. No server, no accounts.
   - Math: MPG and maintenance due mileage.
   - Backup: CSV export and import (with a preview plan before anything is saved).
   app.js loads after this file and builds the screens on top of it. */

// ---------- Small helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => isoDate(new Date());
const nowISO = () => new Date().toISOString();
const lower = (s) => String(s ?? "").trim().toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // plain comparison: the same on every device and language
function newId(prefix) {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return prefix + "_" + Date.now().toString(36) + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("");
}
function validISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isWhole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isNum = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
// Text is trimmed, runs of spaces collapsed and length capped. Running it twice gives the same result,
// which keeps export -> import -> export identical.
// Cuts at max Unicode code points, never inside a surrogate pair (an emoji is one). shortcut: a grapheme cluster (flag, family emoji) can still be cut between its code points, only past the limit; setup refuses over-long names instead.
// Names: control, zero-width and bidi-control characters are removed; a name of only invisible characters is blank. ZWNJ/ZWJ stay inside real text (emoji sequences, Persian). Keep in step with clean in tasks-form.js.
const cleanText = (s, max) => { const t = String(s ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "").trim(); return /[^\s\u200c\u200d\ufe0f]/.test(t) ? Array.from(t).slice(0, max).join("").trim() : ""; };
const cleanNotes = (s, max) => Array.from(String(s ?? "").replace(/\r\n?/g, "\n").trim()).slice(0, max).join("").trim();

// ---------- Standard maintenance schedule ----------
// Common intervals for normal driving. Every new vehicle gets its own copy, which the user can edit.
// every = miles between services; remind = start showing it as "due soon" this many miles before.
const STANDARD_SCHEDULE = [
  { id: "oil", name: "Oil & filter change", every: 5000, remind: 1000 },
  { id: "rotate", name: "Tire rotation", every: 5000, remind: 1000 },
  { id: "cabin", name: "Cabin air filter", every: 12000, remind: 1000 },
  { id: "airfilter", name: "Engine air filter", every: 30000, remind: 5000 },
  { id: "brakefluid", name: "Brake fluid flush", every: 30000, remind: 5000 },
  { id: "transfluid", name: "Transmission fluid", every: 60000, remind: 5000 },
  { id: "plugs", name: "Spark plugs", every: 60000, remind: 5000 },
  { id: "coolant", name: "Engine coolant", every: 100000, remind: 5000 },
  // From the 2021 Subaru Ascent schedule. Chart marks them every 12,000 mi (inspections) or 30,000 mi.
  { id: "brakes", name: "Inspect brakes", every: 12000, remind: 1000 },
  { id: "brakelines", name: "Inspect brake lines", every: 12000, remind: 1000 },
  { id: "parkingbrake", name: "Inspect parking brake", every: 12000, remind: 1000 },
  { id: "steering", name: "Inspect steering", every: 12000, remind: 1000 },
  { id: "suspension", name: "Inspect suspension", every: 12000, remind: 1000 },
  { id: "driveline", name: "Inspect driveline (shafts, CV boots, joints)", every: 12000, remind: 1000 },
  { id: "cvtinspect", name: "Inspect CVT fluid", every: 30000, remind: 5000 },
  { id: "drivebelts", name: "Inspect drivebelts", every: 30000, remind: 5000 },
  { id: "hoses", name: "Inspect coolant and hoses", every: 30000, remind: 5000 },
  { id: "fuelsystem", name: "Inspect fuel system", every: 30000, remind: 5000 },
  { id: "diff", name: "Inspect differential fluid (front/rear)", every: 30000, remind: 5000 },
  // shortcut: chart shows one fuel filter replacement, at 72,000 mi (nothing after); repeating every 72k is a guess.
  { id: "fuelfilter", name: "Fuel filter", every: 72000, remind: 5000 },
  { id: "bearings", name: "Inspect wheel bearings", every: 60000, remind: 5000 },
  { id: "cvtfluid", name: "CVT fluid replacement", every: 120000, remind: 5000 },
  // Optional: not on a new vehicle by default. The schedule editor offers them as "Add" buttons (manual-transmission and timing-belt cars).
  { id: "clutch", name: "Inspect clutch operation", every: 12000, remind: 1000, optional: true },
  { id: "manualgear", name: "Inspect manual transmission gear oil", every: 30000, remind: 5000, optional: true },
  { id: "timingbelt", name: "Timing belt replacement", every: 90000, remind: 5000, optional: true },
];

// ---------- Records ----------
// Every record is built by one of these, whether it comes from a form or an imported file,
// so a record always has exactly the same shape. Each returns { rec } or { error }.
// Field names and ranges: docs/specs/data-model.md 2.3. Names are the glossary's (thing, task, log, reading).
const MAX_ODO = 9999999;
const JAR_NAMES = ["vehicles", "home", "health", "finance"];
const opt = (x) => (x == null || x === "" ? null : x);
const hoursProblem = (h) => (isNum(h, 0, 99999.9) ? "the hours can have one decimal at most" : "the hours must be a number from 0 to 99,999.9");
const odoProblem = (n) => (!Number.isInteger(n) ? "the odometer must be a whole number of miles" : n < 0 ? "the odometer can't be negative" : "the odometer can't be more than 9,999,999 miles");
const isHours = (h) => isNum(h, 0, 99999.9) && Math.round(h * 10) / 10 === h;
// Which rules a jar's tasks may use (data-model 2.2). Combined: miles + time or hours + time, never miles + hours.
const JAR_MEASURES = { vehicles: ["miles", "hours", "time"], home: ["hours", "time"], health: ["time"], finance: ["time"] };
const TIME_UNITS = ["day", "week", "month", "year"];
// Thing names clash when equal after trimming, collapsing inner spaces and ignoring case (data-model 7.2).
const shopKey = (s) => lower(String(s ?? "").normalize("NFC")); // shop names compare ignoring capitals and composed vs decomposed accents (QA R2 finding 9)
const nameKey = (s) => lower(String(s ?? "").replace(/\s+/g, " "));
const nameTaken = (jar, name, exceptId) => S.things.some((v) => v.jar === jar && v.id !== exceptId && nameKey(v.name) === nameKey(name));
// Only vehicles have an odometer; vehicles and Home have hour meters (data-model 2.2, 2.3).
const meterProblem = (jar, odometer, hours) => (odometer != null && jar !== "vehicles" ? "only vehicles have an odometer"
  : hours != null && jar !== "vehicles" && jar !== "home" ? "only vehicles and Home things have hours" : "");
// Place icons, setup kinds and their type lists (data-model 2.3a, 2.3b). Anything not on a list is dropped, never stored.
const ICONS = { home: ["house", "apartment", "land"], finance: ["house", "apartment", "land", "account"] };
const KIND_TYPES = {
  hvac: [["gas", "electric", "heat-pump", "oil", "none"], ["central", "window-unit", "heat-pump", "mini-split", "none"], ["ducted", "ductless", "none"]],
  "water-heater": [["gas", "electric"]], dryer: [["gas", "electric"]], "snow-blower": [["gas", "electric"]],
  generator: [["gas", "electric"], ["portable", "standby"]], mower: [["gas", "electric"], ["push", "lawn-tractor", "zero-turn"]],
  "power-tools": [["string-trimmer", "leaf-blower", "chainsaw"]], washer: [], fridge: [], dishwasher: [], "range-hood": [],
};

// The jar says which rules are allowed; tasks built without one are checked as vehicle tasks, which is what the schedule editor makes.
function makeTask(t, jar = "vehicles") {
  const name = cleanText(t.name, 80);
  if (!name) return { error: "a task needs a name" };
  const m = t.miles || null, h = t.hours || null, tm = t.time || null;
  if (!m && !h && !tm) return { error: `“${name}” needs a rule: miles, hours or time` };
  for (const [k, rule] of [["miles", m], ["hours", h], ["time", tm]]) if (rule && !(JAR_MEASURES[jar] || []).includes(k)) return { error: `“${name}” can't repeat by ${k} in the ${jar} jar` };
  if (m && h) return { error: `“${name}” can't repeat by both miles and hours` };
  if (m) {
    if (!isWhole(m.every, 1, 999999)) return { error: `“${name}” needs a whole number of miles between services` };
    if (!isWhole(m.remind, 0, 999999)) return { error: `“${name}” needs a whole number of miles for the reminder` };
  }
  if (h) {
    if (!isHours(h.every) || h.every < 0.1) return { error: `“${name}” needs hours between services from 0.1 to 99,999.9` };
    if (!isHours(h.remind)) return { error: `“${name}” needs a reminder in hours from 0 to 99,999.9` };
  }
  let time = null;
  if (tm) {
    const startDate = tm.startDate || "", af = opt(tm.activeFrom), at = opt(tm.activeTo);
    if (!isWhole(tm.n, 1, 999)) return { error: `“${name}” needs a whole number of 1 to 999 for how often` };
    if (!TIME_UNITS.includes(tm.unit)) return { error: `“${name}” needs days, weeks, months or years` };
    if (!["done", "calendar"].includes(tm.from)) return { error: `“${name}” needs to count from done or calendar` };
    if (startDate && !validISODate(startDate)) return { error: `“${name}” has a start date that isn't a real date` };
    if ((af == null) !== (at == null) || (af != null && !(isWhole(af, 1, 12) && isWhole(at, 1, 12)))) return { error: `“${name}” needs both active months, each from 1 to 12` };
    // The active-months window belongs to "from last done" tasks only (decisions.md Round 5); fixed-date tasks keep none.
    time = { n: tm.n, unit: tm.unit, from: tm.from, startDate, activeFrom: tm.from === "done" ? af : null, activeTo: tm.from === "done" ? at : null };
  }
  return { rec: { id: cleanText(t.id, 60) || newId("i"), name, miles: m && { every: m.every, remind: m.remind }, hours: h && { every: h.every, remind: h.remind }, time,
    active: t.active !== false, default: typeof t.default === "boolean" ? t.default : null } };
}
function makeThing(t) {
  const name = cleanText(t.name, 80);
  if (!name) return { error: "the thing needs a name" };
  const jar = t.jar || "vehicles";
  if (!JAR_NAMES.includes(jar)) return { error: "the jar isn't one of vehicles, home, health or finance" };
  const odometer = opt(t.odometer);
  if (odometer != null && !isWhole(odometer, 0, MAX_ODO)) return { error: "the starting odometer must be a whole number of miles" };
  const odometerDate = odometer == null ? "" : String(t.odometerDate || "");
  if (odometerDate && !validISODate(odometerDate)) return { error: "the starting odometer date isn't a real date" };
  const hours = opt(t.hours);
  if (hours != null && !isHours(hours)) return { error: "the starting hours must be a number from 0 to 99,999.9" };
  const hoursDate = hours == null ? "" : String(t.hoursDate || "");
  if (hoursDate && !validISODate(hoursDate)) return { error: "the starting hours date isn't a real date" };
  const problem = meterProblem(jar, odometer, hours);
  if (problem) return { error: problem };
  const tasks = [];
  for (const k of t.tasks || []) { const r = makeTask(k, jar); if (r.error) return r; tasks.push(r.rec); }
  const createdAt = t.createdAt || nowISO();
  const rec = { id: cleanText(t.id, 60) || newId("t"), jar, name, active: t.active !== false, odometer, odometerDate, hours, hoursDate, tasks,
    createdAt, updatedAt: t.updatedAt || createdAt };
  // Optional setup fields, each checked against its list; a bad value is left out and never blocks the thing.
  let icon = lower(t.icon);
  if (icon === "multi-unit" || icon === "business") icon = "house";
  if (ICONS[jar]?.includes(icon)) rec.icon = icon;
  const kind = lower(t.kind);
  if (jar === "home" && Object.hasOwn(KIND_TYPES, kind)) {
    rec.kind = kind;
    KIND_TYPES[kind].forEach((list, i) => { const v = lower(t["type_" + (i + 1)]); if (list.includes(v)) rec["type_" + (i + 1)] = v; });
  }
  return { rec };
}
function makeFillup(f) {
  if (!validISODate(f.date)) return { error: "the date isn't a real date" };
  if (!isWhole(f.odometer, 0, MAX_ODO)) return { error: odoProblem(f.odometer) };
  const units = opt(f.units), pricePerUnit = opt(f.pricePerUnit), total = opt(f.total);
  if (units != null && !isNum(units, 0, 999)) return { error: "gallons must be a number from 0 to 999" };
  if (pricePerUnit != null && !isNum(pricePerUnit, 0, 99.999)) return { error: "$/gallon must be a number from 0 to 99.999" };
  if (total != null && !isNum(total, 0, 99999)) return { error: "the receipt total must be a number from 0 to 99,999" };
  const createdAt = f.createdAt || nowISO();
  return { rec: { id: cleanText(f.id, 60) || newId("f"), thingId: f.thingId, date: f.date, odometer: f.odometer, units, pricePerUnit, total,
    station: cleanText(f.station, 80), missed: !!f.missed, createdAt, updatedAt: f.updatedAt || createdAt } };
}
// jar is the jar of the thing the log belongs to (vehicles when a form leaves it out). A done vehicle log needs an odometer or an hours reading,
// unless meterOptional (the Pantry Done sheet, for a vehicle with no odometer known at all; B8 decision 1).
function makeLog(s, jar = "vehicles", meterOptional = false) {
  if (!validISODate(s.date)) return { error: "the date isn't a real date" };
  const odometer = opt(s.odometer), hours = opt(s.hours), status = s.status || "done", forDue = s.forDue || "";
  if (odometer != null && !isWhole(odometer, 0, MAX_ODO)) return { error: odoProblem(odometer) };
  const taskName = cleanText(s.taskName, 120), notes = cleanNotes(s.notes, 2000);
  if (!taskName && !notes) return { error: "it needs a task or a note" };
  if (hours != null && !isHours(hours)) return { error: hoursProblem(hours) };
  if (!["done", "skipped"].includes(status)) return { error: "the status must be done or skipped" };
  if (forDue && !validISODate(forDue)) return { error: "the due date isn't a real date" };
  if (odometer == null && jar === "vehicles" && status === "done" && hours == null && !meterOptional) return { error: "the odometer must be a whole number of miles" };
  const problem = meterProblem(jar, odometer, hours);
  if (problem) return { error: problem };
  const createdAt = s.createdAt || nowISO();
  return { rec: { id: cleanText(s.id, 60) || newId("m"), thingId: s.thingId, taskId: cleanText(s.taskId, 60) || "other", taskName, date: s.date, odometer,
    hours, shop: cleanText(s.shop, 80), notes, visit: cleanText(s.visit, 60) || newId("x"), status, forDue, createdAt, updatedAt: s.updatedAt || createdAt } };
}
// ---------- Pantry Done / Skip (B8; data-layer-plan "B8 build spec") ----------
// row = the Due.pantryTasks row for this task, recomputed from S at the moment of use (pass `only` to the adapter).
// What the Done sheet asks for: one reading field or none. A vehicle time-only task still asks for the odometer (owner decision 1),
// required whenever the vehicle has an odometer reading; a miles or hours task always requires its reading.
function doneSpec(thing, task, row) {
  const meter = !!(task.miles || task.hours), field = task.hours ? "hours" : meter || thing.jar === "vehicles" ? "odometer" : null;
  if (!field) return { field: null, current: null, required: false };
  const current = (meter ? row.currentValue : row.odometerNow) ?? null;
  return { field, current, required: meter || current != null };
}
const MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (iso, today) => { const [y, m, d] = iso.split("-").map(Number); return `${MON_ABBR[m - 1]} ${d}${today && y !== +today.slice(0, 4) ? `, ${y}` : ""}`; };
const numText = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
// The reading checks (B9.3) as a result for the sheets: { error } when higher than a later reading, { lower: { typed, date } } when lower and not yet confirmed,
// else { oldValue } (the old meter's last typed value, once confirmed) or {} for a normal reading. c = Due.checkReading's answer.
function readingVerdict(c, o) {
  if (c.status === "lower") return o.confirmLower ? { oldValue: c.last.typed } : { lower: { typed: c.last.typed, date: c.last.date } };
  // later (id, store, kind, typed, date) lets the sheet draw the "See that ..." link (#13); no id (the starting value) means no link.
  if (c.status === "higher") return { error: `That's higher than a later reading (${numText(c.later.typed)} on ${dayText(c.later.date, o.today)}). Check the number or the date.`, later: c.later };
  return {};
}
// Builds the one log a Done or Skip writes: { rec } or { error } (a full sentence). o = { status, date, reading, id, today, now, data, confirmLower, changeId }.
// A reading below the highest one dated on or before the Done date returns { lower: { typed, date } } so the sheet can ask (B9.5); with confirmLower
// it returns { rec, change }: the log plus the meter-change readings row, both with the same createdAt. data = { logs, readings, fillups } of this thing.
function pantryLog(thing, task, row, o) {
  const skip = o.status === "skipped", spec = doneSpec(thing, task, row), meter = !!(task.miles || task.hours);
  if (row.stuck) return { error: "This task has no start date yet, so there is nothing to mark. Nothing was saved." }; // a log would change nothing
  const date = skip ? o.today : o.date;
  if (!validISODate(date)) return { error: "Pick a real date." };
  if (date > o.today) return { error: "Pick today or an earlier date." };
  let reading = null;
  if (skip) {
    if (meter) { reading = row.currentValue ?? null; if (reading == null && !task.time) return { error: "Add a reading first, then you can skip this." }; }
  } else if (spec.field) {
    reading = opt(o.reading);
    if (reading == null && spec.required) return { error: spec.field === "hours" ? "Enter the hours." : "Enter the odometer." };
  }
  // forDue = the due date this log closed. A Done dated before the task's latest log did not close today's due date, so it stays blank.
  const forDue = row.timeDue && (skip || !row.lastLogDate || date >= row.lastLogDate) ? row.timeDue : "";
  const now = o.now || nowISO();
  const res = makeLog({ id: o.id, thingId: thing.id, taskId: task.id, taskName: task.name, date, status: o.status, forDue, shop: "", notes: "", createdAt: now,
    odometer: spec.field === "odometer" ? reading : null, hours: spec.field === "hours" ? reading : null }, thing.jar, true);
  if (res.error) return { error: `Can't save: ${res.error}.` };
  if (skip || reading == null || !spec.field) return res;
  const v = readingVerdict(Due.checkReading(o.data || {}, thing, spec.field === "hours" ? "hours" : "miles", date, reading, now, o.today), o);
  if (v.error || v.lower) return v;
  if (v.oldValue == null) return res;
  const ch = makeReading({ id: o.changeId, thingId: thing.id, date, [spec.field]: reading, oldValue: v.oldValue, createdAt: now }, thing.jar);
  return ch.error ? { error: `Can't save: ${ch.error}.` } : { rec: res.rec, change: ch.rec };
}
// Add Reading and Log Hours (B9.1). meter "miles" writes an odometer-only fill-up, "hours" a readings row; a confirmed lower reading writes ONE readings row
// that is both the meter change and the new first reading. o = { date, value, id, changeId, today, now, data, confirmLower }.
// Returns { error } | { lower: { typed, date } } | { put, undo, change } (put and undo are shaped for commit()).
function readingPlan(thing, meter, o) {
  const miles = meter === "miles", field = miles ? "odometer" : "hours";
  if (!validISODate(o.date)) return { error: "Pick a real date." };
  if (o.date > o.today) return { error: "Pick today or an earlier date." };
  const value = opt(o.value);
  if (value == null) return { error: miles ? "Enter the odometer." : "Enter the hours." };
  const now = o.now || nowISO(), base = { thingId: thing.id, date: o.date, [field]: value, createdAt: now };
  const normal = miles ? makeFillup({ ...base, id: o.id }) : makeReading({ ...base, id: o.id }, thing.jar);
  if (normal.error) return { error: `Can't save: ${normal.error}.` };
  const v = readingVerdict(Due.checkReading(o.data || {}, thing, meter, o.date, value, now, o.today), o);
  if (v.error || v.lower) return v;
  if (v.oldValue == null) return miles ? { put: { fillups: [normal.rec] }, undo: { fillups: [normal.rec.id] }, change: false }
    : { put: { readings: [normal.rec] }, undo: { readings: [normal.rec.id] }, change: false };
  const ch = makeReading({ ...base, id: o.changeId || o.id, oldValue: v.oldValue }, thing.jar);
  return ch.error ? { error: `Can't save: ${ch.error}.` } : { put: { readings: [ch.rec] }, undo: { readings: [ch.rec.id] }, change: true };
}
// The old Enter Fill-Up and maintenance forms (B9b). recs = { fillups?, logs? } already built with createdAt = o.now (so the change row below is
// the same age and shifts none of them). Returns { error } | { lower: { typed, date } } | { put, change }; a confirmed lower odometer adds ONE readings
// change row (the fill-up or log still carries the number, as on the Done sheet). o = { date, odometer, changeId, today, now, data, confirmLower }.
function formReadingPlan(thing, recs, o) {
  const v = readingVerdict(Due.checkReading(o.data || {}, thing, "miles", o.date, o.odometer, o.now, o.today), o);
  if (v.error || v.lower) return v;
  if (v.oldValue == null) return { put: recs, change: false };
  const ch = makeReading({ id: o.changeId, thingId: thing.id, date: o.date, odometer: o.odometer, oldValue: v.oldValue, createdAt: o.now }, thing.jar);
  return ch.error ? { error: `Can't save: ${ch.error}.` } : { put: { ...recs, readings: [ch.rec] }, change: true };
}

// ---------- Edit a maintenance log (#14; docs/specs/v0.1.1-log-edit-and-error-link.md) ----------
// The reading a log edit asks for, for the chosen task and status: { field: "odometer" | "hours" | null, required }. A reading the log never had stays optional (AC 8).
function logEditSpec(thing, old, taskId, status) {
  const task = thing.tasks.find((k) => k.id === taskId), rule = !!(task && (task.miles || task.hours)), hadHours = old.hours != null && old.odometer == null;
  const field = task && task.hours ? "hours" : task && task.miles ? "odometer" : hadHours ? "hours" : thing.jar === "vehicles" ? "odometer" : Due.hasHourMeter(thing) ? "hours" : null;
  const had = old.odometer != null || old.hours != null;
  return { field, required: !!field && had && (rule || (thing.jar === "vehicles" && status === "done")) };
}
// The meter-change rows saved with this log (derived: ReadingsList.companionsOf). sole: the log is the row's only companion, so the edit may change or delete it.
const logChangeRows = (old, data) => {
  const own = { logs: data.logs, fillups: data.fillups };
  return data.readings.filter((c) => c.thingId === old.thingId && c.oldValue != null).map((c) => ({ c, all: ReadingsList.companionsOf(c, own) })).filter((x) => x.all.some((y) => y.rec.id === old.id)).map((x) => ({ c: x.c, sole: x.all.length === 1 }));
};
// One Save of the edit page. f = { taskId, taskName (when "other"), status, date, reading, shop, notes }; o = { today, now, data: { logs, readings, fillups } of this thing, confirmLower, changeId }.
// Returns { error, field } | { none: true } (nothing changed) | { lower: { typed, date } } (ask "Did you type that right?") | { put, del?, undo, toast, hint }.
// id, createdAt and visit stay as they were (the link to the change row derives from createdAt; the visit groups the logs). forDue is cleared when the task changes.
function logEditPlan(thing, old, f, o) {
  const err = (error, field) => ({ error, field });
  const task = thing.tasks.find((k) => k.id === f.taskId), taskId = f.taskId, changedTask = taskId !== old.taskId;
  if (taskId !== "other" && !task && changedTask) return err("That task is no longer there. Pick another.", "task");
  if (!validISODate(f.date)) return err("Pick a real date.", "date");
  if (f.date > o.today) return err("Pick today or an earlier date.", "date");
  const spec = logEditSpec(thing, old, taskId, f.status), field = spec.field, reading = field ? opt(f.reading) : null;
  if (reading == null && spec.required) return err(field === "hours" ? "Enter the hours." : "Enter the odometer.", "reading");
  const built = makeLog({ id: old.id, thingId: old.thingId, taskId, taskName: taskId === "other" ? f.taskName : changedTask ? task.name : old.taskName, date: f.date, status: f.status,
    forDue: changedTask ? "" : old.forDue, shop: f.shop, notes: f.notes, visit: old.visit, createdAt: old.createdAt, updatedAt: o.now,
    odometer: field === "odometer" ? reading : null, hours: field === "hours" ? reading : null }, thing.jar, true);
  if (built.error) return err(`Can't save: ${built.error}.`, /date/.test(built.error) ? "date" : /odometer|hours/.test(built.error) ? "reading" : "task");
  const rec = built.rec, n = (x) => x ?? null;
  if (["taskId", "taskName", "date", "odometer", "hours", "shop", "notes", "status", "forDue"].every((k) => n(rec[k]) === n(old[k]))) return { none: true };
  const data = o.data, meter = field === "hours" ? "hours" : "miles", day = String(thing.createdAt || "").slice(0, 10) || o.today;
  const linked = logChangeRows(old, data), sole = (linked.find((x) => x.sole) || {}).c || null;
  const moved = rec.date !== old.date || n(rec.odometer) !== n(old.odometer) || n(rec.hours) !== n(old.hours);
  const manage = rec.status === "done" && (!!sole || !linked.length); // only a Done may change, create or delete a change row
  let v = {};
  if (moved && reading != null) { // the same checks as Add Reading, with this log and its own change row left out of the neighbours, at the log's own createdAt (AC 15, 42)
    const rest = { logs: data.logs.filter((l) => l.id !== old.id), fillups: data.fillups, readings: data.readings.filter((c) => !(manage && sole && c.id === sole.id)) };
    v = readingVerdict(Due.checkReading(rest, thing, meter, rec.date, reading, old.createdAt, day), { today: o.today, confirmLower: o.confirmLower });
    if (v.error) return err(v.error, "reading");
    if (v.lower) return { lower: v.lower };
  }
  let chg = null, drop = null;
  if (manage && v.oldValue != null) {
    const m = makeReading({ id: sole ? sole.id : o.changeId, thingId: old.thingId, date: rec.date, [field]: reading, oldValue: v.oldValue, createdAt: sole ? sole.createdAt : old.createdAt, updatedAt: o.now }, thing.jar);
    if (m.error) return err(`Can't save: ${m.error}.`, "reading");
    chg = m.rec;
  } else if (manage && sole && moved) drop = sole; // the number is normal now (or gone): the change row is no longer needed
  if (chg || drop) { // AC 43: older readings must not newly go out of order once the change row is gone, moved or added
    const after = { logs: data.logs.map((l) => (l.id === old.id ? rec : l)), fillups: data.fillups, readings: [...data.readings.filter((c) => c.id !== (chg || drop).id), ...(chg ? [chg] : [])] };
    if (Due.newlyOutOfOrder(data, after, thing, meter, day)) return err("That change would leave other readings out of order. Check the date or the number.", rec.date !== old.date ? "date" : "reading");
  }
  const undo = { put: { logs: [structuredClone(old)] } };
  if (sole && (chg || drop)) undo.put.readings = [structuredClone(sole)]; else if (chg) undo.del = { readings: [chg.id] };
  const plan = { put: { logs: [rec], ...(chg ? { readings: [chg] } : {}) }, undo, toast: drop ? "Log updated. Meter change removed." : "Log updated.",
    // The log edit left a meter change alone that may need fixing (AC 24).
    hint: (v.oldValue != null && !chg) || (old.status === "done" && rec.status === "skipped" && linked.length > 0) };
  if (drop) plan.del = { readings: [drop.id] };
  return plan;
}

// Ids of the thing's meter-change readings rows to delete along with the fill-ups/logs in deleted ({ fillups: [ids], logs: [ids] }).
// The link is derived, not stored (data-layer-plan A.2; readings-list.js companionsOf: same thing, createdAt, date and typed number, a log must be Done).
// A change row goes when one of the records saved with it is deleted and none remains. recs = { fillups, logs, readings } (any thing's; only thing.id's are touched).
function changeRowsToDrop(thing, recs, deleted) {
  const mine = (a) => (a || []).filter((r) => r.thingId === thing.id);
  const gone = new Set([...(deleted.fillups || []), ...(deleted.logs || [])]), own = { logs: mine(recs.logs), fillups: mine(recs.fillups) };
  return mine(recs.readings).filter((c) => {
    if (c.oldValue == null) return false;
    const saved = ReadingsList.companionsOf(c, own);
    return saved.length > 0 && saved.every((x) => gone.has(x.rec.id));
  }).map((c) => c.id);
}

// An hour-meter reading, or a meter change when oldValue is set (data-model 2.3, 3.3b). A reading is hours or an odometer, never both.
function makeReading(r, jar = "vehicles") {
  if (!validISODate(r.date)) return { error: "the date isn't a real date" };
  const hours = opt(r.hours), odometer = opt(r.odometer), oldValue = opt(r.oldValue);
  if (hours != null && !isHours(hours)) return { error: hoursProblem(hours) };
  if (odometer != null && !isWhole(odometer, 0, MAX_ODO)) return { error: odoProblem(odometer) };
  if (oldValue != null && !isNum(oldValue, 0, MAX_ODO)) return { error: "the old reading must be a number" };
  if (hours == null && odometer == null) return { error: "a reading needs hours or an odometer" };
  if (hours != null && odometer != null) return { error: "a reading is hours or an odometer, not both" };
  const problem = meterProblem(jar, odometer, hours);
  if (problem) return { error: problem };
  const createdAt = r.createdAt || nowISO();
  return { rec: { id: cleanText(r.id, 60) || newId("r"), thingId: r.thingId, date: r.date, hours, odometer, oldValue, createdAt, updatedAt: r.updatedAt || createdAt } };
}
const fillupKey = (f) => `${f.thingId}|${f.date}|${f.odometer}`;
const logKey = (s) => [s.thingId, s.date, s.odometer, s.taskId, lower(s.taskName), s.notes, s.status, s.hours].join("|");
const readingKey = (r) => [r.thingId, r.date, r.hours, r.odometer, r.oldValue].join("|");

// ---------- Storage (IndexedDB) ----------
// Stores: things (tasks embedded), logs (maintenance), readings, fillups, settings ({ key, value }: shops, lastExport, lastChange).
// Its own name, not the Vehicle Maintenance App's: both apps may share one web address (and so one browser storage).
// Version 2 is a clean break (decisions.md, "Data layer"): the upgrade deletes every store it finds and creates these five empty.
const APP_VERSION = "0.1.0"; // shown in Settings > About (spec 4.10 AC 10)
const DB_NAME = "pickle-it";
const DB_VERSION = 2;
let idb = null;
const noShops = () => ({ vehicles: [], home: [], health: [], finance: [] });
const S = { things: [], fillups: [], logs: [], readings: [], shops: noShops(), lastExport: null, lastChange: null, hiddenJars: [] };

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
// onBlocked runs if another tab still has an older version open; the open then finishes by itself once that tab closes.
function openDB(onBlocked) {
  return new Promise((res, rej) => {
    if (!("indexedDB" in self)) { rej(new Error("no-indexeddb")); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    // One versionchange transaction: if anything here throws the browser aborts it and the old database stays as it was.
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of [...d.objectStoreNames]) d.deleteObjectStore(n);
      for (const s of ["things", "logs", "readings", "fillups"]) d.createObjectStore(s, { keyPath: "id" });
      d.createObjectStore("settings", { keyPath: "key" });
    };
    r.onsuccess = () => { idb = r.result; idb.onversionchange = () => idb.close(); res(idb); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => onBlocked?.();
  });
}
const getAll = (store) => reqP(idb.transaction(store).objectStore(store).getAll());
const byCreated = (a, b) => cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id);

async function reload() {
  const [t, f, l, r, settings] = await Promise.all(["things", "fillups", "logs", "readings", "settings"].map(getAll));
  S.things = t.sort(byCreated);
  S.fillups = f;
  S.logs = l;
  S.readings = r;
  const set = Object.fromEntries(settings.map((x) => [x.key, x.value]));
  S.shops = noShops();
  for (const j of JAR_NAMES) if (Array.isArray(set.shops?.[j])) S.shops[j] = set.shops[j];
  S.lastExport = set.lastExport || null;
  S.lastChange = set.lastChange || null;
  S.hiddenJars = cleanHidden(set.hiddenJars); // a settings key (already in the v2 schema); not exported
}

// Saves a set of changes in one transaction (all or nothing), then reloads S.
// changes = { clear: [stores], del: { store: [ids] }, put: { store: [records] }, settings: { key: value } }
async function save(changes, { touch = true } = {}) {
  const stores = new Set(["settings", ...(changes.clear || []), ...Object.keys(changes.del || {}), ...Object.keys(changes.put || {})]);
  await new Promise((res, rej) => {
    const t = idb.transaction([...stores], "readwrite");
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("The save was cancelled."));
    try {
      for (const s of changes.clear || []) t.objectStore(s).clear();
      for (const [s, ids] of Object.entries(changes.del || {})) for (const id of ids) t.objectStore(s).delete(id);
      for (const [s, recs] of Object.entries(changes.put || {})) for (const r of recs) t.objectStore(s).put(r);
      for (const [k, v] of Object.entries(changes.settings || {})) t.objectStore("settings").put({ key: k, value: v });
      if (touch) t.objectStore("settings").put({ key: "lastChange", value: nowISO() });
    } catch (e) { try { t.abort(); } catch {} rej(e); }
  });
  await reload();
}

// ---------- Settings: appearance, hidden jars, Delete All Data ----------
const PREF_PREFIX = "pickle-it:"; // every localStorage key this app writes starts with this
const PALETTES = [["green", "Green"], ["blue", "Blue"], ["red", "Red"], ["orange", "Orange"], ["purple", "Purple"], ["teal", "Teal"], ["mono", "Mono"]];
const normTheme = (v) => (v === "light" || v === "dark" ? v : "system");
const normPalette = (v) => (PALETTES.some(([k]) => k === v) ? v : "green");
// Stored list of hidden jars: known ids only, in jar order. All four hidden can only come from a bad file, so show them all.
const cleanHidden = (v) => { const h = JAR_NAMES.filter((j) => Array.isArray(v) && v.includes(j)); return h.length >= JAR_NAMES.length ? [] : h; };
// The hidden list after showing or hiding one jar, or null when that would hide the last shown jar (spec 4.10 AC 7).
function withJarShown(hidden, jar, show) {
  const set = new Set(hidden); if (show) set.delete(jar); else set.add(jar);
  return set.size >= JAR_NAMES.length ? null : JAR_NAMES.filter((j) => set.has(j));
}
// Collect first, then remove: removing while indexing localStorage skips keys (privacy review 2026-11-05 M1).
const prefKeys = (store) => { const ks = []; for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(PREF_PREFIX)) ks.push(k); } return ks; };
const wipePrefs = (store) => { const ks = prefKeys(store); for (const k of ks) store.removeItem(k); return ks.length; };
// "A delete was started" marker. Set before the database delete, and removed with the other pickle-it: keys once it succeeds. If the page is reloaded
// first (a blocked delete), boot finishes the job: database empty -> wipePrefs ("finished"); data still there -> the delete never ran, drop the marker ("abandoned").
const WIPE_KEY = PREF_PREFIX + "wipe";
const finishWipe = (store, dataIsEmpty) => {
  if (!store.getItem(WIPE_KEY)) return "none";
  if (dataIsEmpty) { wipePrefs(store); return "finished"; }
  store.removeItem(WIPE_KEY); return "abandoned";
};
// A hidden jar's address opens the Pantry instead (QA S1 ruling). "vehicles-jar" is the Vehicles jar page. "vehicles" and "log" are the Fill-Ups and History page, which stays
// reachable with the jar hidden (owner, 2026-11-14, QA M-4: Enter Fill-Up must keep working).
const routeAround = (screen, hidden) => {
  const jar = screen === "vehicles-jar" ? "vehicles" : screen;
  return screen !== "vehicles" && JAR_NAMES.includes(jar) && hidden.includes(jar) ? "pantry" : screen;
};
// Closes this tab's connection and deletes the whole database by its exact name. Resolves only on success; onBlocked runs while another tab holds it open.
function deleteDB(onBlocked) {
  return new Promise((res, rej) => {
    if (idb) { idb.close(); idb = null; }
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error || new Error("The delete failed."));
    r.onblocked = () => onBlocked?.();
  });
}

// Ask the browser not to clear this site's data when space runs low. Returns true, false or null (not supported).
async function askPersist() {
  if (!navigator.storage?.persist) return null;
  try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { return false; }
}

const thingById = (id) => S.things.find((v) => v.id === id) || null;
const fillupsFor = (id) => S.fillups.filter((f) => f.thingId === id);
const logsFor = (id) => S.logs.filter((s) => s.thingId === id);
const readingsFor = (id) => S.readings.filter((r) => r.thingId === id);
// Everything the backup reminder counts (spec 4.9 AC 6): things and tasks as well as readings, fill-ups and logs, all jars.
const recordCount = () => S.things.length + S.things.reduce((n, t) => n + t.tasks.length, 0) + S.fillups.length + S.logs.length + S.readings.length;
const daysAgo = (iso) => Math.round((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 864e5);
// The backup nudge. Never exported: not on day one; once there are 20 entries of the person's own history (logs, readings, fill-ups; starter tasks do not count) or the first thing is 7 days old, whichever comes first. Exported before: 30 days and changed since.
const BACKUP_MIN_RECORDS = 20, BACKUP_MIN_DAYS = 7;
const historyCount = () => S.fillups.length + S.logs.length + S.readings.length;
function backupDue() {
  const n = recordCount();
  if (!n || (S.lastExport && S.lastChange && S.lastChange <= S.lastExport)) return null;
  if (!S.lastExport) {
    const first = S.things.map((t) => t.createdAt).filter(Boolean).sort()[0];
    return historyCount() >= BACKUP_MIN_RECORDS || (first && daysAgo(isoDate(new Date(first))) >= BACKUP_MIN_DAYS) ? { never: true } : null;
  }
  const days = daysAgo(isoDate(new Date(S.lastExport)));
  return days >= 30 ? { days } : null;
}
const shopCount = (shops) => JAR_NAMES.reduce((n, j) => n + shops[j].length, 0);
const vehicleThings = () => S.things.filter((v) => v.jar === "vehicles"); // the vehicle screens show these only

// ---------- MPG math ----------
// Trip = this fill-up's odometer minus the previous one's; MPG = trip / gallons bought at this fill-up.
// Lifetime and 2-month MPG are total miles / total gallons, so long trips weigh more than short ones.
const WARN_PCT = 0.20;  // warn when a fill-up is this far above or below the vehicle's average
// A stretch whose MPG is far above the vehicle's usual (median) MPG means fill-ups in between weren't logged,
// so it's left out. It adapts to each vehicle, so a hybrid isn't flagged for being efficient.
const GAP_RATIO = 1.6, GAP_MIN_TRIPS = 4;

function twoMonthsBefore(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 3, d)).toISOString().slice(0, 10);
}
function ratio(trips) { const m = trips.reduce((s, t) => s + t.miles, 0), g = trips.reduce((s, t) => s + t.units, 0); return g > 0 ? m / g : null; }
function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

// One row per fill-up (a record with a numeric odometer and gallons > 0), in odometer order: Map id -> { r, trip, mpg, kept, missed, gap, deviation, flagged }.
// trip = miles since the vehicle's previous fill-up in the current meter's terms (null for the first, or when the difference is 0 or less); mpg = trip / gallons;
// kept = the stretch counts toward lifetime MPG; deviation = (mpg - average of the kept trips before this row) / that average (null for none, or a missed row). Nothing is stored.
// changes = the thing's readings rows: a miles meter change shifts the fill-ups before it into the current meter's terms for the trip math (B9.8).
function fillupRows(recs, changes = []) {
  const odo = (r) => r.odometer + (changes.length ? Due.shiftOf(r, changes, "miles") : 0);
  // Only records with gallons are fill-ups: a trip runs from the previous one of those. An odometer-only record is a reading and is left out.
  const sorted = recs.filter((r) => Number.isFinite(+r.odometer) && +r.units > 0)
    .sort((a, b) => odo(a) - odo(b) || cmp(String(a.date), String(b.date)) || cmp(String(a.createdAt), String(b.createdAt)));
  const rows = new Map(), cands = [];
  sorted.forEach((r, i) => {
    const miles = i ? odo(r) - odo(sorted[i - 1]) : 0, has = miles > 0;
    const row = { r, trip: has ? miles : null, mpg: has ? miles / r.units : null, kept: false, missed: has && r.missed === true, gap: false, deviation: null, flagged: false };
    rows.set(r.id, row);
    if (has) cands.push(row);
  });
  const usual = cands.length >= GAP_MIN_TRIPS ? median(cands.filter((c) => !c.r.missed).map((c) => c.mpg)) : null;
  const keptSoFar = [];
  for (const c of cands) {
    c.gap = !c.r.missed && !!usual && c.mpg > usual * GAP_RATIO;
    c.kept = !c.r.missed && !c.gap;
    const avg = c.missed ? null : ratio(keptSoFar);
    if (avg) { c.deviation = (c.mpg - avg) / avg; c.flagged = Math.abs(c.deviation) >= WARN_PCT; }
    if (c.kept) keptSoFar.push({ miles: c.trip, units: +c.r.units });
  }
  return rows;
}
function vehicleStats(recs, changes = []) {
  const rows = [...fillupRows(recs, changes).values()];
  const trips = rows.filter((x) => x.kept).map((x) => ({ id: x.r.id, date: x.r.date, odometer: x.r.odometer, miles: x.trip, units: +x.r.units, mpg: x.mpg }));
  const gaps = rows.filter((x) => x.trip != null && !x.kept).length;
  for (const t of trips) { const from = twoMonthsBefore(t.date); t.running = ratio(trips.filter((u) => u.date >= from && u.date <= t.date)); }
  const latest = trips[trips.length - 1] || null;
  const priorAvg = ratio(trips.slice(0, -1));
  const deviation = latest && priorAvg ? (latest.mpg - priorAvg) / priorAvg : null;
  return { fillups: rows.length, gaps, trips, lifetime: ratio(trips), twoMonth: latest ? latest.running : null, latest, priorAvg,
    deviation, flagged: deviation != null && Math.abs(deviation) >= WARN_PCT };
}

// The Vehicles page's Recent Fill-Ups: every vehicle's fill-ups (inactive ones too), newest first: date, then when it was entered, then id (a stable order on every device).
// Each entry is { v, r, row }, with row from fillupRows for that vehicle alone, so Trip is against the same vehicle's previous fill-up.
function recentFillups(vehicles, fillups, readings) {
  const out = [];
  for (const v of vehicles) {
    const rows = fillupRows(fillups.filter((f) => f.thingId === v.id), readings.filter((r) => r.thingId === v.id));
    for (const [, row] of rows) out.push({ v, r: row.r, row });
  }
  return out.sort((a, b) => cmp(b.r.date, a.r.date) || cmp(String(b.r.createdAt || ""), String(a.r.createdAt || "")) || cmp(b.r.id, a.r.id));
}

// ---------- Maintenance math ----------
// The current odometer in the current meter's terms (a miles meter change shifts older entries), with the date of that entry. A log with no odometer is no reading.
function latestOdo(thingId) {
  const v = thingById(thingId);
  if (!v) return null;
  const { es } = Due.meterEntries("miles", logsFor(thingId), Due.meterSources(v, fillupsFor(thingId), readingsFor(thingId), today()));
  const best = es.reduce((a, e) => (!a || e.v > a.v ? e : a), null);
  return best ? { odometer: best.v, date: best.date } : null;
}
// Until a service is logged, assume it was done at the last regular interval (e.g. oil every 5,000: last at 85,000).
const scheduledDue = (it, odo) => Math.max(it.every, Math.ceil(odo / it.every) * it.every);
function lastLogged(thingId, taskId) {
  let best = null;
  for (const s of S.logs) {
    if (s.thingId !== thingId || s.taskId !== taskId || s.odometer == null) continue;
    if (!best || s.odometer > best.odometer || (s.odometer === best.odometer && cmp(String(s.createdAt), String(best.createdAt)) > 0)) best = s;
  }
  return best;
}
function maintStatus(thingId) {
  const v = thingById(thingId), cur = latestOdo(thingId);
  if (!v || !v.tasks.some((t) => t.miles) || !cur) return null;
  // Miles tasks only for now: each row carries every/remind flat, which is what the screens read.
  const rows = v.tasks.filter((t) => t.miles).map((t) => {
    const it = { id: t.id, name: t.name, every: t.miles.every, remind: t.miles.remind };
    const logged = lastLogged(thingId, it.id);
    const due = logged ? logged.odometer + Due.shiftOf(logged, readingsFor(thingId), "miles") + it.every : scheduledDue(it, cur.odometer);
    const assumedLast = logged || due - it.every <= 0 ? null : due - it.every;
    const left = due - cur.odometer;
    return { ...it, logged, assumedLast, due, left, soon: left <= it.remind };
  }).sort((a, b) => a.left - b.left);
  return { thingId, name: v.name, odo: cur.odometer, asOf: cur.date, rows, soon: rows.filter((r) => r.soon) };
}
const dueSoonAll = () => S.things.filter((v) => v.active).map((v) => maintStatus(v.id)).filter((s) => s && s.soon.length);

// ---------- CSV export ----------
// One file with everything: things in all four jars and their tasks, shops, fill-ups, logs and readings.
// record_type says what each row is: thing, task, log, reading, fillup or shop. Dates are YYYY-MM-DD.
// Columns that don't apply to a row are left blank. The column guide is docs/specs/example-backup-columns.md.
// format_version is on every row. Bump CSV_FORMAT_VERSION whenever the columns or their meaning change.
const CSV_FORMAT_VERSION = 2;
const CSV_COLUMNS = ["record_type", "format_version", "jar", "thing", "thing_id", "task", "task_id", "entry_id", "created_at", "updated_at", "date",
  "old_reading", "odometer", "hours", "units", "price_per_unit", "total", "station", "missed", "shop", "notes", "every_miles", "remind_miles",
  "every_hours", "remind_hours", "every_time", "time_unit", "count_from", "start_date", "active_from", "active_to", "active", "status", "due_for",
  "visit", "default", "icon", "kind", "type_1", "type_2", "type_3"];
// The id columns are in here too: the importer only accepts safe ids, so this is a second lock on the way out.
const CSV_TEXT = new Set(["thing", "station", "shop", "task", "notes", "icon", "kind", "type_1", "type_2", "type_3", "thing_id", "task_id", "entry_id", "visit"]);
// Excel runs text starting with = + - @ as a formula. Such text gets a leading ' on export, removed again on import.
const FORMULA_START = /^'*[=+\-@\t\r]/;

function csvCell(col, value) {
  let s = value == null ? "" : String(value);
  if (CSV_TEXT.has(col) && FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCSV() {
  const lines = [CSV_COLUMNS.join(",")];
  const add = (o) => lines.push(CSV_COLUMNS.map((c) => csvCell(c, c === "format_version" ? CSV_FORMAT_VERSION : o[c])).join(","));
  const order = new Map(S.things.map((v, i) => [v.id, i]));
  const vName = (id) => thingById(id)?.name ?? "";
  const jarOf = (id) => thingById(id)?.jar ?? "vehicles";
  const yn = (b) => (b ? "yes" : "no");
  const byThingThenDate = (a, b) => (order.get(a.thingId) ?? 1e9) - (order.get(b.thingId) ?? 1e9) || cmp(a.date, b.date)
    || (a.odometer ?? 0) - (b.odometer ?? 0) || cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id);
  // shortcut: a thing has one date column, so a thing with both a starting odometer and starting hours writes the odometer's date for both; upgrade with a column.
  for (const v of S.things) add({ record_type: "thing", jar: v.jar, thing: v.name, thing_id: v.id, created_at: v.createdAt, updated_at: v.updatedAt,
    date: v.odometer != null ? v.odometerDate : v.hours != null ? v.hoursDate : "", odometer: v.odometer, hours: v.hours, active: yn(v.active),
    icon: v.icon, kind: v.kind, type_1: v.type_1, type_2: v.type_2, type_3: v.type_3 });
  for (const v of S.things) for (const t of v.tasks) add({ record_type: "task", jar: v.jar, thing: v.name, thing_id: v.id, task: t.name, task_id: t.id,
    every_miles: t.miles?.every, remind_miles: t.miles?.remind, every_hours: t.hours?.every, remind_hours: t.hours?.remind,
    every_time: t.time?.n, time_unit: t.time?.unit, count_from: t.time?.from, start_date: t.time?.startDate, active_from: t.time?.activeFrom, active_to: t.time?.activeTo,
    active: yn(t.active), default: t.default == null ? "" : yn(t.default) });
  for (const j of JAR_NAMES) for (const s of S.shops[j]) add({ record_type: "shop", jar: j, shop: s });
  for (const f of [...S.fillups].sort(byThingThenDate)) add({ record_type: "fillup", jar: jarOf(f.thingId), thing: vName(f.thingId), date: f.date, odometer: f.odometer, units: f.units,
    price_per_unit: f.pricePerUnit, total: f.total, station: f.station, missed: f.missed ? "yes" : "", thing_id: f.thingId, entry_id: f.id, created_at: f.createdAt });
  for (const m of [...S.logs].sort(byThingThenDate)) add({ record_type: "log", jar: jarOf(m.thingId), thing: vName(m.thingId), date: m.date, odometer: m.odometer, hours: m.hours, shop: m.shop,
    task: m.taskName, notes: m.notes, status: m.status, due_for: m.forDue, thing_id: m.thingId, task_id: m.taskId, visit: m.visit, entry_id: m.id, created_at: m.createdAt });
  for (const r of [...S.readings].sort(byThingThenDate)) add({ record_type: "reading", jar: jarOf(r.thingId), thing: vName(r.thingId), date: r.date, old_reading: r.oldValue,
    odometer: r.odometer, hours: r.hours, thing_id: r.thingId, entry_id: r.id, created_at: r.createdAt });
  return lines.join("\r\n") + "\r\n";
}
const exportFileName = () => `pickle-it-${today()}.csv`;

// ---------- CSV import: reading the file ----------
async function readTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { text = new TextDecoder("windows-1252").decode(buf); } // Excel's plain "CSV (Comma delimited)"
  return text.replace(/^\ufeff/, "");
}
// Comma, semicolon (Excel in many European languages) or tab, whichever the header row uses most.
function detectDelimiter(text) {
  const first = text.split(/\r\n|\n|\r/, 1)[0] || "";
  let best = ",", n = -1;
  for (const d of [",", ";", "\t"]) { const c = first.split(d).length - 1; if (c > n) { best = d; n = c; } }
  return best;
}
// RFC 4180 parser. Each row remembers the line it starts on, so errors can point at a line number.
function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = "", inQ = false, line = 1, rowLine = 1, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); rows.push({ cells: row, line: rowLine });
      row = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++; line++; rowLine = line; continue;
    }
    field += c; i++;
  }
  if (inQ) return { rows, unclosedAt: rowLine };
  if (field !== "" || row.length) { row.push(field); rows.push({ cells: row, line: rowLine }); }
  return { rows, unclosedAt: null };
}
function normalizeHeader(h) {
  const k = String(h).replace(/^\ufeff/, "").trim().toLowerCase().replace(/[\s\-/.]+/g, "_").replace(/[^a-z0-9_$]/g, "");
  return k;
}
// Numbers: tolerate $ signs and thousands separators. With semicolon files, a comma is the decimal point.
function parseNumber(raw, decimalComma, whole) {
  let s = String(raw).replace(/[\s$\u00a0]/g, "");
  if (!s) return null;
  if (whole && /^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else if (decimalComma) { if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); }
  else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
}
function parseBool(raw, dflt) {
  const s = lower(raw);
  if (!s) return dflt;
  if (["yes", "y", "true", "1", "x", "✓"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return undefined;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Dates: YYYY-MM-DD, or what Excel writes after re-saving: M/D/YYYY (or D/M/YYYY in other languages), 14-Oct-26, serial numbers.
function parseDateCell(raw, dayFirst) {
  const s = String(raw).trim();
  if (!s) return { iso: null };
  let y, m, d, t;
  if ((t = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) [, y, m, d] = t;
  else if ((t = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?: .*)?$/))) {
    const a = +t[1], b = +t[2];
    y = t[3];
    [m, d] = dayFirst || s.includes(".") ? [b, a] : [a, b];
  } else if ((t = s.match(/^(\d{1,2})[-\s]([a-z]{3,})\.?[-\s,]+(\d{4}|\d{2})$/i)) && MONTHS.includes(t[2].slice(0, 3).toLowerCase())) {
    [d, m, y] = [t[1], MONTHS.indexOf(t[2].slice(0, 3).toLowerCase()) + 1, t[3]];
  } else if ((t = s.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i)) && MONTHS.includes(t[1].slice(0, 3).toLowerCase())) {
    [m, d, y] = [MONTHS.indexOf(t[1].slice(0, 3).toLowerCase()) + 1, t[2], t[3]];
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    return validISODate(dt.toISOString().slice(0, 10)) ? { iso: dt.toISOString().slice(0, 10) } : { error: true };
  } else return { error: true };
  if (String(y).length === 2) y = (+y < 70 ? 2000 : 1900) + +y;
  const iso = `${String(y).padStart(4, "0")}-${pad2(+m)}-${pad2(+d)}`;
  return validISODate(iso) ? { iso } : { error: true };
}
function parseTimestamp(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return s; // ours: keep exactly
  const t = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/); // Excel: M/D/YYYY H:MM
  const ms = t ? new Date(+t[3], +t[1] - 1, +t[2], +t[4], +t[5], +(t[6] || 0)).getTime() : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
const unFormula = (s) => (/^'+[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
// File text echoed in a message: control and direction-changing characters out, cut to 80 characters.
const SHOWN_MAX = 80;
function shown(raw) {
  const s = Array.from(String(raw ?? "")).slice(0, SHOWN_MAX * 2).join("").replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  const cp = Array.from(s);
  return cp.length > SHOWN_MAX ? cp.slice(0, SHOWN_MAX).join("").trim() + "…" : s;
}

// ---------- CSV import: checking every row ----------
// Returns what's in the file plus any bad rows (with line numbers). Nothing is saved here.
const RECORD_TYPES = new Set(["thing", "task", "log", "reading", "fillup", "shop"]); // a Set, so "constructor" or "__proto__" is not a type
const ROW_LABEL = { task: "Task", log: "Log", reading: "Reading", fillup: "Fill-up", shop: "Shop" };
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$/; // no leading - or ~, so an id is never a formula and never looks like a visit placeholder
const MAX_IMPORT_CHARS = 20 * 1024 * 1024, MAX_DATA_ROWS = 100000, MAX_BAD = 1000;

// A name that is free in `taken` (a Set of nameKeys): "Fridge" becomes "Fridge 2", "Fridge 3"... cut to fit 80 characters.
function freeName(name, taken) {
  for (let k = 2; ; k++) {
    const suffix = " " + k, n = Array.from(name).slice(0, 80 - suffix.length).join("").trim() + suffix;
    if (!taken.has(nameKey(n))) return n;
  }
}

function analyzeImport(text) {
  const out = { fatal: null, bad: [], badCount: 0, things: [], tasks: [], shops: noShops(), fillups: [], logs: [], readings: [], renamed: [], rows: 0 };
  if (!text.trim()) { out.fatal = "This file is empty."; return out; }
  if (text.length > MAX_IMPORT_CHARS) { out.fatal = "This file is too big to be a backup from this app."; return out; }
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 4000))) { out.fatal = "This isn't a CSV file. Choose the .csv file you exported from Pickle It."; return out; }
  const delim = detectDelimiter(text);
  const { rows, unclosedAt } = parseCSV(text, delim);
  const hi = rows.findIndex((r) => r.cells.some((c) => c.trim()));
  if (hi < 0) { out.fatal = "This file is empty."; return out; }
  const col = new Map();
  rows[hi].cells.map(normalizeHeader).forEach((h, i) => { if (h && !col.has(h)) col.set(h, i); });
  if (!col.has("record_type") || !col.has("format_version")) {
    out.fatal = "This isn't a Pickle It backup.";
    return out;
  }
  const decimalComma = delim === ";";
  const cell = (r, name) => (col.has(name) ? String(r.cells[col.get(name)] ?? "").trim() : "");
  const text1 = (r, name) => unFormula(cell(r, name));
  const allRows = rows.slice(hi + 1).filter((r) => r.cells.some((c) => c.trim()));
  if (allRows.length > MAX_DATA_ROWS) { out.fatal = `This file has more than ${MAX_DATA_ROWS.toLocaleString("en-US")} rows, which is more than a Pickle It backup holds.`; return out; }
  out.rows = allRows.length;
  // Only the first MAX_BAD bad rows are kept; badCount still counts them all.
  const bad = (r, msg) => { out.badCount++; if (out.bad.length < MAX_BAD) out.bad.push({ line: r.line, msg }); };
  const data = [];
  for (const r of allRows) {
    const raw = cell(r, "format_version"), v = Number(raw);
    if (!raw) { bad(r, "no format_version, so this row is skipped."); continue; } // 4.22 AC 4: skipped and listed; later passes never see it
    if (!Number.isInteger(v) || v < 1) { out.fatal = `Line ${r.line}: format_version “${shown(raw)}” isn't a version number.`; return out; }
    if (v > CSV_FORMAT_VERSION) { out.fatal = "This backup was made by a newer version of Pickle It. Update the app (close it fully and open it again), then import the file again."; return out; }
    data.push(r);
  }

  // Day-first dates (D/M/YYYY) if any slash date in the file can only be read that way.
  let df = 0, mf = 0;
  for (const r of data) {
    const t = cell(r, "date").match(/^(\d{1,2})[/\-](\d{1,2})[/\-]\d{2,4}/);
    if (t) { if (+t[1] > 12) df++; if (+t[2] > 12) mf++; }
  }
  const dayFirst = df > 0 && mf === 0;
  const num = (r, name, label, whole) => {
    const raw = cell(r, name), v = parseNumber(raw, decimalComma, whole);
    if (Number.isNaN(v)) return { error: `${label} “${shown(raw)}” isn't a number` };
    if (whole && v != null && !Number.isInteger(v)) return { error: `${label} “${shown(raw)}” must be a whole number` };
    return { v };
  };
  const hrs = (r, name) => { const n = num(r, name, name); return n.v == null || n.error ? n : { v: Math.round(n.v * 10) / 10 }; }; // hours take one decimal
  const date = (r, name = "date") => {
    const raw = cell(r, name), d = parseDateCell(raw, dayFirst);
    return d.error ? { error: `${name} “${shown(raw)}” isn't a real date` } : { v: d.iso };
  };
  const jarOf = (r) => { const j = lower(cell(r, "jar")); return j === "" ? "vehicles" : JAR_NAMES.includes(j) ? j : null; };
  const badJar = (r) => `jar “${shown(cell(r, "jar"))}” isn't one of vehicles, home, health or finance`;
  // Ids must be plain safe words. Anything else gets a new id, the same new id wherever the same bad value appears in the file;
  // an entry_id (its own row's id) gets a fresh one.
  const idMap = new Map();
  const idc = (r, name) => {
    const raw = cell(r, name);
    if (!raw || ID_RE.test(raw)) return raw;
    if (name === "entry_id") return newId("z");
    if (!idMap.has(raw)) idMap.set(raw, newId("z"));
    return idMap.get(raw);
  };
  // An id that is a name every object already has (__proto__, constructor, toString...) makes the row bad: ids are used as lookup keys.
  const protoId = (r, label) => { for (const c of ["thing_id", "task_id", "entry_id", "visit"]) { const v = cell(r, c); if (v && v in Object.prototype) return `${label}: ${c} “${shown(v)}” isn't allowed as an id.`; } return ""; };
  const baseTime = Date.now();

  // Things first, so the other rows can refer to them wherever they are in the file.
  const cands = [], thingLine = new Map();
  data.forEach((r, idx) => {
    if (lower(cell(r, "record_type")) !== "thing") return;
    const jar = jarOf(r);
    if (!jar) return bad(r, `Thing: ${badJar(r)}.`);
    const pe = protoId(r, "Thing"); if (pe) return bad(r, pe);
    const o = num(r, "odometer", "odometer", true), h = hrs(r, "hours"), d = cell(r, "date") ? date(r) : { v: "" };
    const e = o.error || h.error || d.error;
    if (e) return bad(r, `Thing: ${e}.`);
    const active = parseBool(cell(r, "active"), true);
    if (active === undefined) return bad(r, `Thing: active should be yes or no, not “${shown(cell(r, "active"))}”.`);
    const id = idc(r, "thing_id"), name = text1(r, "thing");
    if (id && thingLine.has(id)) return bad(r, `Thing “${shown(name)}” is already listed on line ${thingLine.get(id)}.`);
    const createdAt = parseTimestamp(cell(r, "created_at")) || new Date(baseTime + idx).toISOString();
    const res = makeThing({ id, jar, name, active, odometer: o.v, odometerDate: d.v || today(), hours: h.v, hoursDate: d.v || today(), tasks: [], createdAt,
      updatedAt: parseTimestamp(cell(r, "updated_at")) || createdAt, icon: text1(r, "icon"), kind: text1(r, "kind"),
      type_1: text1(r, "type_1"), type_2: text1(r, "type_2"), type_3: text1(r, "type_3") });
    if (res.error) return bad(r, `Thing: ${res.error}.`);
    thingLine.set(res.rec.id, r.line);
    cands.push({ rec: res.rec, line: r.line });
  });
  // Two things in one jar with the same name: both are kept and the later one is renamed (data-model 7.2). Names already in the file are never reused.
  const takenIn = Object.fromEntries(JAR_NAMES.map((j) => [j, new Set()]));
  for (const c of cands) takenIn[c.rec.jar].add(nameKey(c.rec.name));
  const fileById = new Map(), firstOf = new Map(); // firstOf: jar|name -> the first thing of that name, for rows that give a name and no id
  for (const c of cands) {
    const jar = c.rec.jar, k = jar + "|" + nameKey(c.rec.name);
    if (firstOf.has(k)) {
      const to = freeName(c.rec.name, takenIn[jar]);
      out.renamed.push({ jar, from: c.rec.name, to, line: c.line });
      takenIn[jar].add(nameKey(to));
      c.rec.name = to;
      if (!firstOf.has(jar + "|" + nameKey(to))) firstOf.set(jar + "|" + nameKey(to), c);
    } else firstOf.set(k, c);
    out.things.push(c);
    fileById.set(c.rec.id, c);
  }

  const seenShops = Object.fromEntries(JAR_NAMES.map((j) => [j, new Set()])), visitKeys = new Map(), taskSeen = new Map();
  data.forEach((r, idx) => {
    const rawType = cell(r, "record_type"), type = lower(rawType);
    if (!RECORD_TYPES.has(type)) return bad(r, rawType ? `record_type “${shown(rawType)}” isn't one of thing, task, log, reading, fillup or shop.` : "record_type is blank.");
    if (type === "thing") return;
    const label = ROW_LABEL[type], jar = jarOf(r);
    if (!jar) return bad(r, `${label}: ${badJar(r)}.`);
    const pe = type === "shop" ? "" : protoId(r, label); if (pe) return bad(r, pe);
    if (type === "shop") {
      const name = cleanText(text1(r, "shop"), 80);
      if (!name) return bad(r, "Shop: the shop name is blank.");
      if (!seenShops[jar].has(shopKey(name))) { seenShops[jar].add(shopKey(name)); out.shops[jar].push(name); }
      return;
    }
    // A row finds its thing by thing_id, and by name (in its own jar) only when it has no thing_id.
    const rid = idc(r, "thing_id"), rname = text1(r, "thing");
    if (!rid && !rname) return bad(r, `${label}: the thing is blank.`);
    const fv = rid ? fileById.get(rid) : firstOf.get(jar + "|" + nameKey(rname));
    const rowJar = fv ? fv.rec.jar : jar;
    const base = { vref: fv ? { file: fv } : { id: rid, name: rname, jar }, jar: rowJar, line: r.line };
    const created = parseTimestamp(cell(r, "created_at")) || new Date(baseTime + idx).toISOString();
    if (type === "task") {
      const mi = num(r, "every_miles", "every_miles", true), mr = num(r, "remind_miles", "remind_miles", true), ho = hrs(r, "every_hours"), hr = hrs(r, "remind_hours");
      const tn = num(r, "every_time", "every_time", true), af = num(r, "active_from", "active_from", true), at = num(r, "active_to", "active_to", true);
      const e = mi.error || mr.error || ho.error || hr.error || tn.error || af.error || at.error;
      if (e) return bad(r, `Task: ${e}.`);
      let time = null;
      if (tn.v != null) {
        const unit = lower(cell(r, "time_unit")), from = lower(cell(r, "count_from")) || "done", sd = date(r, "start_date");
        if (!TIME_UNITS.includes(unit)) return bad(r, `Task: time_unit “${shown(cell(r, "time_unit"))}” should be day, week, month or year.`);
        if (!["done", "calendar"].includes(from)) return bad(r, `Task: count_from “${shown(cell(r, "count_from"))}” should be done or calendar.`);
        if (sd.error) return bad(r, `Task: ${sd.error}.`);
        time = { n: tn.v, unit, from, startDate: sd.v || "", activeFrom: af.v, activeTo: at.v };
      }
      const active = parseBool(cell(r, "active"), true);
      if (active === undefined) return bad(r, `Task: active should be yes or no, not “${shown(cell(r, "active"))}”.`);
      const dflt = parseBool(cell(r, "default"), null); // anything but yes/no counts as blank
      const tid = idc(r, "task_id"), tkey = `${fv ? fv.rec.id : rid || jar + "|" + nameKey(rname)}|${tid}`;
      if (tid && taskSeen.has(tkey)) return bad(r, `Task “${shown(text1(r, "task"))}” is already listed on line ${taskSeen.get(tkey)}.`);
      // A blank reminder gets the capped default (Due.defaultRemind, 4.20 AC 5); a value that is there is never changed, even above Every (4.20 AC 13).
      const res = makeTask({ id: tid, name: text1(r, "task"), time, active, default: dflt === undefined ? null : dflt,
        miles: mi.v != null ? { every: mi.v, remind: mr.v ?? Due.defaultRemind("miles", mi.v) } : null,
        hours: ho.v != null ? { every: ho.v, remind: hr.v ?? Due.defaultRemind("hours", ho.v) } : null }, rowJar);
      if (res.error) return bad(r, `Task: ${res.error}.`);
      if (tid) taskSeen.set(tkey, r.line);
      out.tasks.push({ ...base, rec: res.rec, hadId: !!tid });
    } else if (type === "fillup") {
      if (rowJar !== "vehicles") return bad(r, "Fill-up: fill-ups are only for vehicles.");
      const d = date(r), o = num(r, "odometer", "odometer", true), g = num(r, "units", "units"), p = num(r, "price_per_unit", "price_per_unit"), t = num(r, "total", "total");
      const e = (cell(r, "date") ? d.error : "the date is blank") || (cell(r, "odometer") ? o.error : "the odometer is blank") || g.error || p.error || t.error;
      if (e) return bad(r, `Fill-up: ${e}.`);
      const missed = parseBool(cell(r, "missed"), false);
      if (missed === undefined) return bad(r, `Fill-up: missed should be yes or blank, not “${shown(cell(r, "missed"))}”.`);
      const res = makeFillup({ id: idc(r, "entry_id"), thingId: "", date: d.v, odometer: o.v, units: g.v, pricePerUnit: p.v, total: t.v,
        station: text1(r, "station"), missed, createdAt: created });
      if (res.error) return bad(r, `Fill-up: ${res.error}.`);
      out.fillups.push({ ...base, rec: res.rec });
    } else if (type === "reading") {
      const d = date(r), o = num(r, "odometer", "odometer", true), h = hrs(r, "hours"), old = num(r, "old_reading", "old_reading");
      const e = (cell(r, "date") ? d.error : "the date is blank") || o.error || h.error || old.error;
      if (e) return bad(r, `Reading: ${e}.`);
      const res = makeReading({ id: idc(r, "entry_id"), thingId: "", date: d.v, odometer: o.v, hours: h.v, oldValue: old.v, createdAt: created }, rowJar);
      if (res.error) return bad(r, `Reading: ${res.error}.`);
      out.readings.push({ ...base, rec: res.rec });
    } else {
      const d = date(r), o = num(r, "odometer", "odometer", true), h = hrs(r, "hours"), due = cell(r, "due_for") ? date(r, "due_for") : { v: "" };
      const e = (cell(r, "date") ? d.error : "the date is blank") || o.error || h.error || due.error;
      if (e) return bad(r, `Log: ${e}.`);
      const status = lower(cell(r, "status")) || "done";
      if (!["done", "skipped"].includes(status)) return bad(r, `Log: status “${shown(cell(r, "status"))}” should be done or skipped.`);
      const shop = text1(r, "shop");
      // Rows without a visit id are grouped into one visit by thing, date, readings and shop.
      const vk = [rid || jar + "|" + nameKey(rname), d.v, o.v, h.v, lower(shop)].join("|");
      if (!visitKeys.has(vk)) visitKeys.set(vk, "~" + visitKeys.size);
      const taskId = idc(r, "task_id");
      const res = makeLog({ id: idc(r, "entry_id"), thingId: "", date: d.v, odometer: o.v, hours: h.v, shop, taskId: taskId || "?", taskName: text1(r, "task"),
        notes: unFormula(cell(r, "notes")), visit: idc(r, "visit") || visitKeys.get(vk), status, forDue: due.v || "", createdAt: created }, rowJar, true); // meterOptional: the app saves a Done vehicle log with no reading (Pantry Done sheet, log Edit), so a backup must restore it (QA M-1)
      if (res.error) return bad(r, `Log: ${res.error}.`);
      out.logs.push({ ...base, rec: res.rec, rawTaskId: taskId });
    }
  });
  if (unclosedAt) bad({ line: unclosedAt }, "A quote mark on this line is never closed, so the rest of the file can't be read.");
  out.bad.sort((a, b) => a.line - b.line);
  if (!out.things.length && !out.fillups.length && !out.logs.length && !out.tasks.length && !out.readings.length && !JAR_NAMES.some((j) => out.shops[j].length) && !out.badCount)
    out.fatal = "There are no records in this file.";
  return out;
}

// ---------- CSV import: what Merge or Replace would do ----------
// Merge keeps everything on this device and adds what's new. A file thing is the same as a device thing when the ids match, or when
// they are in the same jar with the same name and the same kind (or either has none); it is then left as it is and gets the file's
// tasks, logs and readings added. Replace deletes everything here first. Rows for things that can't be found are bad rows.
function planImport(an, mode) {
  const merge = mode === "merge";
  const plan = { mode, newThings: [], changedThings: new Map(), shops: noShops(), fillups: [], logs: [], readings: [], renamed: [...an.renamed], nameMatches: [],
    thingsMatched: 0, tasksAdded: 0, shopsAdded: 0, dupTasks: 0, dupFillups: 0, dupLogs: 0, dupReadings: 0, inFile: { tasks: 0, fillups: 0, logs: 0, readings: 0 }, bad: [], badCount: 0 };
  if (merge) for (const j of JAR_NAMES) plan.shops[j] = [...S.shops[j]];
  const bad = (line, msg) => { plan.badCount++; if (plan.bad.length < MAX_BAD) plan.bad.push({ line, msg }); };
  const dev = merge ? S.things : [];
  const devById = new Map(dev.map((v) => [v.id, v]));
  const devByName = new Map();
  for (const v of dev) { const k = v.jar + "|" + nameKey(v.name); if (!devByName.has(k)) devByName.set(k, v); }
  const taken = Object.fromEntries(JAR_NAMES.map((j) => [j, new Set()]));
  for (const v of dev) taken[v.jar].add(nameKey(v.name));
  for (const c of an.things) taken[c.rec.jar].add(nameKey(c.rec.name));
  const newSet = new Set(), target = new Map(); // target: file thing -> the thing record being written (new, or the device's)

  for (const fv of an.things) {
    const byId = devById.get(fv.rec.id), byName = !byId && devByName.get(fv.rec.jar + "|" + nameKey(fv.rec.name));
    const same = byId && byId.jar === fv.rec.jar ? byId : byName && (!byName.kind || !fv.rec.kind || byName.kind === fv.rec.kind) ? byName : null;
    if (same) {
      plan.thingsMatched++;
      if (same !== byId) plan.nameMatches.push({ jar: same.jar, name: same.name });
      target.set(fv, same);
      continue;
    }
    const v = { ...fv.rec, tasks: [] };
    if (byId) v.id = newId("t"); // same id but another jar: never overwrite the device's thing
    if (byName) { // same name, both kinds filled and different: a different thing, renamed
      const to = freeName(v.name, taken[v.jar]);
      taken[v.jar].add(nameKey(to));
      plan.renamed.push({ jar: v.jar, from: v.name, to, line: fv.line });
      v.name = to;
    }
    plan.newThings.push(v); newSet.add(v); target.set(fv, v);
  }
  // A thing record that can be changed: a new one, or a copy of the device's (only saved if something changes).
  const writable = (v) => {
    if (newSet.has(v)) return v;
    if (!plan.changedThings.has(v.id)) plan.changedThings.set(v.id, { ...v, tasks: [...v.tasks], updatedAt: nowISO() });
    return plan.changedThings.get(v.id);
  };
  const current = (v) => plan.changedThings.get(v.id) || v;
  const thingFor = (x, what) => {
    const v = x.vref.file ? target.get(x.vref.file) : (x.vref.id ? devById.get(x.vref.id) : devByName.get(x.vref.jar + "|" + nameKey(x.vref.name))) || null;
    const who = shown(x.vref.name || x.vref.id);
    if (!v) { bad(x.line, `${what}: thing “${who}” isn't in this file${merge ? " or on this device" : ""}.`); return null; }
    if (!x.vref.file && v.jar !== x.jar) { bad(x.line, `${what}: “${who}” is in a different jar on this device.`); return null; }
    return v;
  };

  for (const s of an.tasks) {
    const v = thingFor(s, "Task");
    if (!v) continue;
    plan.inFile.tasks++;
    const have = current(v).tasks;
    // Same task_id on the same thing is the same task. A task with no id in the file is matched by name on a device thing.
    if (have.some((it) => it.id === s.rec.id) || (!s.hadId && !newSet.has(v) && have.some((it) => lower(it.name) === lower(s.rec.name)))) { plan.dupTasks++; continue; }
    writable(v).tasks.push({ ...s.rec });
    plan.tasksAdded++;
  }
  for (const j of JAR_NAMES) for (const name of an.shops[j]) {
    if (plan.shops[j].some((x) => shopKey(x) === shopKey(name))) continue;
    plan.shops[j].push(name);
    if (merge) plan.shopsAdded++;
  }
  const fKeys = new Set(merge ? S.fillups.map(fillupKey) : []), fIds = new Set(merge ? S.fillups.map((f) => f.id) : []);
  for (const f of an.fillups) {
    const v = thingFor(f, "Fill-up");
    if (!v) continue;
    plan.inFile.fillups++;
    const rec = { ...f.rec, thingId: v.id };
    const key = fillupKey(rec);
    if (fKeys.has(key)) { plan.dupFillups++; continue; }
    if (fIds.has(rec.id)) rec.id = newId("f");
    fKeys.add(key); fIds.add(rec.id);
    plan.fillups.push(rec);
  }
  const sKeys = new Set(merge ? S.logs.map(logKey) : []), sIds = new Set(merge ? S.logs.map((s) => s.id) : []);
  const visits = new Map();
  for (const s of an.logs) {
    const v = thingFor(s, "Log");
    if (!v) continue;
    plan.inFile.logs++;
    const rec = { ...s.rec, thingId: v.id };
    if (!s.rawTaskId) rec.taskId = current(v).tasks.find((it) => lower(it.name) === lower(rec.taskName))?.id || "other";
    if (rec.visit.startsWith("~")) { if (!visits.has(rec.visit)) visits.set(rec.visit, newId("x")); rec.visit = visits.get(rec.visit); }
    // Same id = same record. Same content as one already on this device = duplicate. Two rows in the file with
    // different ids are kept, since they were separate records on the device that exported them.
    if (sIds.has(rec.id) || sKeys.has(logKey(rec))) { plan.dupLogs++; continue; }
    sIds.add(rec.id);
    plan.logs.push(rec);
  }
  const rKeys = new Set(merge ? S.readings.map(readingKey) : []), rIds = new Set(merge ? S.readings.map((r) => r.id) : []);
  for (const x of an.readings) {
    const v = thingFor(x, "Reading");
    if (!v) continue;
    plan.inFile.readings++;
    const rec = { ...x.rec, thingId: v.id };
    if (rIds.has(rec.id) || rKeys.has(readingKey(rec))) { plan.dupReadings++; continue; }
    rIds.add(rec.id); rKeys.add(readingKey(rec));
    plan.readings.push(rec);
  }
  plan.bad.sort((a, b) => a.line - b.line);
  plan.adds = plan.newThings.length + plan.changedThings.size + plan.shopsAdded + plan.fillups.length + plan.logs.length + plan.readings.length
    + (merge ? 0 : JAR_NAMES.reduce((n, j) => n + plan.shops[j].length, 0));
  return plan;
}

async function applyImport(plan) {
  const changes = {
    put: { things: [...plan.newThings, ...plan.changedThings.values()], fillups: plan.fillups, logs: plan.logs, readings: plan.readings },
    settings: { shops: plan.shops }, // already the device's lists plus the file's (Merge) or the file's alone (Replace)
  };
  if (plan.mode === "replace") changes.clear = ["things", "fillups", "logs", "readings"];
  await save(changes);
}

// ---------- Pantry boxes (data-model 3.3 and 3.7; the math lives in due.js, loaded after this file) ----------
// Whole calendar days from one local date (YYYY-MM-DD) to another. UTC math, so daylight saving never shifts it.
function daysBetween(from, to) { return Due.daysBetween(from, to); }
const PANTRY_BOXES = ["overdue", "due-this-week", "due-this-month", "due-later"];
// Which box a task sits in. days = days from today to its due date, or the estimated date for a meter task (null when it has none).
// left = meter units left (negative when past due), remind = the meter's remind amount, timeDays = the time rule's days when the
// task has both a meter and a time rule. The most urgent rule wins (data-model 3.4).
function pantryBox(args) { return Due.boxOf(args); }
