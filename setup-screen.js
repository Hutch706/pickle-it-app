"use strict";
/* Pickle It: the Add flow screen (S4b-1; spec v1-scope 4.5 AC 11, 4.6, 4.7 AC 3 and 12, 4.13, 4.16; mockups onboarding.html O2-O4, finance-setup.html F1-F2).
   A full-screen modal dialog with a progress bar and a queue of pages. Vehicles, Health and Finance: pick the jar, the thing, its starter tasks, a final confirm.
   Home (S4b-2; 4.7 AC 8, 4.13 AC 4, 4.15; home-setup.html, home-setup-quantity.html): pick the jar, the house and the chips (with a quantity sheet), the house tasks,
   one page per appliance or engine copy, a final confirm. The rules (drafts, checks, the records to write) are in setup.js and setup-home.js (tested in
   tests/s4b1-check.mjs and tests/s4b2-check.mjs); this file only draws pages and moves focus. NOTHING is saved before the final confirm: the draft lives in
   memory, and one commit() writes every thing, its tasks and any starting logs together (data-model 7.5).
   Extension point: Setup.ADD_JARS lists the jars offered (S4b-3 starts this flow from first run). Loaded after assets-edit.js, before app.js, which calls setupAddFlow(). */

const su = { jar: null, d: null, h: null, v: null, ob: false, sess: null, done: false, step: 0, open: false, busy: false, asking: false, closing: false, unwind: false, opener: null, errs: { thing: {}, rows: {} }, herrs: {}, f: {} };
const suCtx = () => ({ today: today(), nameTaken, deps: { makeThing, makeLog, newId } });
const suJarLabel = (j) => Setup.JAR_LABEL[j];
const suJarIcon = { vehicles: "car", home: "home", health: "heart", finance: "dollar" };
// The jar picked: its draft (one thing), or for Home the whole queue model (setup-home.js). The pick itself is not a change.
function suChooseJar(jar) {
  su.jar = jar; su.errs = { thing: {}, rows: {} }; su.herrs = {};
  su.d = jar === "home" || jar === "vehicles" ? null : Setup.newDraft(jar, { existing: S.things });
  su.h = jar === "home" ? SetupHome.newHome({ existing: S.things }) : null;
  su.v = jar === "vehicles" ? Onboarding.newVehicles({ existing: S.things }) : null;
}
const suDirty = () => !su.done && (su.h ? SetupHome.isDirty(su.h) : su.v ? Onboarding.vehiclesDirty(su.v) : Setup.isDirty(su.d));
// The pages in order. Home: the jar pick, the house and chips, the house tasks, one page per copy, the confirm. Vehicles: the pick, the forms, one task page per vehicle, the confirm.
const suKeys = () => (su.h ? ["pick", "place", ...SetupHome.pages(su.h).map((p) => p.key), "confirm"] : su.v ? ["pick", "thing", ...Onboarding.taskPages(su.v), "confirm"] : ["pick", "thing", "tasks", "confirm"]);
// The hidden list as it will be once this add is saved (onboarding shows the jar being added), for the Review note.
const suHiddenAfter = (jar) => Onboarding.hiddenAfterAdd({ hidden: S.hiddenJars, hadThings: S.things.length > 0, onboarding: su.ob, added: [jar] });
const suSay = (text) => { const n = $("suLive"); n.textContent = ""; setTimeout(() => { n.textContent = text; }, 50); };

// ---------- open and close ----------
function openSetup({ jar = null, opener = null } = {}) {
  if (su.open) return;
  // The first thing ever (nothing saved yet) is first-run setup: it ends on "Your Pantry Is Stocked" and the jars not picked start hidden (4.7 AC 7).
  Object.assign(su, { open: true, busy: false, closing: false, done: false, ob: !S.things.length, sess: Onboarding.newSession(), after: null, step: jar ? 1 : 0, opener: opener || document.activeElement, f: {} });
  suChooseJar(jar || Setup.ADD_JARS[0].key);
  suToastHide(false); $("suLive").textContent = "";
  history.pushState({ pickleSetup: 1 }, ""); // the phone's Back button then asks instead of leaving
  $("setupDlg").showModal();
  suRender();
}
// True when it is fine to drop what was entered: nothing was entered, or the person confirmed.
async function suConfirmDiscard() {
  if (!suDirty()) return true;
  su.asking = true;
  const ok = await askDialog({ title: "Discard What You Entered?", body: "Nothing has been saved yet. If you close now, what you typed is lost.", ok: "Discard", cancel: "Keep Editing", danger: true });
  su.asking = false;
  return ok;
}
async function suRequestClose() {
  if (!su.open || su.busy || su.asking) return;
  if (!(await suConfirmDiscard())) return;
  suClose(null, { pantry: su.done });
}
function suClose(saved, { pantry = false } = {}) {
  su.closing = true; su.open = false;
  suToastHide(false); $("suLive").textContent = ""; if ($("qtyDlg").open) $("qtyDlg").close();
  if ($("setupDlg").open) $("setupDlg").close();
  su.unwind = true; history.back(); // drop the entry pushed on open
  const o = su.opener; su.d = null; su.h = null; su.v = null; su.opener = null; su.f = {};
  if (pantry) { // setup is done: land on the Pantry, which already shows the tasks (4.7 AC 5)
    su.after = () => { focusHeading = true; if (location.hash !== "#pantry") location.hash = "#pantry"; else route(); }; // run once the pushed history entry is dropped
    return;
  }
  const home = () => { const h = document.querySelector(".screen:not([hidden]) h1"); h.tabIndex = -1; h.focus(); }; // where focus goes when the opener is gone (a jar's empty card is replaced by the saved thing)
  if (saved) {
    const c = saved.counts, more = saved.things ? saved.things.length - 1 : 0;
    if (curScreen === "settings") openAssetsDetail(saved.thing.id); else if (o && o.isConnected && o.offsetParent) o.focus(); else home(); // an add from Assets opens the thing there; from a jar screen the person stays where they were, focus back on the Add button (4.21 AC 7)
    showToast(`Added ${more ? `${saved.thing.name} and ${plural(more, "other thing")}` : saved.thing.name}: ${plural(c.on, "task")} on${c.off ? `, ${c.off} paused` : ""}.`);
    return;
  }
  if (o && o.isConnected && o.offsetParent) o.focus(); else if ($("asAdd").offsetParent) $("asAdd").focus(); else home();
}

