"use strict";
/* Pickle It: edit a maintenance log (#14) and the link from the "higher than a later reading" refusal (#13).
   Spec docs/specs/v0.1.1-log-edit-and-error-link.md, mockup docs/design/log-edit.html. The rules are pure code in data.js (logEditPlan, logEditSpec) and due.js
   (checkReading, newlyOutOfOrder), tested in tests/b9-check.mjs. This file draws the full-screen Edit page, runs Save and Undo, and holds a form's typed
   entries IN MEMORY ONLY while the person visits the record that blocked it (nothing is written to storage for that).
   Loaded after assets-readings.js; app.js (which defines $) loads last, so everything here runs after a click, never at load. */

// ---------- #13: the held form ----------
// held = { label, origin (hash), restore(), later, nav, gone, fillId, rowKey, thingId }: one at a time; a second visit overwrites it (AC 11).
let held = null;
const heldHash = () => location.hash || "#pantry";
const chevL = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "ic"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", "M15 6l-6 6 6 6"); s.append(p); return s; };
function heldRefresh() { // redraw what shows a held form: the Fill-Ups banner and row mark, the thing page's banner and row mark
  const b = $("heldBack"); b.replaceChildren(); b.hidden = !(held && held.fillId !== undefined);
  if (!b.hidden) b.append(heldBanner());
  renderList(); renderAssets();
}
function heldBanner() {
  const w = el("div", "heldback"), b = btn("banner", "", backToForm);
  b.append(chevL(), document.createTextNode(held.label)); w.append(b);
  if (held.gone) { const m = el("div", "alert rdmsg"); m.setAttribute("role", "status"); const p = el("p"); p.append(el("b", null, "That record was already removed.")); m.append(ico("info"), p); w.append(m); }
  return w;
}
function dropHeld() { if (held) { held = null; heldRefresh(); } }
window.addEventListener("hashchange", () => { if (!held) return; if (held.nav) held.nav = false; else dropHeld(); }); // another tab, the Menu or the Pantry: the held entries are dropped (AC 10)
// Go to a screen, then run fn once it has drawn. The held form survives our own hash change (nav).
function goTo(hash, fn) {
  if (held) held.nav = true;
  if (heldHash() === hash) { if (held) held.nav = false; fn(); return; }
  window.addEventListener("hashchange", () => setTimeout(fn, 0), { once: true });
  location.hash = hash;
}
// A link to a fill-up or reading row adds one history entry, so the phone's Back returns to the held form (like the log Edit page).
function holdBack() { if (held) { held.pushed = true; held.target = location.hash; history.pushState({ pickleHeld: 1 }, ""); } }
// A tab, the Menu or a typed hash also fires popstate; only Back (the hash is still the target page's) returns to the form. Either event order works: location.hash is already new in both.
window.addEventListener("popstate", () => { if (held && held.pushed && location.hash === held.target) { held.pushed = false; backToForm(); } });
function backToForm() { const h = held; if (!h) return; held = null; heldRefresh(); h.restore(h.origin); }
// The link under a refusal. later = Due.checkReading's `later` (id, store, kind, typed, date); none for the starting value. draft = { thingId, label, close(), restore(origin) }.
function refusalLink(node, later, meter, draft) {
  if (!later || !later.id) return;
  const text = `See that ${later.kind}`, b = btn("lnk", text, () => followRefusal(later, draft));
  b.setAttribute("aria-label", `${text}, ${numText(later.typed)} ${meter === "hours" ? "hours" : "miles"} on ${dayText(later.date, today())}`);
  node.append(b);
}
function followRefusal(later, draft) {
  held = { ...draft, later, origin: heldHash(), nav: false, gone: false };
  draft.close();
  if (later.store === "logs") {
    if (!S.logs.some((l) => l.id === later.id)) { held.fillId = null; goTo("#log", () => { holdBack(); held.gone = true; heldRefresh(); $("heldBack").querySelector("button")?.focus(); }); return; }
    openLogEdit(later.id, { held: true });
  } else if (later.store === "fillups" && later.kind === "fill-up") {
    held.fillId = later.id;
    goTo("#log", () => { holdBack(); selectVehicle(draft.thingId); renderLog(); held.gone = !S.fillups.some((f) => f.id === later.id); heldRefresh(); const r = [...document.querySelectorAll(`#list [data-id="${later.id}"] .del`)].find((x) => x.textContent === "Delete"); (r || $("heldBack").querySelector("button"))?.focus(); if (r) r.scrollIntoView({ block: "center", behavior: smooth() }); });
  } else { // a readings row, an odometer-only fill-up (a "reading" to the person) or a meter change: the thing's Readings section
    held.rowKey = (later.store === "fillups" ? "f:" : "r:") + later.id;
    pref.set("settingsTab", "assets");
    goTo("#settings", () => {
      holdBack();
      openAssetsDetail(draft.thingId);
      const th = thingById(draft.thingId), rows = th ? ReadingsList.buildRows(th, rdRecs(th.id), today()) : [], i = rows.findIndex((r) => r.key === held.rowKey);
      held.gone = i < 0; if (i >= rdS.limit) rdS.limit = i + 1; // the list opens with enough rows shown (AC 5)
      heldRefresh();
      (rdButtons().find((b) => b.dataset.key === held.rowKey) || document.querySelector("#asDetail .banner"))?.focus();
    });
  }
}
// Where a screen restores a form: back to the screen it was on, then reopen it with the held values (AC 7). fn runs once the screen has drawn.
function returnTo(origin, fn) { goTo(origin, fn); }

