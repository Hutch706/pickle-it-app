"use strict";
/* Pickle It: the Assets tab screen (spec v1-scope 4.17, mockup settings-option-c.html CF1-CF13).
   Draws the list, the Filter and Sort sheets and a read-only task list for one thing. The rules live in assets.js (pure, tested in tests/s2-check.mjs).
   Nothing is stored: Filter, Sort, View, jar chips and search are kept in memory and reset when the person leaves Settings (AC 12).
   Editing a thing and its tasks is assets-edit.js (S3). Loaded after pantry.js (uses ico, rowIcon, dueView, liveSay) and before app.js, which calls setupAssets(), renderAssets() and resetAssets(). */

const asS = { st: Assets.defaultState(), model: null, detail: null, draft: null, task: null }; // task: { mode: "edit" | "add", id } while a task form is open (assets-edit.js)
const asVH = (t) => el("span", "vh", t);
const asNoun = (n, tasks) => (tasks ? (n === 1 ? "task" : "tasks") : n === 1 ? "thing" : "things");
const SORT_OPTS = [["jar", "Jar", "Groups under Vehicles, Home, Health and Finance"], ["due", "Next Due", "Overdue first, then the soonest"], ["name", "Name", "A to Z"]];
const SORT_NAME = Object.fromEntries(SORT_OPTS.map(([k, n]) => [k, n]));

// A task's due text as the Pantry shows it (dueView), plus the one case the Pantry never meets: a task with no rule to date it.
function asDue(r) {
  const v = !r.noDate && r.text == null && r.days == null ? { parts: ["No due date"], vh: "No due date." } : { ...dueView(r) };
  if (v.over && r.status !== "Overdue") v.vh = v.vh.replace(/^Overdue since /, "Was due ").replace(/^Overdue, /, ""); // switched off: spoken as Paused, never Overdue
  return { ...v, over: !!v.over && r.status === "Overdue" }; // a switched-off task keeps its date but not the Overdue badge
}
const asJarName = (j) => Assets.JAR_LABEL[j];
const asMarks = (o) => [o.active === false || o.thingActive === false ? "Inactive" : "", o.hiddenJar ? "Hidden jar" : ""].filter(Boolean);

// ---------- list rows ----------
function asSeason(r) {
  if (!r.season) return null;
  const s = el("span", "season" + (r.season.closed ? " off" : ""));
  const vis = el("span", null, r.season.text); vis.setAttribute("aria-hidden", "true");
  s.append(vis, asVH(r.season.spoken));
  return s;
}
function asThingRow(t, showJar) {
  const b = el("button", "arow"); b.type = "button"; b.dataset.row = t.id; b.dataset.thing = t.id;
  const av = el("span", "av"); av.append(ico(rowIcon(t)));
  const mt = el("span", "mt"), parts = [];
  if (showJar) parts.push(asJarName(t.jar));
  parts.push(...asMarks(t));
  parts.push(t.tasks.length ? `${t.tasks.length} ${asNoun(t.tasks.length, true)}` : "No tasks");
  mt.append(parts.join(" · "));
  const s = t.soonest;
  if (s) {
    const v = asDue(s), tx = v.over ? "Overdue: " + s.task : v.ask ? s.task : `${s.task} ${v.parts.join(" ")}`;
    mt.append(" · ", el("b", v.over ? "over" : "", tx));
  } else if (t.tasks.length) mt.append(" · all paused");
  const ch = el("span", "ch"); ch.append(ico("chevr"));
  b.append(av, el("span", "nm", t.name), ch, mt);
  return b;
}
function asTaskRow(r) {
  const v = asDue(r), b = el("button", "krow" + (v.over ? " over" : "")); b.type = "button"; b.dataset.row = r.id; b.dataset.thing = r.thingId;
  const av = el("span", "av"); av.append(ico(rowIcon(r)));
  const kd = el("span", "kd");
  const vis = el("span"); vis.setAttribute("aria-hidden", "true");
  if (v.over) { const bd = el("span", "badge err"); bd.append(ico("alert"), "Overdue"); vis.append(bd, el("small", null, v.parts.join(" "))); }
  else { vis.append(v.parts.join(" ")); if (r.status === "Paused" && r.off) vis.append(el("small", null, "Switched off")); }
  kd.append(vis);
  const ks = el("span", "ks"), where = [r.thing, asJarName(r.jar), ...asMarks(r)].join(" · ");
  ks.append(el("span", null, where));
  const chip = asSeason(r); if (chip) ks.append(chip);
  b.append(av, el("span", "kn", r.task), kd, ks);
  const sent = (x) => (/[.!?]$/.test(x) ? x : x + ".");
  b.setAttribute("aria-label", [sent(`${r.task}, ${r.thing}, ${asJarName(r.jar)}${asMarks(r).map((m) => ", " + m.toLowerCase()).join("")}`), sent(v.vh), r.status === "Paused" && r.off ? "Switched off." : "", r.season ? r.season.spoken : ""].filter(Boolean).join(" "));
  return b;
}