// ---------- small pieces ----------
// A whole-number box: a decimal point, letter, sign or "e" can't be typed; a pasted one is refused with a message when the page is checked (4.13 AC 2).
const suWhole = (i) => i.addEventListener("beforeinput", (ev) => { if (ev.inputType === "insertText" && /\D/.test(ev.data || "")) ev.preventDefault(); });
// A box for hours: digits and one decimal point; a longer decimal is refused with a message when the page is checked (4.13 AC 2).
const suDec = (i) => i.addEventListener("beforeinput", (ev) => { if (ev.inputType === "insertText" && /[^\d.]/.test(ev.data || "")) ev.preventDefault(); });
// One labelled field with its message (hidden until the field has an error; the input then points at it).
function suField(id, label, value, { hint = "", props = {}, whole = false, dec = false, onInput = null } = {}) {
  const w = el("div", "fld"), lab = el("label", null, label); lab.htmlFor = id;
  const i = el("input"); Object.assign(i, { id, type: "text", autocomplete: "off", value }, props);
  const e = el("p", "ferr"); e.id = id + "-e"; e.hidden = true; e.setAttribute("role", "alert");
  const h = hint ? el("p", "hint", hint) : null; if (h) h.id = id + "-h";
  const ids = (bad) => [h && h.id, bad && e.id].filter(Boolean).join(" ");
  if (ids(false)) i.setAttribute("aria-describedby", ids(false));
  const fld = { w, input: i, err: (text) => {
    e.textContent = text || ""; e.hidden = !text;
    if (text) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid");
    if (ids(!!text)) i.setAttribute("aria-describedby", ids(!!text)); else i.removeAttribute("aria-describedby");
  } };
  i.addEventListener("input", () => { if (!e.hidden) fld.err(""); onInput && onInput(i.value); });
  if (whole) suWhole(i); else if (dec) suDec(i);
  lab.append(i); w.append(lab, e); if (h) w.append(h);
  return fld;
}
const suButtons = (...b) => { const d = el("div", "stack-sm"); d.append(...b); return d; };
// A message with an icon, so it is not colour alone (home-setup.html H3b, H11).
const suNote = (node, text) => { setMsg(node, "", "err"); node.append(ico("alert"), text); };

// ---------- the page frame ----------
function suRender(focus = true) {
  const box = $("suIn"), keys = suKeys(), key = su.done ? "done" : keys[su.step], pct = su.done ? 100 : su.h || su.v ? SetupHome.stepPercent(su.step, keys.length) : Setup.stepPercent(su.step);
  box.replaceChildren();
  const head = el("div", "su-head");
  if (su.step > 0 && !su.done) { const b = btn("back", "Back", () => { su.step--; suRender(); }); b.prepend(ico("chevr", "ic flip")); head.append(b); } else head.append(el("span"));
  const x = btn("xclose", "", suRequestClose); x.setAttribute("aria-label", "Close"); x.append(ico("x")); head.append(x);
  const bar = el("div", "su-bar"); bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "Setup progress");
  bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100"); bar.setAttribute("aria-valuenow", String(pct)); bar.append(el("i")); bar.firstChild.style.setProperty("--p", pct + "%");
  const page = key === "done" ? suDonePage() : key === "pick" ? suPickPage() : key === "thing" ? (su.v ? suVehiclesPage() : suThingPage(su.d)) : key === "tasks" ? suTasksPage(su.d) : key === "place" ? suPlacePage()
    : key === "confirm" ? (su.h ? suHomeConfirm() : su.v ? suVehiclesConfirm() : suConfirmPage(su.d)) : su.v ? suVehicleTasks(key) : suHomeTaskPage(key);
  box.append(head, bar, page);
  const h = box.querySelector("h1"); h.id = "suTitle"; h.tabIndex = -1;
  if (focus) { $("setupDlg").scrollTop = 0; h.focus(); }
}
// The same page drawn again (a type changed): keeps the scroll place and puts focus back on a control.
function suRedraw(focusId) {
  const dlg = $("setupDlg"), y = dlg.scrollTop;
  suRender(false); dlg.scrollTop = y;
  const f = focusId && document.getElementById(focusId); if (f) f.focus();
}

// ---------- page 1: which jar ----------
function suPickPage() {
  const page = el("form", "stack"); page.noValidate = true;
  page.append(el("h1", null, "What Do You Want to Add?"), el("p", "sub", "Pick a jar. You can add more later."));
  const set = el("fieldset", "fset"); set.append(Object.assign(el("legend", "vh"), { textContent: "Jar" }));
  for (const j of Setup.ADD_JARS) {
    const l = el("label", "pick"), r = el("input"); Object.assign(r, { type: "radio", name: "suJar", value: j.key, checked: j.key === su.jar });
    r.addEventListener("change", async () => { // switching jars drops the picks, so ask first (QA S4b-2 m7)
      if (su.asking) return;
      if (!(await suConfirmDiscard())) { const was = set.querySelector(`input[value="${su.jar}"]`); if (was) was.checked = true; (was || r).focus(); return; }
      suChooseJar(j.key);
    });
    const t = el("span"); t.append(el("b", null, j.label), el("small", null, j.blurb));
    l.append(r, ico(suJarIcon[j.key], "ic big"), t); set.append(l);
  }
  const next = el("button", "save", "Next"); next.type = "submit";
  page.append(set, next);
  page.addEventListener("submit", (ev) => { ev.preventDefault(); su.step = 1; suRender(); });
  return page;
}

// ---------- page 2: the thing ----------
function suThingPage(d) {
  const jar = d.jar, page = el("form", "tform stack"); page.noValidate = true;
  const TITLE = { vehicles: "Add Your Vehicle", health: "Add a Person", finance: "Your Household" };
  const SUB = { health: "Reminders for one person: check-ups, shots and renewals. A first name, or Me, is enough.", finance: "Money deadlines live on a household or an account. Call it whatever you like. Dates only, never amounts." };
  const top = el("div"); top.append(el("p", "su-eyebrow", suJarLabel(jar).toUpperCase()), el("h1", null, TITLE[jar]));
  if (SUB[jar]) top.append(el("p", "sub", SUB[jar]));
  page.append(top);
  const card = el("section", "card");
  const hints = { vehicles: "Year, make and model works well. You can rename it later.", health: TaskForm.NO_SENSITIVE, finance: TaskForm.NO_SENSITIVE };
  const nameF = suField("suName", "Name", d.name, { hint: hints[jar], props: { placeholder: jar === "health" ? "e.g. Sam" : jar === "vehicles" ? "e.g. 2021 Subaru Ascent" : "" }, onInput: (v) => { d.name = v; } });
  card.append(nameF.w); su.f = { name: nameF };
  if (jar === "vehicles") {
    const o = suField("suOdo", "Odometer now", d.odometer, { hint: "Find it on the dashboard. You can fix it later.", whole: true, props: { inputMode: "numeric", pattern: "[0-9]*", placeholder: "Optional" }, onInput: (v) => { d.odometer = v; } });
    card.append(o.w); su.f.odometer = o;
  }
  page.append(card);
  if (Setup.ICON_CHOICES[jar]) page.append(suIconPicker(d.icon, (v) => { d.icon = v; }, jar));
  const status = el("div", "status"); status.setAttribute("role", "status");
  const next = el("button", "save", "Next: Pick Tasks"); next.type = "submit";
  page.append(status, next);
  const show = () => { const e = su.errs.thing; nameF.err(e.name); su.f.odometer && su.f.odometer.err(e.odometer); };
  show();
  page.addEventListener("submit", (ev) => {
    ev.preventDefault();
    su.errs.thing = Setup.checkThing(d, suCtx()); show();
    const bad = ["name", "odometer"].find((k) => su.errs.thing[k]);
    if (bad) { setMsg(status, "Fix the marked field and try again.", "err"); su.f[bad].input.focus(); return; }
    d.name = Setup.clean(d.name); su.step = 2; suRender();
  });
  return page;
}
// 4.6 AC 12: one group, one checked at all times, native radios.
function suIconPicker(current, onPick, jar, legend = "Pick an Icon") {
  const set = el("fieldset", "fset"); set.append(el("legend", null, legend));
  const grid = el("div", "tiles" + (Setup.ICON_CHOICES[jar].length === 3 ? " three" : ""));
  for (const [v, name] of Setup.ICON_CHOICES[jar]) {
    const l = el("label", "tile"), r = el("input"); Object.assign(r, { type: "radio", name: "suIcon", value: v, checked: current === v });
    r.addEventListener("change", () => onPick(v));
    const tk = el("span", "tk"); tk.setAttribute("aria-hidden", "true"); tk.append(ico("check"));
    l.append(r, ico(v, "ic big"), name, tk); grid.append(l);
  }
  set.append(grid);
  return set;
}