// The four forms: what each holds, and how it reopens (typed values restored, old error cleared, focus on the reading).
function doneDraft(snap) { // the Done sheet (pantry.js)
  return { thingId: snap.thingId, label: `Back to Done: ${snap.name}`, close: () => { dn.saved = true; $("dnDialog").close(); },
    restore: (origin) => returnTo(origin, () => {
      if (!lookupTask(snap.thingId, snap.taskId)) { showToast("That task is no longer there. Nothing was saved.", null, true); return; }
      openDone({ thingId: snap.thingId, taskId: snap.taskId }, snap.fk);
      $("dnDate").value = snap.date; if (!$("dnReadWrap").hidden) $("dnRead").value = snap.read; dn.touched = true;
      if (!$("dnReadWrap").hidden) { $("dnRead").focus(); $("dnRead").select(); }
    }) };
}
function readingDraft(snap) { // Add Reading and Log Hours (pantry.js)
  return { thingId: snap.thingId, label: "Back to Add Reading", close: () => { ar.saved = true; $("arDialog").close(); },
    restore: (origin) => returnTo(origin, () => {
      if (!thingById(snap.thingId)) { showToast("This thing was removed. Nothing was saved.", null, true); return; }
      if (snap.fk.startsWith("assets:")) openAssetsDetail(snap.thingId);
      openReading({ thingId: snap.thingId, meter: snap.meter, fk: snap.fk, menu: snap.menu });
      if (snap.menu && !$("arWhoWrap").hidden) { $("arWho").value = snap.thingId; arPickThing(snap.thingId); }
      $("arDate").value = snap.date; $("arRead").value = snap.read; $("arRead").focus(); $("arRead").select();
    }) };
}
// The old Fill-Up and Maintenance forms on the Log screen (app.js).
const FILL_IDS = ["eVehicle", "date", "station", "odometer", "ppg", "units", "rtotal"], MAINT_IDS = ["mVehicle", "mDate", "mOdo", "mShop", "mOther"];
function entryDraft(maint, thing) {
  const ids = maint ? MAINT_IDS : FILL_IDS, vals = Object.fromEntries(ids.map((i) => [i, $(i).value])), picked = [...$("mItemsList").querySelectorAll("input:checked")].map((i) => i.value);
  return { thingId: thing.id, label: maint ? "Back to Log Maintenance" : "Back to Enter Fill-Up", close: () => closeEntry(),
    restore: (origin) => returnTo(origin, () => {
      if (!thingById(vals[ids[0]])) return;
      openEntry(maint); for (const s of entrySels) s.value = vals[ids[0]]; fillMaintItems();
      for (const i of ids) $(i).value = vals[i];
      if (maint) { for (const cb of $("mItemsList").querySelectorAll("input")) cb.checked = picked.includes(cb.value); updateMaintSummary(); } else refreshDisplay();
      const rd = $(maint ? "mOdo" : "odometer"); rd.focus(); rd.select();
    }) };
}