// ---------- the screen ----------
function asChipLabel(btn, label, n) { btn.replaceChildren(label, el("span", "n", String(n))); }
function renderAssetsControls() {
  const st = asS.st, c = Assets.counts(asS.model, st.view), tasks = st.view === "tasks";
  for (const b of $("asView").children) { const on = b.dataset.view === st.view; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
  const n = Assets.filterCount(st);
  $("asFilterVal").textContent = n ? `${n} on` : "None"; $("asFilterBtn").dataset.on = String(n > 0);
  $("asSortVal").textContent = SORT_NAME[st.sort]; $("asSortBtn").dataset.on = String(st.sort !== "jar");
  const box = $("asChips");
  if (!box.children.length) for (const k of ["all", ...Assets.JAR_KEYS]) { const b = el("button", "fchip"); b.type = "button"; b.dataset.jar = k; box.append(b); }
  for (const b of box.children) {
    const k = b.dataset.jar, on = k === "all" ? !st.jars.length : st.jars.includes(k);
    asChipLabel(b, k === "all" ? "All" : asJarName(k), k === "all" ? c.all : c.jars[k]);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", `${k === "all" ? "All" : asJarName(k)}, ${k === "all" ? c.all : c.jars[k]} ${asNoun(k === "all" ? c.all : c.jars[k], tasks)}`);
  }
}
function renderAssetsList() {
  const st = asS.st, m = asS.model, res = Assets.run(m, st), tasks = st.view === "tasks", body = $("asBody");
  $("asStatus").textContent = Assets.statusLine(res, st);
  body.replaceChildren();
  $("asTools").hidden = $("asView").hidden = $("asAdd").hidden = !m.things.length;
  if (!m.things.length) { // C4: nothing yet. One button per jar the Add flow offers (Setup.ADD_JARS), then Import.
    const c = el("div", "card pempty"), big = ico("jar", "ic big");
    c.append(big, el("p", "lead", "Nothing on the shelves yet."), el("p", "hint", "Assets are the things you look after. Add one and pick its tasks."));
    for (const j of Setup.ADD_JARS) { const b = btn("btn2 wide", j.empty, (ev) => openSetup({ jar: j.key, opener: ev.currentTarget })); b.prepend(ico(suJarIcon[j.key])); b.dataset.add = j.key; c.append(b); }
    const imp = el("a", "btn2", "Import a Backup"); imp.href = "#settings"; imp.dataset.settingsTab = "app"; imp.style.textDecoration = "none"; imp.style.textAlign = "center";
    c.append(imp); body.append(c); return;
  }
  if (!res.count) { // CF8
    const c = el("div", "card pempty"), big = ico("cabinet", "ic big");
    c.append(big, el("p", "lead", `No ${asNoun(0, tasks)} match.`), el("p", "hint", `Loosen a filter and try again${st.search.trim() ? " or the search" : ""}. Not a dill in sight.`));
    const clr = btn("btn2", "Clear Filters", asClearOnScreen); clr.id = "asEmptyClear"; c.append(clr); body.append(c); return;
  }
  const rowOf = (x) => (tasks ? asTaskRow(x) : asThingRow(x, st.sort !== "jar"));
  const list = (items) => { const l = el("div", "list"); for (const x of items) l.append(rowOf(x)); return l; };
  if (res.groups) for (const g of res.groups) body.append(el("h2", null, g.label), list(g.items)); else body.append(list(res.shown));
  if (res.footer) {
    const f = res.footer, box = el("div", "cap");
    box.append(el("p", "hint", `Showing ${f.shown} of ${f.of} ${asNoun(f.of, tasks)}. Use Filter or search to narrow the list.`), btn("btn2", `Show ${f.more} More`, asShowMore));
    body.append(box);
  }
}
function asShowMore() {
  const was = Assets.run(asS.model, asS.st).shown.length;
  asS.st.limit += Assets.PAGE_STEP;
  renderAssetsList();
  const res = Assets.run(asS.model, asS.st);
  liveSay(`Showing ${res.shown.length} of ${res.count} ${asNoun(res.count, asS.st.view === "tasks")}.`);
  const rows = $("asBody").querySelectorAll("[data-row]");
  (rows[was] || rows[rows.length - 1])?.focus(); // the first row that was not there before
}
function asClearOnScreen() {
  const st = asS.st;
  Assets.setState(st, Assets.filterCount(st) ? { jars: [], statuses: [] } : { search: "" }); // with no filter set, the search is what is hiding everything
  if (!st.search) $("asSearch").value = "";
  renderAssetsControls(); renderAssetsList();
  $("asFilterBtn").focus();
}

// A redraw (new day, tab refocus, a save in another tab) rebuilds the rows: put focus back on the same control (a row by its id, anything else by its place among the controls).
const asKeys = (c) => [...c.querySelectorAll("button, a[href], input, select, textarea, h1")];
function asFocusKey() {
  const a = document.activeElement;
  for (const id of ["asBody", "asDetail"]) { const c = $(id); if (c.contains(a)) return { id, row: a.dataset.row || null, i: asKeys(c).indexOf(a) }; }
  return null;
}
function renderAssets() {
  const fk = asFocusKey();
  renderAssetsNow();
  if (fk && (!document.activeElement || document.activeElement === document.body)) {
    const c = $(fk.id), list = asKeys(c);
    (fk.row ? list.find((e) => e.dataset.row === fk.row) : list[fk.i])?.focus({ preventScroll: true });
  }
}
function renderAssetsNow() {
  if ($("screen-settings").hidden) return;
  let failed = false;
  try { asS.model = Assets.buildModel({ things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups, hiddenJars: S.hiddenJars }, today()); }
  catch { failed = true; asS.model = null; }
  $("asErr").hidden = $("asRetry").hidden = !failed;
  $("asMain").hidden = failed || !!asS.detail; $("asDetail").hidden = failed || !asS.detail;
  if (failed) { asS.detail = null; showAssetsChrome(true); return; }
  if (asS.detail && !asS.model.things.some((t) => t.id === asS.detail)) { asS.detail = null; asS.task = null; } // removed in another tab
  if (asS.detail) { renderAssetsDetail(); return; }
  showAssetsChrome(true); $("asMain").hidden = false; $("asDetail").hidden = true;
  renderAssetsControls(); renderAssetsList();
}
function resetAssets() { // leaving Settings: nothing is remembered (AC 12)
  asS.st = Assets.defaultState(); asS.detail = null; asS.task = null; asS.draft = null; asS.model = null; rdReset();
  $("asSearch").value = "";
  for (const id of ["asFilterDlg", "asSortDlg"]) if ($(id).open) $(id).close();
  showAssetsChrome(true);
}
function showAssetsChrome(on) { $("setHead").hidden = $("setTabs").hidden = !on; }

// ---------- one thing (the detail and its forms are drawn by assets-edit.js) ----------
function openAssetsDetail(id) {
  asS.detail = id; asS.task = null; rdReset(); renderAssets();
  const h = $("asDetail").querySelector("h1"); if (h) { h.tabIndex = -1; h.focus(); window.scrollTo(0, 0); }
}
function closeAssetsDetail() {
  const id = asS.detail; asS.detail = null; asS.task = null; rdReset(); renderAssets();
  [...$("asBody").querySelectorAll("[data-thing]")].find((b) => b.dataset.thing === id)?.focus();
}
// ---------- Filter sheet (AC 3) ----------
function openAssetsFilter() {
  const st = asS.st; asS.draft = { view: st.view, jars: [...st.jars], statuses: [...st.statuses] };
  const jars = $("asFJars"), sts = $("asFStatus");
  jars.replaceChildren(); sts.replaceChildren();
  for (const j of Assets.JAR_KEYS) { const b = el("button", "fchip"); b.type = "button"; b.dataset.k = j; jars.append(b); }
  for (const s of Assets.STATUSES) { const b = el("button", "fchip"); b.type = "button"; b.dataset.k = s; sts.append(b); }
  syncAssetsFilter();
  $("asFilterDlg").showModal();
}
function syncAssetsFilter() {
  const d = asS.draft, tasks = d.view === "tasks", c = Assets.counts(asS.model, d.view), word = tasks ? "Tasks" : "Things";
  for (const b of $("asFView").children) { const on = b.dataset.view === d.view; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
  $("asFViewHint").textContent = tasks ? "One row for each task, naming the thing it belongs to." : "One row for each thing, with its tasks inside.";
  for (const b of $("asFJars").children) { asChipLabel(b, asJarName(b.dataset.k), c.jars[b.dataset.k]); b.setAttribute("aria-pressed", String(d.jars.includes(b.dataset.k))); }
  for (const b of $("asFStatus").children) { asChipLabel(b, b.dataset.k, c.statuses[b.dataset.k]); b.setAttribute("aria-pressed", String(d.statuses.includes(b.dataset.k))); }
  const n = Assets.countFor(asS.model, { ...asS.st, ...d });
  $("asFApply").textContent = `Show ${n} ${n === 1 ? word.slice(0, -1) : word}`;
  const none = !d.jars.length && !d.statuses.length, clr = $("asFClear");
  if (none) clr.setAttribute("aria-disabled", "true"); else clr.removeAttribute("aria-disabled");
  $("asFClearWhy").textContent = none ? "Clear Filters is unavailable. Nothing is filtered." : "";
}
function applyAssetsFilter() {
  Assets.setState(asS.st, { view: asS.draft.view, jars: asS.draft.jars, statuses: asS.draft.statuses });
  $("asFilterDlg").close();
  renderAssetsControls(); renderAssetsList();
}

// ---------- Sort sheet (AC 6) ----------
function openAssetsSort() {
  const box = $("asSortOpts"); box.replaceChildren();
  for (const [k, name, why] of SORT_OPTS) {
    const b = el("button", "optrow"); b.type = "button"; b.setAttribute("role", "radio"); b.dataset.sort = k;
    const on = asS.st.sort === k; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1;
    const rd = el("span", "rd"); rd.setAttribute("aria-hidden", "true");
    b.append(rd, el("b", null, name), el("small", null, why)); box.append(b);
  }
  $("asSortDlg").showModal();
  box.querySelector('[aria-checked="true"]').focus();
}
function pickAssetsSort(k) {
  Assets.setState(asS.st, { sort: k });
  $("asSortDlg").close();
  renderAssetsControls(); renderAssetsList();
}

// ---------- wiring ----------
function setupAssets() {
  const retry = $("asRetry");
  retry.addEventListener("click", async () => { try { await reload(); } catch {} renderAssets(); (asS.model ? $("asFilterBtn") : retry).focus(); });
  $("asView").addEventListener("click", (ev) => { const b = ev.target.closest("[data-view]"); if (b) { Assets.setState(asS.st, { view: b.dataset.view }); renderAssetsControls(); renderAssetsList(); } });
  roving($("asView"), "[data-view]", (b) => { Assets.setState(asS.st, { view: b.dataset.view }); renderAssetsControls(); renderAssetsList(); });
  $("asSearch").addEventListener("input", () => { Assets.setState(asS.st, { search: $("asSearch").value }); renderAssetsList(); });
  $("asChips").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-jar]"); if (!b) return;
    Assets.setState(asS.st, { jars: b.dataset.jar === "all" ? [] : Assets.toggled(asS.st.jars, b.dataset.jar) });
    renderAssetsControls(); renderAssetsList();
  });
  $("asBody").addEventListener("click", (ev) => { const b = ev.target.closest("[data-thing]"); if (b) openAssetsDetail(b.dataset.thing); });
  $("asFilterBtn").addEventListener("click", openAssetsFilter);
  $("asSortBtn").addEventListener("click", openAssetsSort);
  // Filter sheet: edits a draft; Show applies it; Close, Escape and a tap outside throw it away.
  const fd = $("asFilterDlg"), sd = $("asSortDlg");
  $("asFView").addEventListener("click", (ev) => { const b = ev.target.closest("[data-view]"); if (b) { asS.draft.view = b.dataset.view; syncAssetsFilter(); } });
  roving($("asFView"), "[data-view]", (b) => { asS.draft.view = b.dataset.view; syncAssetsFilter(); });
  const chipClick = (key) => (ev) => { const b = ev.target.closest("[data-k]"); if (b) { asS.draft[key] = Assets.toggled(asS.draft[key], b.dataset.k); syncAssetsFilter(); } };
  $("asFJars").addEventListener("click", chipClick("jars")); $("asFStatus").addEventListener("click", chipClick("statuses"));
  $("asFClear").addEventListener("click", () => { if ($("asFClear").getAttribute("aria-disabled")) return; asS.draft.jars = []; asS.draft.statuses = []; syncAssetsFilter(); });
  $("asFApply").addEventListener("click", applyAssetsFilter);
  $("asFilterX").addEventListener("click", () => fd.close());
  $("asSortX").addEventListener("click", () => sd.close());
  for (const [d, opener] of [[fd, "asFilterBtn"], [sd, "asSortBtn"]]) {
    let downOut = false; // close only when the press AND the release are on the dim area: a drag out of the sheet keeps it (and the draft)
    d.addEventListener("pointerdown", (ev) => { downOut = ev.target === d; });
    d.addEventListener("click", (ev) => { if (ev.target === d && downOut) d.close(); downOut = false; });
    d.addEventListener("close", () => { if (!$("screen-settings").hidden && !asS.detail) $(opener).focus(); });
  }
  $("asSortOpts").addEventListener("click", (ev) => { const b = ev.target.closest("[data-sort]"); if (b) pickAssetsSort(b.dataset.sort); });
  // Arrow keys only move focus (and the radio mark with it, as a native radio does); Space or Enter picks, and a pick closes the sheet. Escape leaves the sort as it was.
  roving($("asSortOpts"), "[data-sort]", (b) => { for (const o of $("asSortOpts").children) { const on = o === b; o.setAttribute("aria-checked", String(on)); o.tabIndex = on ? 0 : -1; } });
}