// After the confirm sent the person back to fix something: focus the first marked field.
function suFocusError() {
  const key = suKeys()[su.step];
  if (key === "place") { $("suHouse")?.focus(); return; }
  if (su.v && key === "thing") { // the Vehicles forms: the first form with a marked field
    const bad = su.v.forms.find((f) => Object.keys(su.herrs[Onboarding.pageKey(f)]?.thing || {}).length), x = bad && su.f.forms?.get(bad.key), e = bad && su.herrs[Onboarding.pageKey(bad)].thing;
    if (x) (e.name ? x.name : x.odometer).input.focus();
    return;
  }
  const home = !!su.h, e = home || su.v ? su.herrs[key] || { thing: {}, rows: {} } : su.errs, rk = Object.keys(e.rows)[0];
  const rowField = su.f.rows?.get(rk)?.[["name", "everyMiles", "everyHours", "months", "lastMiles", "lastHours", "remindMiles", "remindHours", "lastDate", "nextDate"].find((k) => e.rows[rk]?.[k])];
  const f = home ? (e.thing.name && su.f.name) || (e.thing.types && su.f.types && (su.f.types.find((s) => !s.value) || su.f.types[0])) || (e.thing.hours && su.f.hours) || rowField
    : su.step === 1 ? su.f[["name", "odometer"].find((k) => e.thing[k])] : rowField;
  if (f) (f.input || f).focus();
}