// ---------- #14: the Edit page ----------
// le.init: the page's values when it opened (Cancel asks only when they differ). le.log: the stored log as it was then (its updatedAt is checked again at Save, AC 39).
const le = { open: false, id: "", thingId: "", log: null, init: "", busy: false, asking: false, unwind: false, after: null, opener: null, changeId: "", fromLink: null };
const leIds = ["leTask", "leName", "leDate", "leRead", "leShop", "leNotes"];
const leStatus = () => document.querySelector('input[name="leStatusRadio"]:checked')?.value || "done";
const leVals = () => JSON.stringify([$("leTask").value, $("leName").value, leStatus(), $("leDate").value, $("leRead").value, $("leShop").value, $("leNotes").value]);
const leDirty = () => leVals() !== le.init;
function leFocus(id) { (document.querySelector(`#svcList [data-log-id="${id}"]`) || $("svcH"))?.focus(); }

function openLogEdit(id, { opener = null, held: fromLink = false } = {}) {
  if (le.open || le.unwind) return; // unwind: the last page's history entry is still being dropped
  const log = S.logs.find((l) => l.id === id), thing = log && thingById(log.thingId);
  if (!thing) { showToast("This log was already removed. Nothing was saved.", null, true); return; }
  setMsg($("svcMsg"), "");
  Object.assign(le, { open: true, id, thingId: thing.id, log: structuredClone(log), busy: false, asking: false, unwind: false, after: null, opener: opener || document.activeElement, changeId: newId("r"), fromLink: fromLink ? held : null });
  leBuild(thing, log);
  history.pushState({ pickleLogEdit: 1 }, ""); // the phone's Back button then closes this page (and asks first when something changed)
  $("leDlg").showModal();
  const h = $("leIn").querySelector("h1"); h.focus();
}
const leLabeled = (cls, label, input, id) => { const w = el("div", "fld " + cls), l = el("label", null, label); l.htmlFor = id; w.append(l, input); return w; };
function leBuild(thing, log) {
  const root = $("leIn"), L = log, removed = L.taskId !== "other" && !thing.tasks.some((k) => k.id === L.taskId);
  root.replaceChildren();
  const head = el("div", "su-head"), back = btn("back", "", () => leRequestClose());
  back.append(chevL(), document.createTextNode(le.fromLink ? le.fromLink.label : "Back")); head.append(back); root.append(head);
  const title = el("div"), h1 = el("h1", null, L.taskId === "other" ? L.taskName || "Other repairs" : L.taskName); h1.tabIndex = -1; h1.id = "leTitle";
  title.append(h1, el("p", "sub", `${thing.name} · ${longDate(L.date)}`)); root.append(title);
  const msg = el("div", "status"); msg.id = "leStatus"; msg.setAttribute("role", "status"); root.append(msg);
  const form = el("form", "stack"); form.id = "leForm"; form.noValidate = true; form.style.gap = "16px";
  // Task
  const sel = el("select"); sel.id = "leTask";
  for (const k of thing.tasks) sel.add(new Option(k.name, k.id));
  if (removed) sel.add(new Option(`${L.taskName} (task removed)`, L.taskId));
  sel.add(new Option("Something else", "other")); sel.value = L.taskId;
  const task = leLabeled("", "Task", sel, "leTask"), thint = el("p", "hint"); thint.id = "leTaskHint"; task.append(thint);
  const name = el("input"); name.id = "leName"; name.type = "text"; name.maxLength = 120; name.autocomplete = "off"; name.value = L.taskId === "other" ? L.taskName : "";
  const nameWrap = leLabeled("", "Task name", name, "leName"); nameWrap.id = "leNameWrap";
  // Status
  const st = el("fieldset", "fld lestatus"), lg = el("legend", "lab", "Status"), seg = el("div", "seg");
  for (const [v, t] of [["done", "Done"], ["skipped", "Skipped"]]) { const l = el("label"), r = el("input"); r.type = "radio"; r.name = "leStatusRadio"; r.value = v; r.checked = L.status === v; l.append(r, el("span", null, t)); seg.append(l); }
  st.append(lg, seg);
  // Date, reading, shop, notes
  const date = el("input"); date.id = "leDate"; date.type = "date"; date.max = today(); date.value = L.date;
  const rd = el("input"); rd.id = "leRead"; rd.type = "number"; rd.min = "0"; const rdWrap = leLabeled("", "", rd, "leRead"); rdWrap.id = "leReadWrap";
  const shop = el("input"); shop.id = "leShop"; shop.type = "text"; shop.maxLength = 80; shop.autocomplete = "off"; shop.setAttribute("list", "leShops"); shop.value = L.shop || "";
  const dl = el("datalist"); dl.id = "leShops"; for (const s of S.shops.vehicles) dl.append(new Option(s));
  const notes = el("textarea"); notes.id = "leNotes"; notes.rows = 4; notes.maxLength = 2000; notes.placeholder = "Anything worth remembering"; notes.value = L.notes || "";
  const save = el("button", "save", "Save"); save.type = "submit"; save.id = "leSave";
  const cancel = btn("btn2", "Cancel", () => leRequestClose());
  form.append(task, nameWrap, st, leLabeled("", "Date", date, "leDate"), rdWrap, leLabeled("", "Shop (optional)", shop, "leShop"), dl, leLabeled("", "Notes (optional)", notes, "leNotes"), el("div", "stack"));
  form.lastChild.append(save, cancel); root.append(form);
  const sync = () => leSync(thing, log, removed);
  sel.addEventListener("change", sync); for (const r of seg.querySelectorAll("input")) r.addEventListener("change", sync);
  for (const i of [...form.querySelectorAll("input, select, textarea")]) { const clear = () => { leClearErrors(); }; i.addEventListener("input", clear); i.addEventListener("change", clear); }
  form.addEventListener("submit", (ev) => { ev.preventDefault(); leSave(false); });
  rd.value = L.odometer ?? L.hours ?? "";
  leSync(thing, log, removed);
  le.init = leVals();
}
// The task and status decide whether a reading is asked for, what it is called, and whether it is required.
function leSync(thing, log, removed) {
  const taskId = $("leTask").value, spec = logEditSpec(thing, log, taskId, leStatus()), rd = $("leRead"), hrs = spec.field === "hours";
  $("leNameWrap").hidden = taskId !== "other";
  $("leTaskHint").textContent = removed && taskId === log.taskId ? `This task was removed from ${thing.name}. Pick another to move the log, or leave it.` : "";
  $("leTaskHint").hidden = !$("leTaskHint").textContent;
  $("leReadWrap").hidden = !spec.field;
  $("leReadWrap").querySelector("label").textContent = (hrs ? "Hours" : "Odometer (miles)") + (spec.required ? "" : " (optional)");
  rd.step = hrs ? "0.1" : "1"; rd.inputMode = hrs ? "decimal" : "numeric"; rd.placeholder = spec.required ? "" : "Optional";
}
function leClearErrors() {
  setMsg($("leStatus"), ""); $("leStatus").removeAttribute("aria-hidden");
  for (const p of document.querySelectorAll("#leIn .ferr")) p.remove();
  for (const i of document.querySelectorAll("#leIn [aria-invalid]")) { i.removeAttribute("aria-invalid"); i.removeAttribute("aria-describedby"); }
}
function leFail(text, field) {
  leClearErrors();
  setMsg($("leStatus"), text, "err");
  const input = { date: $("leDate"), reading: $("leRead"), task: $("leName").offsetParent ? $("leName") : $("leTask") }[field];
  if (!input) return;
  const p = el("p", "ferr", text); p.id = "leErr"; input.parentNode.append(p);
  $("leStatus").setAttribute("aria-hidden", "true"); // read once: focus lands on the field, which reads this message as its description (QA M-3)
  input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", "leErr"); input.focus();
}
const leLock = (on) => { le.busy = on; const b = $("leSave"); if (on) { b.setAttribute("aria-disabled", "true"); b.textContent = "Saving…"; } else { b.removeAttribute("aria-disabled"); b.textContent = "Save"; } for (const i of $("leForm").querySelectorAll("input, textarea")) i.readOnly = on; };

