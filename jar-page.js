/* Pickle It: the shared jar page, pure rules (spec v1-scope 4.21; mockup docs/design/jar-page.html).
   No storage, no DOM, never reads the clock (today and rows are passed in). Loads in the browser as the global `JarPage` (after due.js and assets.js) and in Node via require().
   The page's boxes are the Pantry's own (Due.pantryBoxes) for one jar; the Things list is Assets.run for one jar. jar-screen.js draws and saves. Tested in tests/r2-check.mjs. */
(function (root) {
  "use strict";
  const req = typeof module !== "undefined" && module.exports;
  const D = req ? require("./due.js") : root.Due, A = req ? require("./assets.js") : root.Assets;
  const JARS = ["vehicles", "home", "health", "finance"];
  const NAME = { vehicles: "Vehicles", home: "Home", health: "Health", finance: "Finance" };
  const ADD_LABEL = { vehicles: "Add a Vehicle", home: "Add a Home", health: "Add a Person", finance: "Add a Household" };
  const FIRST = 50, STEP = 100; // 4.21 AC 4 (as 4.17 AC 8)
  const FINANCE_LINE = "No deadlines this week. Your coins are in the jar."; // docs/design/system.md, Finance, This week

  const attnText = (n) => (n === 0 ? "Nothing needs attention this week" : n === 1 ? "1 task needs attention this week" : `${n.toLocaleString("en-US")} tasks need attention this week`);

  // The page's rows: this jar's tasks in the four Pantry boxes. attn = Overdue + Due This Week (the jar's red dot, 4.21 AC 2); total = rows in any box.
  function boxesFor(rows, jar) {
    const mine = rows.filter((r) => r.jar === jar), v = D.pantryBoxes(mine);
    return { boxes: v.boxes, attn: v.attn, total: mine.length };
  }
  // 4.21 AC 3: the witty line only when nothing is in Overdue or Due This Week and the jar has a task in some box. Pantry rows already leave out inactive things and paused tasks,
  // so a jar of only inactive things, of things with no tasks, or of only paused tasks gets none.
  const wittyShown = (page) => page.attn === 0 && page.total > 0;
  const wittyLine = (jar, today, lines) => (jar === "finance" ? FINANCE_LINE : lines[Math.floor(Date.parse(today) / 864e5) % lines.length]);

  // A box's rows up to `limit`, and the "Showing 50 of N" footer with the size of the next step (the smaller of 100 and what is left).
  function cap(list, limit = FIRST) {
    const shown = list.slice(0, limit), left = list.length - shown.length;
    return { shown, footer: left > 0 ? { shown: shown.length, of: list.length, more: Math.min(STEP, left) } : null };
  }

  // The Things list: this jar's things in Next Due order, active things first and inactive last (QA R2 ruling; their hidden tasks would otherwise rank them by a date the row doesn't show), capped. model = Assets.buildModel(...).
  function thingsFor(model, jar, limit = FIRST) {
    const res = A.run(model, { ...A.defaultState(), jars: [jar], sort: "due", limit: Infinity });
    const items = [...res.items.filter((t) => t.active), ...res.items.filter((t) => !t.active)], shown = items.slice(0, limit), left = items.length - shown.length;
    return { total: items.length, shown, footer: left > 0 ? { shown: shown.length, of: items.length, more: Math.min(STEP, left) } : null };
  }
  // The row's second line (4.21 AC 5): "3 tasks" / "1 task" / "No tasks"; "Inactive · 3 tasks" with no due text for an inactive thing; otherwise the soonest task or "all paused".
  function thingMeta(t) {
    const n = t.tasks.length, count = n === 0 ? "No tasks" : n === 1 ? "1 task" : `${n} tasks`;
    if (!t.active) return { count: "Inactive · " + count, soonest: null, allPaused: false };
    return { count, soonest: t.soonest, allPaused: n > 0 && !t.soonest };
  }

  // 4.21 AC 8e. clean = cleanText from data.js (trim, strip invisible characters, cut at 80 characters); except = the row being renamed.
  // Returns { name, error, cut }: a blank name, or a duplicate of another shop ignoring capitals and composed vs decomposed accents (NFC). Nothing is written when error is set.
  // cut is true when the typed name was longer than 80 characters and name is the cut one (QA R2 finding 8b).
  function shopNameCheck(raw, list, except = -1, clean) {
    const name = clean(raw, 80), cut = !!name && clean(raw, 1e6) !== name, key = (x) => String(x).trim().normalize("NFC").toLowerCase();
    if (!name) return { name, error: "Enter a shop name.", cut };
    if (list.some((s, i) => i !== except && key(s) === key(name))) return { name, error: `${name} is already in your list.`, cut };
    return { name, error: null, cut };
  }

  const api = { JARS, NAME, ADD_LABEL, FIRST, STEP, FINANCE_LINE, attnText, boxesFor, wittyShown, wittyLine, cap, thingsFor, thingMeta, shopNameCheck };
  if (req) module.exports = api; else root.JarPage = api;
})(typeof self !== "undefined" ? self : this);