// ---------- page 3: starter tasks, each on the standard setup row ----------
const SU_COPY = {
  vehicles: "These are general defaults. Your owner's manual has the right tasks and Every amounts for your car. Edit any task later.",
  health: "These are reminders, not medical advice. Your own providers know what's right for you.",
  finance: "These are date reminders, not financial or tax advice. Dates shown are common US deadlines; check your own bills and policies for yours.",
};
// hm (Home only): { pg, title, sub, card, nextLabel, thing: () => check the page's own fields -> { field: message }, showThing(), typesGate } from suHomeTaskPage.
function suTasksPage(d, hm = null, vm = null) { // vm (Vehicles only): { E: this vehicle's messages, nextLabel }
  const ctx = suCtx(), page = el("form", "stack"); page.noValidate = true;
  const E = vm ? vm.E : hm ? (su.herrs[hm.pg.key] = su.herrs[hm.pg.key] || { thing: {}, rows: {} }) : su.errs;
  const head = el("div");
  if (hm) head.append(el("p", "su-eyebrow", "HOME"), hm.title, el("p", "sub", hm.sub)); else head.append(el("h1", null, `Tasks for ${d.name}`), el("p", "sub", SU_COPY[d.jar]));
  const count = el("p", "hint"); count.setAttribute("role", "status");
  const none = btn("btn2 small", "Select None", () => { for (const r of d.rows.filter((x) => !x.custom)) { r.checked = false; r.open = false; } suRefresh(); });
  const bar = el("div", "row"); bar.append(count, none);
  const list = el("ul", "sks"), mine = el("ul", "sks"), mineHead = el("div", "stack-sm");
  const mineH = el("h2", null, "Your Custom Tasks"); mineHead.append(mineH, el("p", "hint", `The ${d.rows.filter((r) => !r.custom).length} starter tasks are above. Your custom tasks start here.`));
  const lis = new Map(), fields = new Map();
  su.f = { rows: fields, ...(hm ? hm.f : {}) };
  const addBtn = el("button", "btn2", ""); addBtn.type = "button"; addBtn.append(ico("plus"), " Add Custom Task");
  const why = el("span", "vh", "Add Custom Task is unavailable. Name the new task first."); why.id = "suAddWhy";
  const status = el("div", "status"); status.setAttribute("role", "status");
  const next = el("button", "save", hm ? hm.nextLabel : vm ? vm.nextLabel : "Next: Review"); next.type = "submit";
  const flush = el("div", "card flush"), empty = el("p", "hint empty-hint", "There are no starter tasks for this yet. Add your own below.");
  page.append(head, ...(hm ? [hm.card] : []), bar, flush, empty, mineHead, mine, suButtons(addBtn, why, status, next));
  flush.append(list);
  if (hm) { // Next stays dimmed (aria-disabled, still focusable) until every type has an answer; the hidden text names the ones missing (4.13 AC 4)
    const gate = SetupHome.missingText(d);
    if (gate) { const g = el("span", "vh", gate); g.id = "suGate"; next.setAttribute("aria-disabled", "true"); next.setAttribute("aria-describedby", "suGate"); page.append(g); }
  }

  function suRefresh() { // after a tick change or a new row: counts, the Add button, and each row's open state
    const st = d.rows.filter((r) => !r.custom);
    count.textContent = `${st.filter((r) => r.checked).length} of ${st.length} picked`;
    bar.hidden = flush.hidden = !st.length;
    for (const r of d.rows) lis.get(r.key)?.sync();
    const customs = d.rows.filter((r) => r.custom), blocked = customs.length && !Setup.clean(customs[customs.length - 1].name);
    mineHead.hidden = mine.hidden = !customs.length;
    empty.hidden = !!(st.length || customs.length || (hm && SetupHome.typesMissing(d).length));
    if (blocked) { addBtn.setAttribute("aria-disabled", "true"); addBtn.setAttribute("aria-describedby", "suAddWhy"); } else { addBtn.removeAttribute("aria-disabled"); addBtn.removeAttribute("aria-describedby"); }
    why.hidden = !blocked;
  }
  function drawRow(r) {
    const li = el("li", "sk"), id = "su-" + r.key, f = {};
    fields.set(r.key, f);
    const top = el("div", "sr-top"), ck = el("label", "sr-ck"), cb = el("input"); Object.assign(cb, { type: "checkbox", checked: r.checked });
    const tx = el("span", "sr-tx"), nm = el("b", "nm"), meta = el("small", "meta"), pn = el("small", "meta pnote", Setup.PAUSED_NOTE); nm.id = id + "-nm"; meta.id = id + "-meta"; pn.id = id + "-pn"; pn.hidden = true;
    cb.setAttribute("aria-labelledby", nm.id); cb.setAttribute("aria-describedby", meta.id);
    tx.append(nm, meta, pn); ck.append(cb, tx);
    const edit = el("button", "sr-edit"); edit.type = "button"; edit.setAttribute("aria-controls", id + "-panel"); edit.append(ico("chevr"));
    top.append(ck, edit);
    const panel = el("div", "sr-panel"); panel.id = id + "-panel";
    const num = (key, label, extra, dec = false) => { const x = suField(`${id}-${key}`, label, r[key], { whole: !dec, dec, props: { inputMode: dec ? "decimal" : "numeric", pattern: dec ? "[0-9]*(\\.[0-9])?" : "[0-9]*" }, onInput: (v) => { r[key] = v; text(); }, ...extra }); f[key] = x; return x.w; };
    const nameF = suField(id + "-name", "Name", r.name, { props: { placeholder: r.custom ? "e.g. Wiper blades" : "" }, onInput: (v) => { r.name = v; text(); suRefresh(); } }); f.name = nameF;
    const dateF = (key, label) => { const x = suField(`${id}-${key}`, label, r[key], { props: { type: "date", ...(key === "lastDate" ? { max: ctx.today } : {}) }, onInput: (v) => { r[key] = v; if (v && key !== "nextDate" && r.notSure) { r.notSure = false; ns.sync(); } text(); } }); f[key] = x; return x.w; };
    const ns = el("button", "fchip", "Not Sure"); ns.type = "button";
    const nsHint = el("p", "hint", "Not Sure: the clock starts today."); nsHint.id = id + "-ns";
    ns.sync = () => { ns.setAttribute("aria-pressed", String(r.notSure)); nsHint.hidden = !r.notSure; if (r.notSure) ns.setAttribute("aria-describedby", nsHint.id); else ns.removeAttribute("aria-describedby"); };
    ns.addEventListener("click", () => {
      r.notSure = !r.notSure;
      if (r.notSure) for (const k of ["lastMiles", "lastHours", "lastDate", "nextDate"]) if (f[k]) { r[k] = ""; f[k].input.value = ""; f[k].err(""); }
      ns.sync(); text();
    });
    panel.append(nameF.w);
    if (r.kind === "date") panel.append(dateF("nextDate", "Next Date"));
    else {
      const pairs = el("div", "pairs"), a = el("div", "pair"), b = el("div", "pair");
      const clearNs = (key) => (v) => { r[key] = v; if (v && r.notSure) { r.notSure = false; ns.sync(); } text(); };
      // Remind (4.20): it follows Every until typed; one polite announcement after the typing settles (setup's own live region, the page behind the dialog is inert).
      let said = null;
      const everyIn = (key) => (v) => {
        r[key] = v;
        const moved = Setup.followRemind(r);
        for (const m of moved) { const k = m === "miles" ? "remindMiles" : "remindHours"; f[k].input.value = r[k]; f[k].err(""); }
        if (moved.length) { clearTimeout(said); said = setTimeout(() => suSay(`Remind changed to ${r[r.kind === "miles" ? "remindMiles" : "remindHours"]}.`), 700); }
        text();
      };
      const remindIn = (m, key) => (v) => { r[key] = v; r.rt[m] = true; clearTimeout(said); text(); };
      const hint = (u) => `Moves this task up to Due This Month when this many ${u} are left.`;
      if (r.kind === "miles") a.append(num("everyMiles", "Every (Miles)", { onInput: everyIn("everyMiles") }), num("lastMiles", "Last Completed (Miles)", { onInput: clearNs("lastMiles") }), num("remindMiles", "Remind (Miles)", { hint: hint("miles"), onInput: remindIn("miles", "remindMiles") }));
      if (r.kind === "hours") a.append(num("everyHours", "Every (Hours)", { onInput: everyIn("everyHours") }, true), num("lastHours", "Last Completed (Hours)", { onInput: clearNs("lastHours") }, true), num("remindHours", "Remind (Hours)", { hint: hint("hours"), onInput: remindIn("hours", "remindHours") }, true));
      b.append(num("months", Setup.everyLabel(r.unit)), dateF("lastDate", "Last Completed (Date)"));
      pairs.append(...(r.kind === "miles" || r.kind === "hours" ? [a, b] : [b])); panel.append(pairs);
    }
    panel.append(ns, nsHint); ns.sync();
    li.append(top, panel);
    function text() { nm.textContent = Setup.clean(r.name) || (r.custom ? "Custom task" : r.orig.name); meta.textContent = r.custom && !Setup.clean(r.name) ? "Not named yet" : Setup.rowMeta(r); edit.setAttribute("aria-label", `Edit ${nm.textContent}`);
      const paused = Setup.startsPaused(r); pn.hidden = !paused; cb.setAttribute("aria-describedby", paused ? meta.id + " " + pn.id : meta.id); } // a ticked task with no date that the library pauses: say so on the row (M1)
    li.sync = () => { // checked rows can be opened; unchecked rows close and hide the arrow
      cb.checked = r.checked; if (!r.checked) r.open = false;
      edit.hidden = !r.checked; edit.setAttribute("aria-expanded", String(r.open)); panel.hidden = !r.open; text();
    };
    cb.addEventListener("change", () => { r.checked = cb.checked; r.open = r.checked; suRefresh(); });
    edit.addEventListener("click", () => { r.open = !r.open; li.sync(); });
    lis.set(r.key, li); return li;
  }
  for (const r of d.rows) (r.custom ? mine : list).append(drawRow(r));
  suRefresh();
  addBtn.addEventListener("click", () => {
    if (addBtn.getAttribute("aria-disabled")) return;
    const r = Setup.addCustom(d); mine.append(drawRow(r)); suRefresh();
    const f = fields.get(r.key); f.name.input.focus(); f.name.input.scrollIntoView({ block: "center", behavior: smooth() });
  });
  const mark = () => { // show every row's messages; open the rows that have one
    for (const [k, f] of fields) for (const fk of Object.keys(f)) f[fk].err(E.rows[k]?.[fk] || "");
    for (const k of Object.keys(E.rows)) { const r = d.rows.find((x) => x.key === k); if (r) { r.open = true; lis.get(k).sync(); } }
  };
  page.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (hm) {
      if (SetupHome.typesMissing(d).length) { suNote(status, "Pick a type for each thing"); return; } // the dimmed Next: say why, don't move on
      E.thing = hm.check(); hm.show();
    }
    E.rows = Setup.checkRows(d, ctx); mark();
    const keys = d.rows.map((r) => r.key).filter((k) => E.rows[k]), thingBad = hm && Object.keys(E.thing).length;
    if (thingBad || keys.length) {
      setMsg(status, `Fix the marked ${keys.length + (thingBad ? 1 : 0) === 1 ? "field" : "fields"} and try again.`, "err");
      if (thingBad) { suFocusError(); return; }
      const first = keys[0], fk = ["name", "everyMiles", "everyHours", "months", "lastMiles", "lastHours", "remindMiles", "remindHours", "lastDate", "nextDate"].find((x) => E.rows[first][x]);
      const inp = fields.get(first)[fk].input; inp.focus(); inp.scrollIntoView({ block: "center", behavior: smooth() });
      return;
    }
    su.step++; suRender();
  });
  if (hm) hm.show();
  if (Object.keys(E.rows).length) mark();
  return page;
}