async function leSave(confirmed) {
  if (le.busy || !le.open) return;
  const log = S.logs.find((l) => l.id === le.id), thing = thingById(le.thingId);
  if (!thing) return leFail("This thing was removed. Nothing was saved.");
  if (!log) { leClose(); showToast("This log was already removed. Nothing was saved.", null, true); return; } // AC 38: back to the list
  if (log.updatedAt !== le.log.updatedAt) return leFail("This log was changed somewhere else. Close this page and open it again. Nothing was saved.");
  const reading = $("leReadWrap").hidden ? null : numIn($("leRead").value), date = $("leDate").value;
  const res = logEditPlan(thing, log, { taskId: $("leTask").value, taskName: $("leName").value, status: leStatus(), date, reading, shop: $("leShop").value, notes: $("leNotes").value },
    { today: today(), now: nowISO(), data: readingData(thing.id), confirmLower: confirmed, changeId: le.changeId });
  if (res.none) { leClose(); return; } // AC 14: nothing changed, no write and no toast
  if (res.error) return leFail(res.error, res.field);
  if (res.lower) { // the same "Did you type that right?" as Add Reading; nothing is saved until Yes
    leLock(true); const yes = await askMeterChange(reading, res.lower, date); leLock(false);
    if (!yes) { $("leRead").focus(); $("leRead").select(); return; }
    return leSave(true);
  }
  leLock(true); leClearErrors();
  try { await commit({ put: res.put, ...(res.del ? { del: res.del } : {}) }); }
  catch (e) { leLock(false); leFail(saveErrorText(e)); return; } // the page stays open with the entries kept; the change row id is reused on retry
  const id = le.id, written = res.put.logs[0].updatedAt, link = le.fromLink;
  const undo = { put: res.undo.put, ...(res.undo.del ? { del: res.undo.del } : {}), guard: () => { const c = S.logs.find((l) => l.id === id); return c && c.updatedAt === written ? null : "This log changed since. Nothing was undone."; } };
  leClose(() => {
    lastFk = dismissFk = "le:" + id;
    showToast(res.toast + (res.hint && link ? " Check the Readings list on this thing's page if a meter change needs fixing." : ""), undo);
    if (res.hint && !link) setMsg($("svcMsg"), "Check the Readings list on this thing's page if a meter change needs fixing.", "warn");
  });
}
// Close the page and drop the history entry it pushed; `after` runs once that is done. From the link, the held form reopens afterwards (AC 7).
function leClose(after = null) {
  if (!le.open) return;
  const link = le.fromLink, id = le.id; le.open = false; le.fromLink = null;
  if ($("leDlg").open) $("leDlg").close();
  le.unwind = true;
  le.after = () => {
    if (after) after(); else if (!link) leFocus(id); // a saved edit's toast has the focus (Undo); Cancel and Discard go back to the row's Edit button (AC 36)
    if (link && held === link) backToForm();
  };
  history.back();
}
async function leRequestClose() {
  if (!le.open || le.busy || le.asking) return;
  if (leDirty()) {
    le.asking = true;
    const discard = await askDialog({ title: "Discard Your Changes?", body: "Your edits to this log haven't been saved.", ok: "Discard", cancel: "Keep Editing", danger: true, outsideCancels: true });
    le.asking = false;
    if (!discard) { (document.activeElement && document.activeElement !== document.body ? document.activeElement : $("leTitle"))?.focus?.(); return; }
  }
  leClose();
}
document.addEventListener("DOMContentLoaded", function logEditEvents() {
  const dlg = $("leDlg");
  dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); leRequestClose(); }); // Escape
  // A second Escape can close the dialog even after the first was cancelled: put it back (the entries are still in the page) and ask, as the Add flow does.
  dlg.addEventListener("close", () => { if (le.open) { dlg.showModal(); const q = $("cDialog"); if (q.open) { q.addEventListener("close", () => setTimeout(leRequestClose, 0), { once: true }); q.close("cancel"); } else leRequestClose(); } });
  window.addEventListener("popstate", () => { // the phone's Back button
    if (le.unwind) { le.unwind = false; const f = le.after; le.after = null; if (f) f(); return; }
    if (le.open) { history.pushState({ pickleLogEdit: 1 }, ""); leRequestClose(); }
  });
});
