/* Pickle It: the rules of Home setup (S4b-2; spec v1-scope 4.7 AC 8, 4.13 AC 4, 4.15, 4.16; data-model 2.3b, 2.3d, 7.2, 7.5; mockups home-setup.html, home-setup-quantity.html).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in). Loads in the browser as the global `SetupHome` (after setup.js) and in Node via require().
   The screen (setup-screen.js) keeps one `home` object while the Add flow is open. It holds the place (house name and icon), the picks (kind -> count and copies),
   and one draft per copy that has been visited. NOTHING is saved by anything here: planHome() returns every thing, task and starting log for one commit().
   A copy is { typed, d }: the name the person typed ("" = use the default) and its Setup draft. Drafts are keyed by copy position, never by kind (data-model 7.1).
   Dropped copies (Remove, or a lowered count) are held whole in `held` for the 8-second Undo, then forgotten (data-model 7.5). Tested in tests/s4b2-check.mjs. */
(function (root) {
  "use strict";
  const req = typeof module !== "undefined" && module.exports;
  const SU = req ? require("./setup.js") : root.Setup;
  const { clean, key } = SU;
  const MAX_COPIES = 5;

  const o = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
  const POWER = o(["gas", "Gas"], ["electric", "Electric"]);
  // The chips, in chip order (mockup home-setup-quantity.html). dd = the type dropdowns in the order the page shows them; they match KIND_TYPES in data.js (checked by the test).
  const KINDS = [
    { kind: "hvac", label: "HVAC", sub: "Pick a type for each thing and your tasks appear", dd: [
      { label: "Furnace Type", options: o(["gas", "Gas"], ["electric", "Electric"], ["heat-pump", "Heat Pump"], ["oil", "Oil"], ["none", "None"]) },
      { label: "Air Conditioner Type", options: o(["central", "Central"], ["window-unit", "Window Unit"], ["heat-pump", "Heat Pump"], ["mini-split", "Mini Split"], ["none", "None"]) },
      { label: "Ducting Type", options: o(["ducted", "Ducted"], ["ductless", "Ductless"], ["none", "None"]) }] },
    { kind: "water-heater", label: "Water Heater", sub: "Pick a power type and your tasks appear", dd: [{ label: "Power Type", options: POWER }] },
    { kind: "washer", label: "Washer", sub: "Pick the tasks you want", dd: [] },
    { kind: "dryer", label: "Dryer", sub: "Pick a power type and your tasks appear", dd: [{ label: "Power Type", options: POWER }] },
    { kind: "fridge", label: "Fridge", sub: "Pick the tasks you want", dd: [] },
    { kind: "dishwasher", label: "Dishwasher", sub: "Pick the tasks you want", dd: [] },
    { kind: "range-hood", label: "Range Hood", sub: "Pick the tasks you want", dd: [] },
    { kind: "snow-blower", label: "Snow Blower", sub: "Pick a power type and your tasks appear", dd: [{ label: "Power Type", options: POWER }] },
    { kind: "generator", label: "Generator", sub: "Pick a power type and a generator type and your tasks appear", dd: [
      { label: "Power Type", options: POWER }, { label: "Generator Type", options: o(["portable", "Portable"], ["standby", "Standby"]) }] },
    { kind: "power-tools", label: "Outdoor Power Tools", sub: "Choose your tool type to fill in the tasks", dd: [
      { label: "Tool Type", options: o(["string-trimmer", "String Trimmer"], ["leaf-blower", "Leaf Blower"], ["chainsaw", "Chainsaw"]) }] },
    { kind: "mower", label: "Mower", sub: "Pick a power type and a mower type and your tasks appear", dd: [
      { label: "Power Type", options: POWER }, { label: "Mower Type", options: o(["push", "Push Mower"], ["lawn-tractor", "Lawn Tractor"], ["zero-turn", "Zero Turn"]) }] },
  ];
  const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
  const labelOf = (kind) => KIND[kind].label;

  // ---------- the home ----------
  // ctx.existing = the things already saved ({ jar, name }): the house name defaults to "Home" only while that is free.
  function newHome(ctx = {}) {
    const taken = (ctx.existing || []).some((v) => v.jar === "home" && key(v.name) === key(SU.DEFAULT_NAME.home));
    const h = { place: { name: taken ? "" : SU.DEFAULT_NAME.home, icon: SU.ICON_CHOICES.home[0][0] }, house: null, picks: {}, held: null };
    h.base = { name: h.place.name, icon: h.place.icon };
    return h;
  }
  const blankCopy = () => ({ typed: "", d: null });
  const picked = (h) => KINDS.filter((k) => h.picks[k.kind]).map((k) => ({ kind: k.kind, label: k.label, count: h.picks[k.kind].count }));
  const total = (h) => picked(h).reduce((n, p) => n + p.count, 0);
  // Anything typed, picked or changed since the flow opened? (The jar pick itself is not a change.)
  const isDirty = (h) => h.place.name !== h.base.name || h.place.icon !== h.base.icon || Object.keys(h.picks).length > 0 || !!h.held || !!(h.house && SU.isDirty(h.house));

  // ---------- picks, the quantity sheet, Remove and Undo (4.15) ----------
  function pick(h, kind) { // one tap: quantity 1, no sheet (AC 2)
    if (!KIND[kind]) throw new Error("unknown kind " + kind);
    if (h.held && h.held.kind === kind) h.held = null; // a new pick starts blank
    if (!h.picks[kind]) h.picks[kind] = { count: 1, copies: [blankCopy()] };
    return h;
  }
  // The default name shown in a sheet field before anything is typed (AC 7). Outdoor Power Tools has none: it is named after its Tool Type later (AC 16).
  const sheetDefault = (kind, i) => (i ? `${labelOf(kind)} ${i + 1}` : labelOf(kind));
  // What the sheet opens with: { count, typed: [..] } (a working copy; the pick is not touched until applySheet).
  function sheetOpen(h, kind) { const p = h.picks[kind]; return { count: p.count, typed: p.copies.map((c) => c.typed) }; }
  const typedElsewhere = (h, kind) => { // typed names on every other page (and the house), for the clash checks
    const out = []; if (clean(h.place.name)) out.push(clean(h.place.name));
    for (const k of KINDS) if (k.kind !== kind && h.picks[k.kind]) for (const c of h.picks[k.kind].copies) if (clean(c.typed)) out.push(clean(c.typed));
    return out;
  };
  // Tapping Done: null when the names are fine, else { index, message } for the field to mark (AC 8). work = { count, typed }.
  function checkSheet(h, kind, work, ctx) {
    const n = work.count, shown = Array.from({ length: n }, (_, i) => clean(work.typed[i]) || sheetDefault(kind, i)), typed = Array.from({ length: n }, (_, i) => clean(work.typed[i]));
    const lower = KIND[kind].label === KIND[kind].label.toUpperCase() ? KIND[kind].label : KIND[kind].label.toLowerCase();
    const same = `Names must be different. ${/\s/.test(lower) && lower !== KIND[kind].label ? "Try adding a place, like Garage." : `Try Garage ${lower}.`}`, others = typedElsewhere(h, kind).map(key);
    for (let i = 0; i < n; i++) {
      if (Array.from(typed[i]).length > 80) return { index: i, message: "Use 80 characters or fewer." };
      if (typed[i] && ctx.nameTaken("home", typed[i])) return { index: i, message: "You already have a thing called that in Home." };
      if (typed[i] && others.includes(key(typed[i]))) return { index: i, message: same };
    }
    for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) if (key(shown[i]) === key(shown[j])) return { index: typed[j] || !typed[i] ? j : i, message: same };
    return null;
  }
  // Tapping Done with good names. Returns { dropped: [copy..] } (a lowered count drops the last copies, held for Undo) or { raised: n }.
  function applySheet(h, kind, work) {
    const p = h.picks[kind], was = p.count;
    p.count = work.count;
    if (work.count > was) for (let i = was; i < work.count; i++) p.copies.push(blankCopy());
    const dropped = work.count < was ? p.copies.splice(work.count) : [];
    p.copies.forEach((c, i) => { c.typed = clean(work.typed[i]); });
    if (dropped.length) h.held = { kind, type: "lower", at: work.count, copies: dropped }; // raising or renaming leaves a pending Undo alone
    return { dropped, raised: Math.max(0, work.count - was) };
  }
  function remove(h, kind) { // unpick the chip; the whole pick, its names and filled-in pages wait for Undo
    const p = h.picks[kind]; delete h.picks[kind];
    h.held = { kind, type: "remove", copies: p.copies };
    return h;
  }
  // Undo within the window. A removed pick comes back whole. A lowered count gets its copies back at their old places (copies added since are replaced). Returns the kind, or null.
  function undo(h) {
    const x = h.held; if (!x) return null;
    if (x.type === "remove") h.picks[x.kind] = { count: x.copies.length, copies: x.copies };
    else { const p = h.picks[x.kind]; if (!p) return null; p.copies = [...p.copies.slice(0, x.at), ...x.copies]; p.count = p.copies.length; }
    h.held = null;
    return x.kind;
  }
  const dropHeld = (h) => { h.held = null; return h; };

  // ---------- the page queue (AC 11) ----------
  // The house tasks page, then one page per copy in chip order, all copies of a kind together.
  function pages(h) {
    const out = [{ key: "house", kind: null, i: 0 }];
    for (const p of picked(h)) for (let i = 0; i < p.count; i++) out.push({ key: `${p.kind}:${i}`, kind: p.kind, i });
    return out;
  }
  const copyOf = (h, pg) => h.picks[pg.kind].copies[pg.i];
  // The page's draft; made on first use. store:false (planning) makes a fresh one and keeps nothing.
  function draftOf(h, pg, { store = true } = {}) {
    const have = pg.kind ? copyOf(h, pg).d : h.house;
    if (have) return have;
    const d = SU.newDraft("home", { kind: pg.kind, queued: true });
    if (store) { if (pg.kind) copyOf(h, pg).d = d; else h.house = d; }
    return d;
  }
  const typedName = (h, pg) => (pg.kind ? clean(copyOf(h, pg).typed) : clean(h.place.name));

  // ---------- names (AC 7, 8, 14, 16; 4.16) ----------
  // The name a copy gets when none was typed: its kind name; an Outdoor Power Tools copy takes its Tool Type once chosen (AC 16).
  function baseName(h, pg) {
    if (!pg.kind) return SU.DEFAULT_NAME.home; // the house, only while its name is blank
    if (pg.kind === "power-tools") { const t = draftOf(h, pg, { store: false }).types[0], opt = KIND[pg.kind].dd[0].options.find((x) => x.value === t); if (opt) return opt.label; }
    return labelOf(pg.kind);
  }
  // Every page's name as it would be saved now: { key -> { name, typed } }. Typed names are kept exactly (trimmed); the rest take the first free of "Name", "Name 2", "Name 3"... in the Home jar,
  // counting things already saved and every other name in the queue, so removing "Fridge 2" while "Fridge 3" exists leaves no gap (AC 14). Run again at the final confirm.
  function resolveNames(h, ctx) {
    const pgs = pages(h), out = {}, claimed = new Set(pgs.map((pg) => typedName(h, pg)).filter(Boolean).map(key));
    for (const pg of pgs) if (typedName(h, pg)) out[pg.key] = { name: typedName(h, pg), typed: true };
    for (const pg of pgs) {
      if (out[pg.key]) continue;
      const base = baseName(h, pg); let n = 1, cand = base;
      while (claimed.has(key(cand)) || ctx.nameTaken("home", cand)) cand = `${base} ${++n}`;
      claimed.add(key(cand)); out[pg.key] = { name: cand, typed: false };
    }
    return out;
  }
  // Typed names that can't be saved: { pageKey -> message }. A blank house name is an error; a blank copy name is not (it falls back to its default).
  function checkNames(h, ctx) {
    const out = {}, seen = new Map();
    for (const pg of pages(h)) {
      const t = typedName(h, pg);
      if (pg.kind && !t) continue;
      const p = SU.nameProblem("home", t, ctx);
      if (p) out[pg.key] = p; else if (seen.has(key(t))) out[pg.key] = "Names must be different."; else seen.set(key(t), pg.key);
    }
    return out;
  }

  // One page's typed name, for Next on that page: the problem with it against the jar and every other typed name in the queue, earlier or later ("" = fine).
  function checkName(h, pgKey, ctx) {
    const pgs = pages(h), pg = pgs.find((p) => p.key === pgKey), t = typedName(h, pg);
    if (pg.kind && !t) return "";
    const p = SU.nameProblem("home", t, ctx);
    return p || (pgs.some((o) => o.key !== pgKey && typedName(h, o) && key(typedName(h, o)) === key(t)) ? "Names must be different." : "");
  }

  // ---------- types (AC 8d, 8e; 4.13 AC 4) ----------
  const ddOf = (d) => (d.kind ? KIND[d.kind].dd : []);
  const typesMissing = (d) => ddOf(d).filter((x, i) => !d.types[i]).map((x) => x.label);
  const setType = (d, i, value) => { const t = ddOf(d).map((x, j) => d.types[j] || ""); t[i] = ddOf(d)[i].options.some((x) => x.value === value) ? value : ""; return SU.setTypes(d, t); };
  const missingText = (d) => { const m = typesMissing(d); return m.length ? `Next is unavailable. Choose ${m.length > 1 ? m.slice(0, -1).map((x) => (/^[AEIOU]/.test(x) ? "an " : "a ") + x).join(", ") + " and " + (/^[AEIOU]/.test(m[m.length - 1]) ? "an " : "a ") + m[m.length - 1] : (/^[AEIOU]/.test(m[0]) ? "an " : "a ") + m[0]} first.` : ""; };

  // ---------- the plan: every thing, task and starting log, ready for one commit() ----------
  // ctx = { today, nameTaken, deps }. Returns { errors: { pageKey: { thing, rows } }, first: pageKey } or { things, logs, summary, counts }.
  // Nothing is written here and no draft is changed.
  function planHome(h, ctx) {
    const pgs = pages(h), names = checkNames(h, ctx), errors = {};
    for (const pg of pgs) {
      const d = draftOf(h, pg, { store: false }), thing = SU.checkThing(d, ctx);
      if (names[pg.key]) thing.name = names[pg.key];
      if (typesMissing(d).length) thing.types = "Pick a type for each thing";
      const rows = SU.checkRows(d, ctx);
      if (Object.keys(thing).length || Object.keys(rows).length) errors[pg.key] = { thing, rows };
    }
    if (Object.keys(errors).length) return { errors, first: pgs.find((pg) => errors[pg.key]).key };
    const final = resolveNames(h, ctx), things = [], logs = [], summary = [];
    for (const pg of pgs) {
      const d0 = draftOf(h, pg, { store: false }), d = pg.kind ? d0 : { ...d0, icon: h.place.icon };
      const p = SU.buildThing(d, ctx, final[pg.key].name);
      if (p.errors) return { errors: { [pg.key]: { thing: { name: p.errors.general || "Could not save this one." }, rows: {} } }, first: pg.key };
      things.push(p.thing); logs.push(...p.logs);
      summary.push({ key: pg.key, name: p.thing.name, kind: pg.kind, on: p.counts.on, off: p.counts.off, logs: p.counts.logs, custom: p.counts.custom, pausedNames: p.counts.pausedNames });
    }
    const sum = (f) => summary.reduce((n, x) => n + x[f], 0);
    return { things, logs, summary, counts: { things: things.length, on: sum("on"), off: sum("off"), logs: sum("logs"), custom: sum("custom"), pausedNames: summary.flatMap((x) => x.pausedNames) } };
  }
  // 0% on the first page, 100% on the confirm page, one equal step per page in between (4.7 AC 10, 4.15 AC 11). pageCount counts every page including the jar pick and the confirm.
  const stepPercent = (i, pageCount) => (pageCount < 2 ? 0 : Math.round((i / (pageCount - 1)) * 100));

  const api = { KINDS, KIND, MAX_COPIES, labelOf, newHome, picked, total, isDirty, pick, sheetDefault, sheetOpen, checkSheet, applySheet, remove, undo, dropHeld, pages, draftOf, typedName,
    baseName, resolveNames, checkNames, checkName, typesMissing, setType, missingText, planHome, stepPercent };
  if (req) module.exports = api; else root.SetupHome = api;
})(typeof self !== "undefined" ? self : this);