// ---------- page 4: confirm, then the one save ----------
// Review names the ticked tasks that will start paused because they have no date (M1).
const suPausedNote = (names) => el("p", "hint", `${Setup.PAUSED_NOTE}: ${names.join(", ")}.`);
function suConfirmPage(d) {
  const page = el("form", "stack"); page.noValidate = true;
  page.append(el("h1", null, "Review and Add"), el("p", "sub", "Nothing is saved until you tap the button below."));
  const p = Setup.plan(d, suCtx());
  if (p.errors) { // another tab added the same name, or a row is no longer valid: send the person to the page that needs fixing
    su.errs = p.errors; su.step = Object.keys(p.errors.thing).length || p.errors.general ? 1 : 2;
    if (p.errors.general) su.errs.thing.name = cap(p.errors.general) + ".";
    queueMicrotask(() => { suRender(); suFocusError(); });
    return page;
  }
  const card = el("section", "card"), dl = el("dl", "sum");
  const row = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
  row("Jar", suJarLabel(d.jar)); row("Name", p.thing.name);
  if (Setup.ICON_CHOICES[d.jar]) row("Icon", Setup.ICON_CHOICES[d.jar].find((x) => x[0] === p.thing.icon)?.[1] || "House");
  const c = p.counts;
  row("Tasks", `${plural(c.on, "task")} on${c.off ? `, ${c.off} paused` : ""}`);
  if (c.custom) row("Custom", plural(c.custom, "task"));
  if (c.logs) row("History", plural(c.logs, "entry", "entries") + " from Last Completed");
  card.append(dl); page.append(card);
  if (suHiddenAfter(d.jar).includes(d.jar)) page.append(el("p", "hint", `${suJarLabel(d.jar)} is hidden, so this won't show in the Pantry until you show that jar in Settings, under App Settings.`));
  if (c.pausedNames.length) page.append(suPausedNote(c.pausedNames));
  if (c.off) page.append(el("p", "hint", "Paused tasks are kept on the thing. Turn them on any time in Assets."));
  const status = el("div", "status"); status.setAttribute("role", "status");
  const go = el("button", "save", `Add ${p.thing.name}`); go.type = "submit";
  page.append(status, go);
  page.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (su.busy) return;
    const fresh = Setup.plan(d, suCtx()); // names re-checked now (another tab may have added one while this was open)
    if (fresh.errors) { su.step = Object.keys(fresh.errors.thing).length ? 1 : 2; su.errs = fresh.errors; suRender(); suFocusError(); return; }
    su.busy = true; go.setAttribute("aria-disabled", "true");
    const plan = { things: [fresh.thing], logs: fresh.logs, counts: fresh.counts, summary: [{ name: fresh.thing.name, on: fresh.counts.on, off: fresh.counts.off }] };
    try { await suSave(plan); }
    catch (e) { su.busy = false; go.removeAttribute("aria-disabled"); setMsg(status, saveErrorText(e) + " Nothing was saved.", "err"); go.focus(); return; }
    su.busy = false; suAfterSave(plan);
  });
  return page;
}

// ---------- the one save, and what follows it (S4b-3) ----------
// Every thing with its tasks, any starting logs and (the first thing ever) which jars start hidden go in ONE transaction (data-model 7.5). Nothing else is written.
async function suSave(plan) {
  const jars = [...new Set(plan.things.map((t) => t.jar))];
  const hidden = Onboarding.hiddenAfterAdd({ hidden: S.hiddenJars, hadThings: S.things.length > 0, onboarding: su.ob, added: jars });
  const changes = { put: { things: plan.things, logs: plan.logs } };
  if (Onboarding.hiddenChanged(S.hiddenJars, hidden)) changes.settings = { hiddenJars: hidden }; // an existing settings key; not exported
  await commit(changes);
}
// First-run setup ends on "Your Pantry Is Stocked"; any later add opens the thing in Assets.
function suAfterSave(plan) {
  if (!su.ob) { suClose({ thing: plan.things[0], things: plan.things, counts: plan.counts }); return; }
  Onboarding.addToSession(su.sess, plan.summary, plan.things.map((t) => t.jar));
  su.done = true; suRender(); suSay(Onboarding.stockedSay(su.sess));
}

// ---------- "Your Pantry Is Stocked" (O8, H12) ----------
function suDonePage() {
  const page = el("div", "stack"), top = el("div", "stocked-top"), sess = su.sess;
  top.append(ico("jar", "ic big"), el("h1", null, "Your Pantry Is Stocked"));
  const list = el("ul", "stocked");
  for (const r of sess.rows) { const li = el("li"); li.append(el("span", "nm", r.name), el("span", "ct", Onboarding.rowText(r))); list.append(li); }
  page.append(top, list);
  const note = Onboarding.hiddenNote(S.hiddenJars); if (note) page.append(el("p", "hint", note));
  if (sess.jars.includes("vehicles")) page.append(el("p", "hint", "Mileage dates are estimates from your driving. They get better as you log fill-ups."));
  const again = btn("btn2", "", () => { // back to the jar pick; everything saved so far stays saved and stays on this list
    su.done = false; su.step = 0; suChooseJar(Setup.ADD_JARS[0].key); suRender();
  });
  again.append(ico("plus"), "Add Another");
  const open = btn("save", "Open My Pantry", () => suClose(null, { pantry: true }));
  page.append(suButtons(again, open));
  return page;
}

