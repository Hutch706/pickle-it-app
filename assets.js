/* Pickle It: Assets tab logic (spec v1-scope 4.17, mockup settings-option-c.html CF1-CF13).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in). Loads in the browser as the global `Assets`
   (after due.js) and in Node via require(). Rows come from Due.pantryTasks(..., all = true), so the due math is the Pantry's own.
   Nothing here is saved: the screen keeps its state in memory and drops it when the person leaves Settings (4.17 AC 12). */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./due.js") : root.Due;
  const JAR_KEYS = ["vehicles", "home", "health", "finance"];
  const JAR_LABEL = { vehicles: "Vehicles", home: "Home", health: "Health", finance: "Finance" };
  const STATUSES = ["Overdue", "Due Soon", "On Track", "Paused"];
  const SOON_DAYS = 27; // Due Soon = today through today + 27 days (AC 5b)
  const PAGE_FIRST = 50, PAGE_STEP = 100; // AC 8
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const lower = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // Search only: also accent-blind ("eclair" finds "Éclair"). Sorting keeps the plain compare (QA S2 ruling).
  const fold = (s) => lower(String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const jarRank = (j) => { const i = JAR_KEYS.indexOf(j); return i < 0 ? 99 : i; };
  const num = (x) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(x);

  // ---------- status (AC 5) ----------
  // row: { over, paused, off, days, left } from Due.pantryTasks. Overdue wins over a closed window (4.14 AC 6, and computeDue never pauses a
  // task that is already overdue); a task the person switched off is Paused. A meter task at exactly 0 left is due now, so Due Soon.
  // No date and not due now (miles or hours with no estimate, "Add a reading") is On Track (AC 5c).
  function statusOf(r) {
    if (r.over && !r.off) return "Overdue";
    if (r.paused || r.off) return "Paused";
    if ((r.days != null && r.days >= 0 && r.days <= SOON_DAYS) || r.left === 0) return "Due Soon";
    return "On Track";
  }

  // ---------- text ----------
  const every = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  // "Every 5,000 mi or 6 months", "Each year on Mar 14" (a fixed-date task).
  function ruleText(k) {
    const p = [];
    if (k.miles) p.push(`${num(k.miles.every)} mi`);
    if (k.hours) p.push(`${num(k.hours.every)} hr`);
    const t = k.time;
    if (t && t.from === "calendar" && !p.length) {
      const d = t.startDate ? `${MON[+t.startDate.slice(5, 7) - 1]} ${+t.startDate.slice(8)}` : "";
      return t.n === 1 && t.unit === "year" && d ? `Each year on ${d}` : `Every ${every(t.n, t.unit)}${d ? `, from ${d}` : ""}`;
    }
    if (t) p.push(!p.length && t.n === 1 ? t.unit : every(t.n, t.unit));
    return p.length ? `Every ${p.join(" or ")}` : "Repeats by not set";
  }
  // The Season Chip (4.14 AC 9): text for the eye, spoken for the screen reader; null without a window. Never shown on fixed-date tasks.
  function seasonChip(k, today) {
    const t = k.time, w = t && t.from === "done" ? D.normaliseWindow({ from: t.activeFrom, to: t.activeTo }) : null;
    if (!w) return null;
    if (D.windowOpen(w, today)) {
      const one = w.from === w.to;
      return { closed: false, text: one ? MON[w.from - 1] : `${MON[w.from - 1]}-${MON[w.to - 1]}`, spoken: one ? `Active ${MONTH[w.from - 1]}.` : `Active ${MONTH[w.from - 1]} to ${MONTH[w.to - 1]}.` };
    }
    const r = D.resumeDate(w, today), m = +r.slice(5, 7) - 1, d = +r.slice(8);
    return { closed: true, text: `Paused until ${MON[m]} ${d}`, spoken: `Paused, active again ${MONTH[m]} ${d}.` };
  }

  // ---------- the model ----------
  // Next-due order (AC 6): Overdue first, then dated tasks soonest first, then undated ones (fewest units left first). Ties by name, then id.
  const dueClass = (r) => (r.status === "Overdue" ? 0 : r.dueDate ? 1 : 2);
  function cmpDue(a, b) {
    const ca = dueClass(a), cb = dueClass(b);
    return ca - cb || (ca < 2 ? cmp(a.dueDate || "9999", b.dueDate || "9999") : 0) || cmp(a.left ?? Infinity, b.left ?? Infinity)
      || cmp(lower(a.task), lower(b.task)) || cmp(lower(a.thing), lower(b.thing)) || cmp(a.id, b.id);
  }
  // data = { things, logs, readings, fillups, hiddenJars }. Every thing (hidden jars and inactive ones too), every task (paused too).
  // The place icon a thing row draws (data-model 2.3a): only a word offered for its jar; anything else falls back to the jar icon.
  const PLACE_ICONS = { home: ["house", "apartment", "land"], finance: ["house", "apartment", "land", "account"] };
  function buildModel(data, today) {
    const hidden = new Set(data.hiddenJars || []), byId = new Map(), rows = [];
    const things = (data.things || []).map((t) => {
      const o = { id: t.id, name: t.name, jar: t.jar, kind: t.kind || "", active: t.active !== false, hiddenJar: hidden.has(t.jar), tasks: [] };
      if ((PLACE_ICONS[t.jar] || []).includes(t.icon)) o.icon = t.icon;
      byId.set(t.id, { o, t });
      return o;
    });
    for (const r of D.pantryTasks(data, today, null, true)) {
      const e = byId.get(r.thingId), k = e.t.tasks.find((x) => x.id === r.taskId);
      Object.assign(r, { status: statusOf(r), rule: ruleText(k), season: seasonChip(k, today), thingActive: e.o.active, hiddenJar: e.o.hiddenJar });
      e.o.tasks.push(r); rows.push(r);
    }
    for (const t of things) {
      t.tasks.sort(cmpDue);
      t.soonest = t.tasks.find((r) => r.status !== "Paused") || null; // what the row names; null when every task is paused (or there are none)
      t.statuses = [...new Set(t.tasks.map((r) => r.status))];
    }
    return { things, rows };
  }

  // ---------- state, filter, sort, search, cap (AC 3-9) ----------
  const defaultState = () => ({ view: "things", jars: [], statuses: [], search: "", sort: "jar", limit: PAGE_FIRST });
  // Any change to what is listed puts the cap back to 50 (edge case: Show More, then a filter changed).
  const setState = (st, patch) => Object.assign(st, { limit: PAGE_FIRST }, patch);
  const toggled = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filterCount = (st) => st.jars.length + st.statuses.length; // "<N> on"; the View is not a filter
  const isFiltered = (st) => filterCount(st) > 0 || lower(st.search) !== "";

  const cmpThingDue = (a, b) => (a.soonest && b.soonest ? cmpDue(a.soonest, b.soonest) : a.soonest ? -1 : b.soonest ? 1 : 0) || cmp(lower(a.name), lower(b.name)) || cmp(a.id, b.id);
  const SORTS = {
    tasks: { due: cmpDue, name: (a, b) => cmp(lower(a.task), lower(b.task)) || cmp(lower(a.thing), lower(b.thing)) || cmp(jarRank(a.jar), jarRank(b.jar)) || cmp(a.id, b.id) },
    things: { due: cmpThingDue, name: (a, b) => cmp(lower(a.name), lower(b.name)) || cmp(jarRank(a.jar), jarRank(b.jar)) || cmp(a.id, b.id) },
  };
  const matcher = (st, tasks) => {
    const q = fold(st.search), has = (...fs) => !q || fs.some((f) => fold(f).includes(q));
    const jarOk = (j) => !st.jars.length || st.jars.includes(j), stOk = (ss) => !st.statuses.length || ss.some((s) => st.statuses.includes(s));
    return tasks
      ? (r) => jarOk(r.jar) && stOk([r.status]) && has(r.task, r.thing, JAR_LABEL[r.jar])
      : (t) => jarOk(t.jar) && stOk(t.statuses) && has(t.name, JAR_LABEL[t.jar], ...t.tasks.map((r) => r.task));
  };
  // The list for a state: items (all matches, sorted), shown (the first `limit`), groups (jar headings, Jar sort only), footer (the cap's "Showing 50 of N").
  function run(model, st) {
    const tasks = st.view === "tasks", all = tasks ? model.rows : model.things;
    const items = all.filter(matcher(st, tasks));
    const by = st.sort === "jar" ? (a, b) => cmp(jarRank(a.jar), jarRank(b.jar)) || SORTS[st.view].due(a, b) : SORTS[st.view][st.sort] || SORTS[st.view].due;
    items.sort(by);
    const shown = items.slice(0, st.limit), left = items.length - shown.length;
    const groups = st.sort === "jar" ? JAR_KEYS.map((j) => ({ jar: j, label: JAR_LABEL[j], items: shown.filter((x) => x.jar === j) })).filter((g) => g.items.length) : null;
    const overdue = items.filter((x) => (tasks ? x.status === "Overdue" : x.statuses.includes("Overdue"))).length;
    return { items, shown, groups, total: all.length, count: items.length, overdue, footer: left > 0 ? { shown: shown.length, of: items.length, more: Math.min(PAGE_STEP, left) } : null };
  }
  // Chip counts for the current View, with nothing filtered (the mockup's counts do not move with the filters or the search).
  function counts(model, view) {
    const tasks = view === "tasks", all = tasks ? model.rows : model.things, c = { all: all.length, jars: {}, statuses: {} };
    for (const j of JAR_KEYS) c.jars[j] = all.filter((x) => x.jar === j).length;
    for (const s of STATUSES) c.statuses[s] = all.filter((x) => (tasks ? x.status === s : x.statuses.includes(s))).length;
    return c;
  }
  // Same list as run() would give for a pending (unapplied) state, but only its count, for the Filter sheet's "Show 4 Tasks".
  const countFor = (model, st) => model[st.view === "tasks" ? "rows" : "things"].filter(matcher(st, st.view === "tasks")).length;
  // The status line (AC 2): always names the mode; adds "N of M" when filtered, the search text, or the overdue count.
  function statusLine(res, st) {
    const q = st.search.trim().replace(/\s+/g, " ").slice(0, 40), tasks = st.view === "tasks", n = isFiltered(st) ? `${res.count} of ${res.total}` : String(res.total);
    let s = tasks ? `All tasks · ${n}` : `${n} ${!isFiltered(st) && res.total === 1 ? "asset" : "assets"}`;
    if (q) s += ` match “${q}”`; else if (res.overdue) s += ` · ${res.overdue} overdue`;
    return s;
  }

  const api = { JAR_KEYS, JAR_LABEL, STATUSES, SOON_DAYS, PAGE_FIRST, PAGE_STEP, statusOf, ruleText, seasonChip, cmpDue, buildModel, defaultState, setState, toggled, filterCount, isFiltered, run, counts, countFor, statusLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Assets = api;
})(typeof self !== "undefined" ? self : this);
