/* Pickle It: the starter task libraries as data (data-model 2.3b-2.3d, 7.3; content in docs/content/*.md; numbers in docs/content/task-ids.md).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in), no network. Loads in the browser as the global `Starters`
   (after due.js) and in Node via require(). Nothing here is saved: instantiate() returns task specs for makeThing / makeTask, which stay the
   one place the jar rules are enforced. Each spec is the thing's own copy of the library task (the library is a template, never linked back
   except by the number in `id`). A number is permanent: never renumber or reuse one (task-ids.md).

   One library task: id (the library number, as text), name, on (a jar name, "house" for the Home thing, or a kind), when (optional: a list of
   alternatives, each { type_1|type_2|type_3: [allowed values] }; absent = every thing of that kind), default (checked in setup), the rule
   (miles / hours / time), timeOnly (the time rule to use when the thing has no hour meter, 3.4a; absent = the same time rule with the hours dropped)
   and notSure ("pause" = created paused when the user is not sure). A fixed-date (calendar) time rule carries only monthDay ("MM-DD"), never a
   year (2.3c); the window (activeFrom / activeTo) is on "done" rules only. */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./due.js") : root.Due;
  const done = (n, unit, extra) => ({ n, unit, from: "done", ...extra });
  const cal = (n, unit, monthDay) => (monthDay ? { n, unit, from: "calendar", monthDay } : { n, unit, from: "calendar" });
  const mi = (every, remind) => ({ every, remind });
  const hr = (every, remind) => ({ every, remind });
  const yes = true, no = false;
  // [id, name, on, default, rules, when]
  const e = (id, name, on, def, rules = {}, when) => ({ id: String(id), name, on, default: def, ...rules, ...(when ? { when } : {}) });
  const T1 = (...v) => [{ type_1: v }];
  const MOWER_GAS_ALL = [{ type_1: ["gas"] }], TRACTOR_GAS = [{ type_1: ["gas"], type_2: ["lawn-tractor", "zero-turn"] }];
  const GEN_GAS = T1("gas"), GEN_E = T1("electric"), GEN_E_STANDBY = [{ type_1: ["electric"], type_2: ["standby"] }], GEN_E_PORTABLE = [{ type_1: ["electric"], type_2: ["portable"] }];

  const LIBRARY = [
    // ---- Vehicles (docs/content/vehicles.md) ----
    e(58, "Oil and filter change", "vehicles", yes, { miles: mi(5000, 1000), time: done(6, "month") }),
    e(59, "Tire rotation", "vehicles", yes, { miles: mi(5000, 1000) }),
    e(60, "Check tire pressure and tread", "vehicles", no, { time: done(1, "month") }),
    e(61, "Cabin air filter", "vehicles", yes, { miles: mi(12000, 1000), time: done(1, "year") }),
    e(62, "Engine air filter", "vehicles", yes, { miles: mi(30000, 5000), time: done(1, "year") }),
    e(63, "Brake fluid", "vehicles", yes, { miles: mi(30000, 5000), time: done(2, "year") }),
    e(64, "Transmission fluid", "vehicles", yes, { miles: mi(60000, 5000) }),
    e(65, "Spark plugs", "vehicles", yes, { miles: mi(60000, 5000) }),
    e(66, "Engine coolant", "vehicles", yes, { miles: mi(100000, 5000) }),
    e(67, "Wiper blades", "vehicles", yes, { time: done(6, "month") }),
    e(68, "Battery check", "vehicles", yes, { time: cal(1, "year", "10-01") }),
    e(69, "Registration renewal", "vehicles", yes, { time: cal(1, "year") }),
    e(70, "State inspection (optional)", "vehicles", no, { time: cal(1, "year") }),
    e(71, "Inspect brakes (pads, discs)", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(72, "Inspect brake lines", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(73, "Inspect parking brake", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(74, "Inspect steering", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(75, "Inspect suspension", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(76, "Inspect driveline", "vehicles", yes, { miles: mi(12000, 1000) }),
    e(77, "Inspect CVT fluid", "vehicles", yes, { miles: mi(30000, 5000) }),
    e(78, "Inspect drivebelts", "vehicles", yes, { miles: mi(30000, 5000) }),
    e(79, "Inspect coolant and hoses", "vehicles", yes, { miles: mi(30000, 5000) }),
    e(80, "Inspect fuel system", "vehicles", yes, { miles: mi(30000, 5000) }),
    e(81, "Inspect differential fluid", "vehicles", yes, { miles: mi(30000, 5000) }),
    e(82, "Inspect wheel bearings", "vehicles", yes, { miles: mi(60000, 5000) }),
    e(83, "Fuel filter", "vehicles", yes, { miles: mi(72000, 5000) }),
    e(84, "CVT fluid replacement", "vehicles", yes, { miles: mi(120000, 5000) }),
    e(85, "Inspect clutch operation (optional)", "vehicles", no, { miles: mi(12000, 1000) }),
    e(86, "Inspect manual transmission gear oil (optional)", "vehicles", no, { miles: mi(30000, 5000) }),
    e(87, "Timing belt replacement (optional)", "vehicles", no, { miles: mi(90000, 5000) }),

    // ---- Home: the house (docs/content/home.md) ----
    e(4, "Chimney and fireplace inspection", "house", no, { time: cal(1, "year", "08-15") }),
    e(5, "Test smoke and CO alarms", "house", yes, { time: done(1, "month") }),
    e(6, "Replace smoke alarms", "house", yes, { time: done(10, "year") }), // the row's lastDate = the manufacture date printed on the alarm
    e(7, "Replace CO alarms", "house", yes, { time: done(7, "year") }), // the row's startDate = the printed replace-by date; else lastDate = install date
    e(9, "Clean gutters: spring", "house", yes, { time: cal(1, "year", "05-01") }),
    e(114, "Clean gutters: summer", "house", yes, { time: cal(1, "year", "08-01") }),
    e(115, "Clean gutters: fall", "house", yes, { time: cal(1, "year", "11-01") }),
    e(10, "Winterize outdoor faucets", "house", yes, { time: cal(1, "year", "10-15") }),
    e(22, "Check fire extinguishers", "house", yes, { time: done(1, "month") }),
    e(23, "Test sump pump", "house", no, { time: done(3, "month") }),
    e(24, "Roof inspection", "house", yes, { time: cal(1, "year", "04-15") }),
    e(27, "Seal deck or fence", "house", no, { time: done(2, "year") }),

    // ---- Home: HVAC (three type slots; a heat pump in either slot keeps both tune-ups) ----
    e(1, "Check or change HVAC filter", "hvac", yes, { time: done(3, "month") }),
    e(2, "AC tune-up (spring)", "hvac", yes, { time: cal(1, "year", "04-01") },
      [{ type_2: ["central", "window-unit", "heat-pump", "mini-split"] }, { type_1: ["heat-pump"] }]),
    e(3, "Furnace or heating tune-up (fall)", "hvac", yes, { time: cal(1, "year", "09-15") },
      [{ type_1: ["gas", "electric", "heat-pump", "oil"] }, { type_2: ["heat-pump"] }]),
    e(21, "Clean ductwork", "hvac", yes, { time: done(3, "year") }, [{ type_3: ["ducted"] }]),

    // ---- Home: appliances ----
    e(8, "Flush water heater", "water-heater", yes, { time: done(1, "year") }),
    e(19, "Run a washer clean cycle", "washer", yes, { time: done(1, "month") }),
    e(20, "Replace washer fill hoses", "washer", yes, { time: done(5, "year") }),
    e(11, "Clean dryer vent duct", "dryer", yes, { time: done(1, "year") }),
    e(12, "Clean refrigerator coils", "fridge", yes, { time: done(1, "year") }),
    e(25, "Clean dishwasher filter", "dishwasher", yes, { time: done(1, "month") }),
    e(26, "Clean range hood filter", "range-hood", yes, { time: done(3, "month") }),

    // ---- Home: snow blower (both types get the same tasks, decisions.md Round 7 item 6) ----
    e(15, "Snow blower oil change", "snow-blower", yes, { time: cal(1, "year", "10-15") }),
    e(16, "Store snow blower for summer", "snow-blower", yes, { time: cal(1, "year", "04-01") }),
    e(32, "Inspect blade and shoes", "snow-blower", yes, { time: cal(1, "year", "11-01") }),

    // ---- Home: mower (type_1 = power, type_2 = push | lawn-tractor | zero-turn; hour meter on every mower) ----
    e(13, "Mower oil change", "mower", yes, { hours: hr(50, 5), time: done(1, "year"), timeOnly: cal(1, "year", "04-01") }, MOWER_GAS_ALL),
    e(14, "Store mower for winter", "mower", yes, { time: cal(1, "year", "11-01") }, MOWER_GAS_ALL),
    e(28, "Sharpen mower blades", "mower", yes, { hours: hr(25, 3), time: done(3, "month") }),
    e(29, "Clean mower deck", "mower", yes, { time: done(1, "month") }, T1("electric")),
    e(30, "Check mower battery and charger", "mower", yes, { time: done(3, "month") }, T1("electric")),
    e(31, "Store electric mower and battery for winter", "mower", yes, { time: cal(1, "year", "11-01") }, T1("electric")),
    e(42, "Replace air filter", "mower", yes, { hours: hr(100, 10), time: done(1, "year") }, TRACTOR_GAS),
    e(43, "Replace spark plugs", "mower", yes, { hours: hr(100, 10), time: done(1, "year") }, TRACTOR_GAS),
    e(44, "Grease fittings and spindles", "mower", yes, { hours: hr(25, 3), time: done(3, "month", { activeFrom: 4, activeTo: 10 }) }, TRACTOR_GAS),
    e(45, "Inspect deck belt and drive belt", "mower", yes, { time: done(1, "year") }, TRACTOR_GAS),
    e(46, "Check tire pressure", "mower", no, { time: done(1, "month", { activeFrom: 4, activeTo: 10 }) }, TRACTOR_GAS),
    e(47, "Check battery and clean terminals", "mower", yes, { time: cal(1, "year", "04-01") }, TRACTOR_GAS),
    e(48, "Replace fuel filter", "mower", no, { time: done(1, "year") }, TRACTOR_GAS),

    // ---- Home: generator, gas (docs/content/home.md) ----
    e(34, "Generator monthly status check", "generator", yes, { time: done(1, "month") }, GEN_GAS),
    e(35, "Generator monthly exterior inspection", "generator", yes, { time: done(1, "month") }, GEN_GAS),
    e(36, "Generator oil and filter change", "generator", yes, { hours: hr(100, 10), time: done(12, "month") }, GEN_GAS),
    e(37, "Generator air filter and spark plugs", "generator", yes, { hours: hr(100, 10), time: done(12, "month") }, GEN_GAS),
    e(38, "Generator battery inspection", "generator", yes, { hours: hr(100, 10), time: done(12, "month") }, GEN_GAS),
    e(39, "Generator fuel and fluid checks", "generator", yes, { time: done(12, "month") }, GEN_GAS),
    e(40, "Generator transfer switch and system test", "generator", yes, { time: done(12, "month") }, GEN_GAS),
    e(41, "Generator firmware and diagnostics", "generator", yes, { time: done(12, "month") }, GEN_GAS),
    // ---- Home: generator, electric (docs/content/generator-electric.md) ----
    e(49, "Electric generator monthly status check", "generator", yes, { time: done(1, "month") }, GEN_E),
    e(50, "Electric generator exterior and cable inspection", "generator", yes, { time: done(3, "month") }, GEN_E),
    e(51, "Check battery charge and health", "generator", yes, { time: done(6, "month") }, GEN_E),
    e(52, "Check battery terminals, cables and connections", "generator", yes, { time: done(12, "month") }, GEN_E_STANDBY),
    e(53, "Check location, clearance and temperature", "generator", yes, { time: cal(1, "year", "10-01") }, GEN_E_STANDBY),
    e(54, "Backup test (simulated power outage)", "generator", yes, { time: done(12, "month") }, GEN_E_STANDBY),
    e(55, "Firmware and connection check", "generator", yes, { time: done(6, "month") }, GEN_E),
    e(56, "Clean solar panels (only if the system has them)", "generator", no, { time: cal(1, "year", "04-15") }, GEN_E_STANDBY),
    e(57, "Top up and check a stored portable power station", "generator", yes, { time: done(3, "month") }, GEN_E_PORTABLE),

    // ---- Home: outdoor power tools (type_1 = tool type; no hour meter, time only) ----
    e(101, "Clean Air Filter", "power-tools", yes, { time: cal(1, "year", "04-01") }, T1("string-trimmer")),
    e(102, "Check Spark Plug", "power-tools", yes, { time: done(1, "year") }, T1("string-trimmer")),
    e(103, "Prepare for Storage", "power-tools", yes, { time: cal(1, "year", "11-01") }, T1("string-trimmer")),
    e(104, "Check Fuel Filter and Hose", "power-tools", no, { time: done(1, "year") }, T1("string-trimmer")),
    e(105, "Clean Air Filter", "power-tools", yes, { time: done(3, "month") }, T1("leaf-blower")),
    e(106, "Check Spark Plug", "power-tools", yes, { time: done(1, "year") }, T1("leaf-blower")),
    e(107, "Prepare for Storage", "power-tools", yes, { time: cal(1, "year", "12-01") }, T1("leaf-blower")),
    e(108, "Check Chain Brake", "power-tools", yes, { time: done(1, "month") }, T1("chainsaw")),
    e(109, "Check Chain Tension and Bar Oil", "power-tools", yes, { time: done(1, "month") }, T1("chainsaw")),
    e(110, "Sharpen Chain", "power-tools", yes, { time: cal(1, "year", "09-15") }, T1("chainsaw")),
    e(111, "Clean Air Filter", "power-tools", yes, { time: done(3, "month") }, T1("chainsaw")),
    e(112, "Check Spark Plug", "power-tools", yes, { time: done(1, "year") }, T1("chainsaw")),
    e(113, "Prepare for Storage", "power-tools", yes, { time: cal(1, "year", "04-01") }, T1("chainsaw")),

    // ---- Health (docs/content/health.md) ----
    e(88, "Dental cleaning", "health", yes, { time: done(6, "month") }),
    e(89, "Eye exam", "health", yes, { time: done(1, "year") }),
    e(90, "Annual check-up", "health", yes, { time: done(1, "year") }),
    e(91, "Flu shot", "health", yes, { time: cal(1, "year", "09-15") }),
    e(92, "Tetanus booster", "health", yes, { time: done(10, "year") }),
    e(93, "Refill reminder", "health", yes, { time: done(30, "day") }),

    // ---- Finance (docs/content/finance.md) ----
    e(94, "File tax return", "finance", yes, { time: cal(1, "year", "04-15") }),
    e(95, "Insurance renewal", "finance", no, { time: cal(1, "year"), notSure: "pause" }),
    e(96, "Annual subscription renewal", "finance", no, { time: cal(1, "year") }),
    e(97, "Check credit reports", "finance", no, { time: done(1, "year") }),
    e(98, "Review monthly subscriptions", "finance", no, { time: done(1, "year") }),
    e(99, "Property tax due (optional)", "finance", no, { time: cal(1, "year") }),
    e(100, "Health insurance open enrollment (optional)", "finance", no, { time: cal(1, "year", "11-01") }),
  ];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const TYPE_KEYS = ["type_1", "type_2", "type_3"];
  // types = [type_1, type_2, type_3] (lowercase canonical words, 2.3b). A slot that is missing or "none" matches no task that depends on it.
  const matches = (t, types) => !t.when || t.when.some((alt) => TYPE_KEYS.every((k, i) => !alt[k] || alt[k].includes(String((types || [])[i] ?? "").toLowerCase())));
  const onOf = (jar, kind) => (jar === "home" ? kind || "house" : jar);

  // The template tasks for one thing: name, rule per measure, default (and notSure), in library order. opts.hourMeter overrides whether the
  // thing has an hour meter (default: mowers and generators do, 3.4a); without one the hours half is dropped and the time-only version is used.
  function starterList(jar, kind, types, opts = {}) {
    const hasMeter = opts.hourMeter ?? D.hasHourMeter({ jar, kind, tasks: [] });
    // Most frequent first (owner, 2026-11-08): a task's key is its first measure in the order miles, hours, time, so each measure is its own group
    // in that order and tasks sort by their Every within it (time counted in months); a task with no interval goes last; ties keep library order.
    // shortcut: no conversion between miles, hours and months, the owner leaves that to v2.
    const MONTHS = { day: 1 / 30, week: 7 / 30, month: 1, year: 12 };
    const key = (o) => (o.miles ? [0, o.miles.every] : o.hours ? [1, o.hours.every] : o.time ? [2, o.time.n * MONTHS[o.time.unit]] : [3, 0]);
    return LIBRARY.filter((t) => t.on === onOf(jar, kind) && matches(t, types)).map((t) => {
      const keepHours = t.hours && hasMeter;
      const out = { id: t.id, name: t.name, default: t.default, miles: t.miles ? clone(t.miles) : null, hours: keepHours ? clone(t.hours) : null,
        time: clone((t.hours && !hasMeter && t.timeOnly) || t.time || null), active: true };
      if (t.notSure) out.notSure = t.notSure;
      return out;
    }).sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1]; });
  }

  // First occurrence of "MM-DD" after `from` (strictly, or on it when inclusive).
  function nextMonthDay(md, from, inclusive) {
    const y = +from.slice(0, 4), cand = `${y}-${md}`;
    return cand > from || (inclusive && cand === from) ? cand : `${y + 1}-${md}`;
  }
  // The time rule's startDate (2.3d). row = { lastDate, startDate, hasLog } from the task's setup row; none of them = "not sure" / row left alone.
  function startFor(tm, row, today) {
    if (row.startDate) return row.startDate; // the user's own next-due date (CO replace-by, registration expiry, policy renewal)
    if (row.hasLog) return ""; // the caller writes the one log; due then counts from it
    if (tm.from === "done") return D.addUnits(row.lastDate || today, tm.n, tm.unit);
    return tm.monthDay ? nextMonthDay(tm.monthDay, row.lastDate || today, !row.lastDate) : ""; // no library date: blank = Due Later until the user adds one
  }

  // Task specs ready for makeThing / makeTask. opts: today (ISO date, required), picked (library numbers switched on; default = the tasks whose
  // default is true; any other is not created at all, owner ruling 2026-11-08), rows ({ number: { lastDate, startDate, hasLog } }), edits (see below), hourMeter. Logs are not made here.
  function instantiate(jar, kind, types, opts = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today || "")) throw new Error("instantiate needs today as YYYY-MM-DD");
    const picked = opts.picked && new Set(opts.picked.map(String)), rows = opts.rows || {};
    // A task that is not picked (or, with no picked list, not default) is not created. A picked one with no date and "not sure: pause" is created paused.
    return starterList(jar, kind, types, opts).filter((t) => (picked ? picked.has(t.id) : t.default)).map((t0) => {
      const row = rows[t0.id] || {}, ed = (opts.edits || {})[t0.id] || {};
      // edits (setup rows, S4b-1/2): { number: { name, milesEvery, hoursEvery, milesRemind, hoursRemind, n, unit, noTime } } (n and unit also add a count-from-done time rule to a miles task) change what the thing's own copy says before the start date is worked out.
      // A Remind the person typed (milesRemind, hoursRemind) wins; otherwise the library's, capped at a changed Every.
      const meterOf = (m, every, remind) => (m && (every != null || remind != null) ? { every: every ?? m.every, remind: remind ?? Math.min(m.remind, every ?? m.every) } : m);
      const t = { ...t0, name: ed.name ?? t0.name, miles: meterOf(t0.miles, ed.milesEvery, ed.milesRemind),
        hours: meterOf(t0.hours, ed.hoursEvery, ed.hoursRemind),
        time: ed.noTime ? null : ed.n != null ? { from: "done", ...t0.time, n: ed.n, unit: ed.unit } : t0.time };
      const time = t.time && { n: t.time.n, unit: t.time.unit, from: t.time.from, startDate: startFor(t.time, row, opts.today),
        activeFrom: t.time.activeFrom ?? null, activeTo: t.time.activeTo ?? null };
      const paused = t.notSure === "pause" && !row.lastDate && !row.startDate && !row.hasLog;
      return { id: t.id, name: t.name, miles: t.miles, hours: t.hours, time, active: !paused, default: t.default };
    });
  }

  const api = { LIBRARY, starterList, instantiate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Starters = api;
})(typeof self !== "undefined" ? self : this);