// ---------- Vehicles: the forms, one task page each, the confirm (4.7 AC 11, 4.13 AC 7; O3, O3b, O3c) ----------
function suVehiclesPage() {
  const v = su.v, page = el("form", "tform stack"); page.noValidate = true;
  const top = el("div"); top.append(el("p", "su-eyebrow", "VEHICLES"), el("h1", null, "Add Your Vehicle")); page.append(top);
  const cards = el("div", "stack"), fields = new Map(); su.f = { forms: fields };
  const mine = (f) => (su.herrs[Onboarding.pageKey(f)] ||= { thing: {}, rows: {} });
  const drawCards = () => { // with more than one form each card is a labelled section with a heading, so its fields have a clear owner
    cards.replaceChildren(); fields.clear();
    v.forms.forEach((f, i) => {
      const id = "suV" + f.key, card = el("section", "card");
      if (v.forms.length > 1) { const h = el("h2", null, `Vehicle ${i + 1}`); h.id = id + "-h"; card.setAttribute("aria-labelledby", h.id); card.append(h); }
      const n = suField(id + "-name", "Name", f.d.name, { hint: "Year, make and model works well. You can rename it later.", props: { placeholder: "e.g. 2021 Subaru Ascent" }, onInput: (x) => { f.d.name = x; } });
      if (v.forms.length > 1) n.input.setAttribute("aria-label", `Vehicle ${i + 1} name`); // the heading names the card; this names the field for a screen reader's field list
      const o = suField(id + "-odo", "Odometer now", f.d.odometer, { hint: "Find it on the dashboard. You can fix it later.", whole: true, props: { inputMode: "numeric", pattern: "[0-9]*", placeholder: "Optional" }, onInput: (x) => { f.d.odometer = x; } });
      card.append(n.w, o.w); cards.append(card); fields.set(f.key, { name: n, odometer: o });
      n.err(mine(f).thing.name); o.err(mine(f).thing.odometer);
    });
  };
  drawCards();
  const status = el("div", "status"); status.setAttribute("role", "status");
  const more = el("button", "btn2"); more.type = "button"; more.append(ico("plus"), "Add Another Vehicle");
  const next = el("button", "save", "Next: Pick Tasks"); next.type = "submit";
  more.addEventListener("click", () => {
    const f = Onboarding.addForm(v); drawCards(); setMsg(status, "");
    const x = fields.get(f.key).name.input; x.focus(); x.scrollIntoView({ block: "center", behavior: smooth() });
    suSay(`Vehicle ${v.forms.length} added below.`);
  });
  page.append(cards, suButtons(more, status, next));
  page.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const errs = Onboarding.checkForms(v, suCtx());
    for (const f of v.forms) mine(f).thing = errs[f.key] || {};
    drawCards();
    const bad = v.forms.find((f) => errs[f.key]);
    if (bad) { setMsg(status, "Fix the marked field and try again.", "err"); const x = fields.get(bad.key); (errs[bad.key].name ? x.name : x.odometer).input.focus(); return; }
    v.forms = Onboarding.activeForms(v); // blank spare forms are dropped here
    for (const f of v.forms) f.d.name = Setup.clean(f.d.name);
    su.step = 2; suRender();
  });
  return page;
}
function suVehicleTasks(pk) {
  const v = su.v, f = Onboarding.formOf(v, pk), nextF = Onboarding.formOf(v, suKeys()[su.step + 1]);
  const E = (su.herrs[pk] ||= { thing: {}, rows: {} });
  return suTasksPage(f.d, null, { E, nextLabel: nextF ? `Next: ${Setup.clean(nextF.d.name)}` : "Next: Review" });
}
function suVehiclesConfirm() {
  const v = su.v, page = el("form", "stack"); page.noValidate = true;
  page.append(el("h1", null, "Review and Add"), el("p", "sub", "Nothing is saved until you tap the button below."));
  const goBack = (p) => { su.herrs = p.errors; su.step = Object.keys(p.errors[p.first].thing).length ? 1 : suKeys().indexOf(p.first); queueMicrotask(() => { suRender(); suFocusError(); }); };
  const p = Onboarding.planVehicles(v, suCtx());
  if (p.errors) { goBack(p); return page; } // another tab added the same name, or a page is no longer valid: back to the page that needs fixing
  const card = el("section", "card"), dl = el("dl", "sum"), row = (k, x) => { dl.append(el("dt", null, k), el("dd", null, x)); };
  const c = p.counts, odo = p.things[0].odometer;
  row("Jar", "Vehicles");
  if (c.things === 1) { row("Name", p.things[0].name); row("Odometer", odo != null ? `${numText(odo)} mi` : "Not set"); } else row("Vehicles", String(c.things));
  row("Tasks", `${plural(c.on, "task")} on${c.off ? `, ${c.off} paused` : ""}`);
  if (c.custom) row("Custom", plural(c.custom, "task"));
  if (c.logs) row("History", plural(c.logs, "entry", "entries") + " from Last Completed");
  card.append(dl); page.append(card);
  if (c.things > 1) {
    const ul = el("ul", "sum-list stack-sm");
    for (const s of p.summary) ul.append(el("li", null, `${s.name}: ${plural(s.on, "task")} on${s.off ? `, ${s.off} paused` : ""}`));
    page.append(el("h2", null, "What Will Be Added"), ul);
  }
  if (suHiddenAfter("vehicles").includes("vehicles")) page.append(el("p", "hint", "Vehicles is hidden, so this won't show in the Pantry until you show that jar in Settings, under App Settings."));
  if (c.pausedNames.length) page.append(suPausedNote(c.pausedNames));
  if (c.off) page.append(el("p", "hint", "Paused tasks are kept on the thing. Turn them on any time in Assets."));
  const status = el("div", "status"); status.setAttribute("role", "status");
  const go = el("button", "save", c.things === 1 ? `Add ${p.things[0].name}` : `Add ${c.things} Vehicles`); go.type = "submit";
  page.append(status, go);
  page.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (su.busy) return;
    const fresh = Onboarding.planVehicles(v, suCtx()); // names re-checked now (another tab may have added one while this was open)
    if (fresh.errors) { goBack(fresh); return; }
    su.busy = true; go.setAttribute("aria-disabled", "true");
    try { await suSave(fresh); }
    catch (e) { su.busy = false; go.removeAttribute("aria-disabled"); setMsg(status, saveErrorText(e) + " Nothing was saved.", "err"); go.focus(); return; }
    su.busy = false; suAfterSave(fresh);
  });
  return page;
}

// ======================================================================================================================================================
// Home setup (S4b-2)
// ======================================================================================================================================================

// ---------- the Undo toast (4.15 AC 9, 10): 8 seconds, paused while the pointer or the keyboard focus is on it ----------
let suToastTimer = null;
function suToastBox() {
  const box = $("suToast");
  if (box.dataset.wired) return box;
  box.dataset.wired = "1"; box.firstChild.id = "suToastMsg"; box.lastElementChild.setAttribute("aria-describedby", "suToastMsg");
  const arm = () => { clearTimeout(suToastTimer); suToastTimer = setTimeout(() => suToastHide(false), 8000); };
  const rearm = () => setTimeout(() => { if (!box.hidden && !box.matches(":hover") && !box.querySelector(":focus-visible")) arm(); }, 0);
  box.addEventListener("mouseenter", () => clearTimeout(suToastTimer));
  box.addEventListener("focusin", (e) => { if (e.target.matches(":focus-visible")) clearTimeout(suToastTimer); });
  box.addEventListener("mouseleave", rearm); box.addEventListener("focusout", rearm);
  box.arm = arm;
  box.lastElementChild.addEventListener("click", () => {
    if (!su.h) return;
    const key = suKeys()[su.step], kind = SetupHome.undo(su.h);
    if (kind) { // the queue may have grown before the page we are on: stay on the same page
      const at = suKeys().indexOf(key); if (at >= 0) su.step = at;
      if (key === "place") { suSyncChips(); suChipFocus(kind); } else suRedraw();
      suSay("Undone.");
    }
    suToastHide(true);
  });
  return box;
}
// Show the toast and put focus on Undo (the 8 seconds are too short to Tab to it; same as the Pantry's toast).
function suToastShow(msg) {
  const box = suToastBox(); box.firstChild.textContent = msg; box.hidden = false; box.arm();
  box.lastElementChild.focus();
}
// Hide it. kept = the held copies were used (Undo) so they stay used; otherwise the held copies are dropped for good (the window is over).
function suToastHide(kept) {
  const box = $("suToast"); clearTimeout(suToastTimer);
  const had = !box.hidden && box.contains(document.activeElement);
  box.hidden = true;
  if (!kept && su.h) SetupHome.dropHeld(su.h);
  if (had && su.open) { const k = su.f.lastKind; if (k && suChipFocus(k)) return; $("suTitle")?.focus(); }
}

