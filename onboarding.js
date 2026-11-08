/* Pickle It: the rules of first run (S4b-3; spec v1-scope 4.2 AC 12, 4.7 AC 2, 6, 7, 11, 4.13 AC 7; mockups pantry.html P9, onboarding.html O1, O3-O3c, O8, home-setup.html H12, jars.html J11).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in). Loads in the browser as the global `Onboarding` (after setup-home.js) and in Node via require().
   It holds: what an empty Pantry or jar shows, the Vehicles queue (several vehicle forms, "Add Another Vehicle"), the "Your Pantry Is Stocked" summary and which jars start hidden.
   Nothing here saves anything: planVehicles() returns the records for one commit(), like SetupHome.planHome(). Tested in tests/s4b3-check.mjs. */
(function (root) {
  "use strict";
  const req = typeof module !== "undefined" && module.exports;
  const SU = req ? require("./setup.js") : root.Setup;
  const { clean, key } = SU;
  const JAR_ORDER = SU.ADD_JARS.map((j) => j.key);

  // ---------- what an empty Pantry shows (4.2 AC 12; P9, O1) ----------
  const FIRST_LABEL = { vehicles: "A Vehicle", home: "A Home", health: "A Person", finance: "A Household" };
  const FIRST_STEPS = SU.ADD_JARS.map((j) => ({ jar: j.key, label: FIRST_LABEL[j.key] }));
  const WELCOME = {
    lead: "Empty shelves.",
    hint: "Add the first thing you want to keep in good shape. We'll stock it with common tasks you can pick from.",
    about: "Pickle It tracks oil changes, furnace filters, check-ups and money deadlines, and tells you what's due. No account. Everything is saved on this device only.",
    iosBold: "On iPhone? Add Pickle It to your Home Screen first,",
    iosRest: "then open it from there. What you enter in a Safari tab stays in Safari, and Safari can clear it if you don't visit often.",
  };
  // The Pantry with no things at all shows the first-step prompt instead of four empty boxes. The iPhone note shows only in iPhone or iPad Safari, not in the installed app.
  function firstRunView(things, { ios = false, standalone = false } = {}) {
    return { firstRun: !things.length, iosNote: !!ios && !standalone, steps: FIRST_STEPS };
  }
  // A shown jar with nothing in it (J11).
  const EMPTY_JAR = {
    vehicles: { lead: "This jar's still empty.", hint: "Name your vehicle, then pick tasks like oil changes and tire rotations.", button: "Set Up Vehicles" },
    home: { lead: "This jar's still empty.", hint: "Name your house, then pick any appliances or engines and the tasks for each.", button: "Set Up Home" },
    health: { lead: "This jar's still empty.", hint: "Add yourself or someone in your family, then pick check-ups and renewals. No medical details needed.", button: "Set Up Health" },
    finance: { lead: "This jar's still empty.", hint: "Name your household or account, then pick deadlines like tax dates and renewals. No amounts or account numbers needed.", button: "Set Up Finance" },
  };

  // ---------- which jars start hidden (4.7 AC 7) ----------
  // The hidden list after things were saved in `added` jars. The first thing ever, with nothing hidden yet: the jars not picked start hidden.
  // Adding more during setup (onboarding): a jar picked now shows. Any other add (from Assets) leaves the list alone.
  function hiddenAfterAdd({ hidden, hadThings, onboarding, added }) {
    if (!hadThings && !hidden.length) return JAR_ORDER.filter((j) => !added.includes(j));
    if (onboarding) return hidden.filter((j) => !added.includes(j));
    return hidden.slice();
  }
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const hiddenChanged = (before, after) => !same(before, after);
  const andList = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

  // ---------- the summary: "Your Pantry Is Stocked" (O8, H12) ----------
  const newSession = () => ({ rows: [], jars: [] });
  // summary = [{ name, on, off }] from the plan; jars = the jars those things are in. Several adds in one setup session pile up in order.
  function addToSession(sess, summary, jars) {
    for (const s of summary) sess.rows.push({ name: s.name, on: s.on, off: s.off || 0 });
    for (const j of jars) if (!sess.jars.includes(j)) sess.jars.push(j);
    return sess;
  }
  const taskCount = (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "task" : "tasks"}`;
  // "10 tasks" (the ticked ones; paused starter tasks are kept on the thing, not counted here, as in the mockup).
  const rowText = (r) => taskCount(r.on);
  const totalTasks = (sess) => sess.rows.reduce((n, r) => n + r.on, 0);
  function hiddenNote(hidden) {
    const names = JAR_ORDER.filter((j) => hidden.includes(j)).map((j) => SU.JAR_LABEL[j]);
    if (!names.length) return "";
    return `${andList(names)} ${names.length === 1 ? "is" : "are"} hidden. Show ${names.length === 1 ? "it" : "them"} anytime in Settings › App Settings.`;
  }
  const stockedSay = (sess) => `Your pantry is stocked. ${sess.rows.length === 1 ? "1 thing" : sess.rows.length + " things"} added, ${taskCount(totalTasks(sess))}.`;

  // ---------- the Vehicles queue (4.7 AC 11, 4.13 AC 7; O3, O3b, O3c) ----------
  // forms: one Setup draft per vehicle form. Each press of "Add Another Vehicle" adds a blank form below; earlier forms stay as typed. Each form gets its own task page.
  function newVehicles(ctx = {}) {
    const v = { ctx, forms: [], next: 1 };
    addForm(v);
    return v;
  }
  function addForm(v) {
    const f = { key: "v" + v.next++, d: SU.newDraft("vehicles", { existing: v.ctx.existing }) };
    v.forms.push(f);
    return f;
  }
  // Anything typed or changed since the flow opened (a second form counts)? The jar pick itself is not a change.
  const vehiclesDirty = (v) => v.forms.length > 1 || v.forms.some((f) => SU.isDirty(f.d));
  const pageKey = (f) => "veh:" + f.key;
  const formOf = (v, pk) => v.forms.find((f) => pageKey(f) === pk);
  // A form with nothing typed or changed is ignored, so a spare Add Another form is not an error. If every form is blank the first one stays, so the usual name error shows.
  const activeForms = (v) => { const a = v.forms.filter((f) => SU.isDirty(f.d)); return a.length ? a : v.forms.slice(0, 1); };
  // Page 2 checks for every form: { formKey: { name?, odometer? } }. An empty name is an error on its own form; a name used twice in the queue is an error on the later one.
  function checkForms(v, ctx) {
    const out = {}, seen = new Set();
    for (const f of activeForms(v)) {
      const e = SU.checkThing(f.d, ctx), k = key(f.d.name);
      if (!e.name) { if (seen.has(k)) e.name = "Names must be different."; else seen.add(k); }
      if (Object.keys(e).length) out[f.key] = e;
    }
    return out;
  }
  // The pages in order after the forms: one task page per vehicle, in the order the forms are.
  const taskPages = (v) => activeForms(v).map(pageKey);
  // The whole queue checked, then built: { errors: { pageKey: { thing, rows } }, first: pageKey } or { things, logs, summary, counts }.
  function planVehicles(v, ctx) {
    const thing = checkForms(v, ctx), errors = {}, forms = activeForms(v);
    for (const f of forms) {
      const rows = SU.checkRows(f.d, ctx);
      if (thing[f.key] || Object.keys(rows).length) errors[pageKey(f)] = { thing: thing[f.key] || {}, rows };
    }
    if (Object.keys(errors).length) return { errors, first: pageKey(forms.find((f) => errors[pageKey(f)])) };
    const things = [], logs = [], summary = [];
    for (const f of forms) {
      const p = SU.buildThing(f.d, ctx, clean(f.d.name));
      if (p.errors) return { errors: { [pageKey(f)]: { thing: { name: p.errors.general || "Could not save this one." }, rows: {} } }, first: pageKey(f) };
      things.push(p.thing); logs.push(...p.logs);
      summary.push({ key: f.key, name: p.thing.name, on: p.counts.on, off: p.counts.off, logs: p.counts.logs, custom: p.counts.custom, pausedNames: p.counts.pausedNames });
    }
    const sum = (k) => summary.reduce((n, x) => n + x[k], 0);
    return { things, logs, summary, counts: { things: things.length, on: sum("on"), off: sum("off"), logs: sum("logs"), custom: sum("custom"), pausedNames: summary.flatMap((x) => x.pausedNames) } };
  }

  const api = { FIRST_STEPS, WELCOME, EMPTY_JAR, firstRunView, hiddenAfterAdd, hiddenChanged, hiddenNote, newSession, addToSession, rowText, totalTasks, stockedSay,
    newVehicles, addForm, activeForms, vehiclesDirty, pageKey, formOf, checkForms, taskPages, planVehicles };
  if (req) module.exports = api; else root.Onboarding = api;
})(typeof self !== "undefined" ? self : this);