// ---------- page 05: the house, the Icon and the chips ----------
const suChipEls = {}, suHints = {};
const suChipFocus = (kind) => { const b = suChipEls[kind]; if (b && b.isConnected) { b.focus(); return true; } return false; };
// One chip, drawn in place so the button keeps focus: plain (plus icon, aria-pressed) or picked (checkbox, count badge, opens the sheet).
function suSyncChip(kind) {
  const b = suChipEls[kind], p = su.h.picks[kind], K = SetupHome.KIND[kind];
  if (!b) return;
  b.replaceChildren();
  if (p) {
    b.classList.add("on"); b.removeAttribute("aria-pressed"); b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-label", `${K.label}, picked, ${p.count}. Change how many.`); // the state is in the name, so it is not announced as a toggle that opens a dialog (4.15 AC 3)
    const cbx = el("span", "cbx"); cbx.setAttribute("aria-hidden", "true"); cbx.append(ico("check"));
    const q = el("span", "qty", "×" + p.count); q.setAttribute("aria-hidden", "true");
    b.append(cbx, K.label, q);
  } else {
    b.classList.remove("on"); b.removeAttribute("aria-haspopup"); b.removeAttribute("aria-label"); b.setAttribute("aria-pressed", "false");
    b.append(ico("plus"), K.label);
  }
}
function suSyncChips() {
  const bar = document.querySelector("#suIn .su-bar"); // picks change the page count, so the bar's percent moves with them (QA S4b-2 m1)
  if (bar && su.h) { const pct = SetupHome.stepPercent(su.step, suKeys().length); bar.setAttribute("aria-valuenow", String(pct)); bar.firstChild.style.setProperty("--p", pct + "%"); }
  for (const k of SetupHome.KINDS) if (suChipEls[k.kind]) suSyncChip(k.kind);
  const n = SetupHome.total(su.h), hint = suHints.picked, tap = suHints.tap;
  if (hint) { hint.textContent = `${n} picked. Each one gets its own page next.`; tap.hidden = n < 1; }
}
function suPlacePage() {
  const h = su.h, page = el("form", "tform stack"); page.noValidate = true;
  const top = el("div"); top.append(el("p", "su-eyebrow", "HOME"), el("h1", null, "Name Your House")); page.append(top);
  const card = el("section", "card");
  const nameF = suField("suHouse", "Name", h.place.name, { props: { placeholder: "e.g. Home or Maple Street" }, onInput: (v) => { h.place.name = v; } });
  card.append(nameF.w); page.append(card);
  page.append(suIconPicker(h.place.icon, (v) => { h.place.icon = v; }, "home", "What Kind of Place?"));
  const hd = el("h2", null, "Any Large Appliances or Small Engines?"); hd.id = "suChipsH";
  const chips = el("div", "pchips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-labelledby", "suChipsH");
  for (const k of SetupHome.KINDS) {
    const b = el("button", "pchip"); b.type = "button"; b.dataset.kind = k.kind; suChipEls[k.kind] = b;
    b.addEventListener("click", () => {
      su.f.lastKind = k.kind;
      if (!h.picks[k.kind]) { SetupHome.pick(h, k.kind); if (!h.held) suToastHide(true); suSyncChips(); } else suOpenSheet(k.kind, b);
    });
    chips.append(b);
  }
  const hints = el("div", "hints"), picked = el("p", "hint"), tap = el("p", "hint", "Tap a picked chip to change how many.");
  picked.setAttribute("aria-live", "polite"); hints.append(picked, tap); Object.assign(suHints, { picked, tap });
  const status = el("div", "status"); status.setAttribute("role", "status");
  const next = el("button", "save", "Next: House Tasks"); next.type = "submit";
  page.append(hd, chips, hints, status, next);
  suSyncChips();
  const show = (e) => nameF.err(e);
  show(su.herrs.place?.thing.name);
  page.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const e = SetupHome.checkName(h, "house", suCtx()); show(e);
    if (e) { setMsg(status, "Fix the marked field and try again.", "err"); nameF.input.focus(); return; }
    h.place.name = Setup.clean(h.place.name); delete su.herrs.place; su.step = 2; suRender();
  });
  return page;
}

// ---------- the quantity sheet (4.15 AC 5-10; mockup Q2-Q6, Q10, Q11) ----------
// A working copy ({ count, typed }) is edited here; the pick is touched only when Done is tapped. Escape or the close button discards.
function suOpenSheet(kind, opener) {
  const h = su.h, K = SetupHome.KIND[kind], dlg = $("qtyDlg"), inn = $("qtyIn"), work = SetupHome.sheetOpen(h, kind), max = SetupHome.MAX_COPIES, tools = kind === "power-tools";
  let fields = [], res = null;
  inn.replaceChildren();
  const title = el("h3", null, K.label); title.id = "qtyTitle";
  const x = btn("xclose", "", () => dlg.close("")); x.setAttribute("aria-label", "Close without saving"); x.append(ico("x"));
  const head = el("div", "mdlg-head"); head.append(title, x);
  const lab = el("p", "optlabel", "How many?"); lab.id = "qtyL";
  const stp = el("div", "stepper"); stp.setAttribute("role", "group"); stp.setAttribute("aria-labelledby", "qtyL");
  const minus = btn("", "", () => bump(-1)), plus = btn("", "", () => bump(1)), out = el("output");
  minus.setAttribute("aria-label", `One fewer ${K.label}`); plus.setAttribute("aria-label", `One more ${K.label}`);
  minus.append(ico("minus")); plus.append(ico("plus")); out.setAttribute("aria-live", "polite");
  stp.append(minus, out, plus);
  const cap = el("p", "cap"), names = el("fieldset", "fset"), note = el("p", "hint note");
  const done = el("button", "save", "Done"); done.type = "button";
  const rm = btn("btn2 danger", "", () => { SetupHome.remove(h, kind); dlg.close("remove"); }); rm.append(ico("trash"), `Remove ${K.label}`);
  const sec = el("div"); sec.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:8px"; sec.append(lab, stp, cap);
  const foot = el("div"); foot.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:10px"; foot.append(done, rm, note);
  inn.append(head, sec, names, foot);

  function bump(by) {
    const n = Math.min(max, Math.max(1, work.count + by));
    if (n === work.count) return; // dimmed at the limits: aria-disabled, so the button still takes focus but does nothing
    work.count = n; draw();
  }
  function draw() {
    out.textContent = String(work.count);
    minus.setAttribute("aria-disabled", String(work.count <= 1)); plus.setAttribute("aria-disabled", String(work.count >= max));
    cap.textContent = work.count <= 1 ? "Have more than one? Tap + for each extra. To skip this one, use Remove." : work.count >= max ? `${max} is the most setup takes. Add more later in Assets.` : "Each one gets its own page next.";
    note.hidden = work.count <= 1; note.textContent = `Removes all ${work.count} from setup. You can undo it.`;
    names.replaceChildren(); fields = [];
    names.hidden = work.count < 2;
    if (work.count >= 2) {
      names.append(el("legend", null, "Names (optional)"));
      for (let i = 0; i < work.count; i++) {
        const f = suField(`qn${i}`, `${K.label} ${i + 1}`, work.typed[i] && Setup.clean(work.typed[i]) ? work.typed[i] : tools || work.typed[i] ? "" : SetupHome.sheetDefault(kind, i), { props: { placeholder: tools ? "Named after its Tool Type" : work.typed[i] ? SetupHome.sheetDefault(kind, i) : "" }, onInput: (v) => { work.typed[i] = v; } });
        fields.push(f); names.append(f.w);
      }
      names.append(el("p", "hint", `Give each one its own name, like Kitchen and Garage, to tell them apart. You can rename them later in Assets.`));
    }
  }
  done.addEventListener("click", () => {
    const e = SetupHome.checkSheet(h, kind, work, suCtx());
    for (const f of fields) f.err("");
    if (e) { if (fields[e.index]) { fields[e.index].err(e.message); fields[e.index].input.focus(); } else cap.textContent = e.message; return; }
    res = SetupHome.applySheet(h, kind, work);
    dlg.close("done");
  });
  dlg.addEventListener("close", () => {
    suSyncChips();
    if (!su.open) return;
    if (dlg.returnValue === "remove") suToastShow(`${K.label} removed.`);
    else if (dlg.returnValue === "done" && res && res.dropped.length) {
      const nm = res.dropped.length === 1 ? Setup.clean(res.dropped[0].typed) || SetupHome.sheetDefault(kind, work.count) : "";
      suToastShow(nm ? `${nm} dropped.` : `${res.dropped.length} copies of ${K.label} dropped.`);
    } else opener.focus();
  }, { once: true });
  draw();
  dlg.onkeydown = (ev) => { // a native modal lets Tab leave for the browser's own controls; keep it inside the sheet
    if (ev.key !== "Tab") return;
    const f = [...dlg.querySelectorAll("button, input, select")].filter((e) => !e.disabled && e.offsetParent), first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
  dlg.returnValue = ""; // Escape leaves the last value in place, so reset it: anything but Done and Remove discards
  dlg.showModal();
}

// ---------- the House Tasks page and one page per copy ----------
function suHomeTaskPage(key) {
  const h = su.h, pg = SetupHome.pages(h).find((p) => p.key === key), ctx = suCtx(), d = SetupHome.draftOf(h, pg), keys = suKeys();
  const titles = SetupHome.resolveNames(h, ctx), titleOf = (k) => (k === "house" ? "House Tasks" : titles[k].name);
  const nextKey = keys[su.step + 1], E = (su.herrs[key] = su.herrs[key] || { thing: {}, rows: {} });
  const hm = { pg, f: {}, nextLabel: nextKey === "confirm" ? "Next: Review" : `Next: ${titleOf(nextKey)}` };
  const h1 = el("h1", null, titleOf(key)); hm.title = h1;
  hm.sub = key === "house" ? `Checked tasks are added to ${Setup.clean(h.place.name) || "your house"}` : SetupHome.KIND[pg.kind].sub;
  const card = el("section", "card"); hm.card = card; card.hidden = key === "house";
  const copy = pg.kind ? h.picks[pg.kind].copies[pg.i] : null;
  const f = hm.f;
  if (copy) {
    const blankTyped = !!copy.typed && !Setup.clean(copy.typed); // spaces only: an empty field showing the default as its placeholder (QA S4b-2 m10)
    const nameF = suField("suName", "Name", blankTyped ? "" : copy.typed || titles[key].name, { props: blankTyped ? { placeholder: titles[key].name } : {}, hint: pg.kind === "power-tools" ? "Named after its Tool Type unless you type a name." : "", onInput: (v) => { copy.typed = v; h1.textContent = Setup.clean(v) || titles[key].name; } });
    f.name = nameF; card.append(nameF.w);
    f.types = [];
    SetupHome.KIND[pg.kind].dd.forEach((dd, i) => {
      const lb = el("label", null, dd.label), sel = el("select"); sel.id = "suType" + i;
      sel.append(new Option("Choose", ""));
      for (const o of dd.options) sel.append(new Option(o.label, o.value));
      sel.value = d.types[i] || "";
      sel.addEventListener("change", () => { SetupHome.setType(d, i, sel.value); suRedraw(sel.id); });
      lb.append(sel); card.append(lb); f.types.push(sel);
    });
    if (d.hourMeter) {
      const hf = suField("suHours", "Hour Meter Now (Optional)", d.hours, { hint: "No meter? Leave it blank; its tasks also come due by date.", dec: true, props: { inputMode: "decimal", pattern: "[0-9]*(\\.[0-9])?", placeholder: "Hours" }, onInput: (v) => { d.hours = v; } });
      f.hours = hf; card.append(hf.w);
    }
  }
  hm.show = () => { // the page's own messages
    f.name && f.name.err(E.thing.name); f.hours && f.hours.err(E.thing.hours);
    (f.types || []).forEach((s, i) => { if (E.thing.types && !s.value) s.setAttribute("aria-invalid", "true"); else s.removeAttribute("aria-invalid"); });
  };
  hm.check = () => { // names, hours: what Next checks besides the rows
    const e = {}, nm = key === "house" ? "" : SetupHome.checkName(h, key, ctx); if (nm) e.name = nm; // the house name is checked on page 05
    return Object.assign(e, Setup.checkThing(d, ctx));
  };
  return suTasksPage(d, hm);
}

// ---------- the Home confirm page ----------
function suHomeConfirm() {
  const h = su.h, page = el("form", "stack"); page.noValidate = true;
  page.append(el("h1", null, "Review and Add"), el("p", "sub", "Nothing is saved until you tap the button below."));
  const goBack = (p) => {
    su.herrs = p.errors; let k = p.first;
    const hn = p.errors.house && p.errors.house.thing.name; // the house name is typed on page 05, not on the House Tasks page
    if (hn) { su.herrs.place = { thing: { name: hn }, rows: {} }; delete p.errors.house.thing.name; k = "place"; }
    su.step = suKeys().indexOf(k); queueMicrotask(() => { suRender(); suFocusError(); });
  };
  const p = SetupHome.planHome(h, suCtx());
  if (p.errors) { goBack(p); return page; } // another tab added the same name, or a page is no longer valid: back to the page that needs fixing
  const card = el("section", "card"), dl = el("dl", "sum"), row = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
  const c = p.counts;
  row("Jar", "Home"); row("House", p.things[0].name);
  row("Icon", Setup.ICON_CHOICES.home.find((x) => x[0] === p.things[0].icon)?.[1] || "House");
  row("Things", plural(c.things, "thing"));
  row("Tasks", `${plural(c.on, "task")} on${c.off ? `, ${c.off} paused` : ""}`);
  if (c.custom) row("Custom", plural(c.custom, "task"));
  if (c.logs) row("History", plural(c.logs, "entry", "entries") + " from Last Completed");
  card.append(dl); page.append(card);
  const ul = el("ul", "sum-list stack-sm");
  for (const s of p.summary) ul.append(el("li", null, `${s.name}: ${plural(s.on, "task")} on${s.off ? `, ${s.off} paused` : ""}`));
  page.append(el("h2", null, "What Will Be Added"), ul);
  if (suHiddenAfter("home").includes("home")) page.append(el("p", "hint", "Home is hidden, so this won't show in the Pantry until you show that jar in Settings, under App Settings."));
  if (c.pausedNames.length) page.append(suPausedNote(c.pausedNames));
  if (c.off) page.append(el("p", "hint", "Paused tasks are kept on the thing. Turn them on any time in Assets."));
  const status = el("div", "status"); status.setAttribute("role", "status");
  const go = el("button", "save", c.things === 1 ? `Add ${p.things[0].name}` : `Add ${c.things} Things`); go.type = "submit";
  page.append(status, go);
  page.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (su.busy) return;
    const fresh = SetupHome.planHome(h, suCtx()); // names re-checked now (another tab may have added one while this was open)
    if (fresh.errors) { goBack(fresh); return; }
    su.busy = true; go.setAttribute("aria-disabled", "true");
    try { await suSave(fresh); }
    catch (e) { su.busy = false; go.removeAttribute("aria-disabled"); setMsg(status, saveErrorText(e) + " Nothing was saved.", "err"); go.focus(); return; }
    su.busy = false; suAfterSave(fresh);
  });
  return page;
}

// ---------- wiring ----------
function setupAddFlow() {
  const dlg = $("setupDlg");
  dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); suRequestClose(); }); // Escape asks first when something was typed
  // A second Escape can close a dialog even after the first was cancelled: put it back (the draft is still in memory) and ask.
  // Re-showing the flow puts it above a question that is already open (and takes focus), leaving the question hidden underneath: close that question
  // as "Keep Editing" and ask again, so the new question is on top with focus on Keep Editing (QA S4b-1 m2).
  dlg.addEventListener("close", () => { if (su.open && !su.closing) { dlg.showModal(); const q = $("cDialog"); if (q.open) { q.addEventListener("close", () => setTimeout(suRequestClose, 0), { once: true }); q.close("cancel"); } else suRequestClose(); } });
  window.addEventListener("popstate", () => { // the phone's Back button
    if (su.unwind) { su.unwind = false; const f = su.after; su.after = null; if (f) f(); return; }
    if (su.open) { if ($("qtyDlg").open) $("qtyDlg").close(""); history.pushState({ pickleSetup: 1 }, ""); suRequestClose(); }
  });
  $("asAdd").addEventListener("click", (ev) => openSetup({ opener: ev.currentTarget }));
}
