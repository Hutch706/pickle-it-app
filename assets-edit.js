"use strict";
/* Pickle It: one thing in Settings > Assets, and editing it (S3; spec v1-scope 4.10 AC 14-18, 4.13, 4.14, 4.16; mockup settings-option-c.html C6-C9).
   Draws the thing's page (reading card, Rename, Inactive, tasks, Add Custom Task, Delete) and the task form. The form's rules are in tasks-form.js
   (tested in tests/s3-check.mjs); every record is built by makeTask / makeThing, so the jar rules are enforced in one place. Each change is one
   commit() (one transaction), which redraws the Pantry and Assets. Loaded after assets-screen.js, before app.js. */

const asE = { st: null, busy: false };
const asMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const asClean = TaskForm.clean;
const asFocusUpdate = (meter) => document.querySelector(`#asDetail [data-update="${meter}"]`)?.focus() || document.querySelector("#asDetail h1")?.focus();
const asFocusSel = (sel) => (document.querySelector("#asDetail " + sel) || document.querySelector("#asDetail h1"))?.focus();
const asSwitch = (label, on, state, act) => { // the same switch as the jar switches in App Settings
  const w = el("div", "toggle"), b = el("button"); b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on)); if (act) b.dataset.act = act;
  const ui = el("span", "sw-ui"); ui.setAttribute("aria-hidden", "true");
  b.append(el("span", "nm", label), el("span", "state", state), ui); w.append(b);
  return { w, b, set: (v, s) => { b.setAttribute("aria-checked", String(v)); b.querySelector(".state").textContent = s; } };
};

// ---------- the thing's page ----------
function renderAssetsDetail() {
  const box = $("asDetail"), th = thingById(asS.detail), m = asS.model.things.find((x) => x.id === asS.detail);
  if (!th || !m) { asS.detail = null; asS.task = null; renderAssets(); return; }
  showAssetsChrome(false);
  if (asS.task) {
    if (box.querySelector("form.tform")) return; // another tab saved something: keep what is typed
    renderTaskForm(box, th, m); return;
  }
  box.replaceChildren();
  const top = el("div", "row"), back = btn("back", "Assets", closeAssetsDetail); back.setAttribute("aria-label", "Back to Assets"); back.prepend(ico("chevr", "ic flip"));
  const rn = btn("btn2 small", "Rename", () => asRename(th.id)); rn.dataset.act = "rename";
  top.append(back, rn);
  const head = el("div"); head.append(el("h1", null, th.name), el("p", "sub", [asJarName(th.jar) + " jar", ...asMarks(m)].join(" · ")));
  box.append(top, head);
  // Inactive: saved the moment it is switched.
  const inc = el("section", "card"), sw = asSwitch("Inactive", !th.active, th.active ? "Off" : "On", "inactive");
  sw.b.addEventListener("click", () => asToggleInactive(th.id));
  inc.append(sw.w, el("p", "hint", "An inactive thing leaves the Pantry. Its tasks and history are kept."));
  box.append(inc);
  for (const [meter, title] of [["miles", "Odometer"], ["hours", "Hour meter"]]) {
    if (meter === "miles" ? th.jar !== "vehicles" : !Due.hasHourMeter(th)) continue;
    const r = asReading(th, meter), c = el("section", "card"), row = el("div", "reading"), txt = el("div");
    c.setAttribute("aria-label", title);
    txt.append(el("div", "k", title), el("div", "v", r ? `${numText(r.value)} ${meter === "miles" ? "mi" : "hr"}` : "No reading yet"), el("div", "k", r ? `Read ${dayText(r.date, today())}` : "Update to add one"));
    const up = btn("btn2 small", "Update", () => openReading({ thingId: th.id, meter, fk: "assets:" + meter })); up.dataset.update = meter; up.setAttribute("aria-label", `Update ${title.toLowerCase()}`);
    row.append(txt, up); c.append(row); box.append(c);
  }
  const sec = el("section", "stack-sm"), sh = el("div", "sechead"), hd = el("h2", null, `Tasks · ${m.tasks.length}`);
  hd.id = "asTasksH"; sec.setAttribute("aria-labelledby", "asTasksH");
  const add = btn("btn2 small", "Add Custom Task", () => asOpenTask("add")); add.dataset.act = "add"; add.prepend(ico("plus"));
  sh.append(hd, add); sec.append(sh);
  if (!m.tasks.length) sec.append(el("p", "hint", "No tasks yet."));
  else {
    const ul = el("ul", "list"); ul.setAttribute("role", "list");
    for (const r of m.tasks) {
      const v = asDue(r), li = el("li"), b = el("button", "trow" + (v.over ? " over" : "")); b.type = "button"; b.dataset.task = r.taskId;
      const due = el("span", "due" + (v.over ? " over" : "")), vis = el("span"); vis.setAttribute("aria-hidden", "true");
      if (v.over) { const bd = el("span", "badge err"); bd.append(ico("alert"), "Overdue"); vis.append(bd, el("small", null, v.parts.join(" "))); } else vis.append(v.parts.join(" "));
      due.append(vis, asVH(v.vh));
      const sc = el("span", "sc"); sc.append(r.rule);
      if (r.status === "Paused" && r.off) sc.append(" · Switched off");
      const chip = asSeason(r); if (chip) sc.append(" ", chip);
      b.append(el("span", "nm", r.task), due, sc, asVH(" Edit task."));
      b.addEventListener("click", () => asOpenTask("edit", r.taskId));
      li.append(b); ul.append(li);
    }
    sec.append(ul, el("p", "hint", "Tap a task to edit it."));
  }
  box.append(sec);
  const readings = renderReadings(th); if (readings) box.append(readings); // after Tasks (R1, assets-readings.js)
  if (th.jar === "vehicles") { // fill-ups, MPG, history and shops live on the Vehicles jar page (4.21 AC 8)
    const go = btn("btn2 small", "Open the Vehicles Jar", () => { location.hash = "#vehicles"; });
    box.append(el("p", "hint", "Fill-ups and shops are on the Vehicles Jar page."), go);
  }
  const del = btn("danger-link", "Delete Thing", () => asDeleteThing(th.id)); del.dataset.act = "delete";
  box.append(del);
}
// A meter's current value in the current meter's terms, and the date of that reading (same sources the due math uses).
function asReading(th, meter) {
  const { es, sc } = Due.meterEntries(meter, logsFor(th.id), Due.meterSources(th, fillupsFor(th.id), readingsFor(th.id), today()));
  const best = ReadingsList.latest(es);
  return best ? { value: best.v / sc, date: best.date } : null;
}
const asFail = (e) => showToast(saveErrorText(e), null, true);

async function asToggleInactive(id) {
  const th = thingById(id); if (!th) return showToast(GONE_THING, null, true);
  const r = makeThing({ ...th, active: !th.active, updatedAt: nowISO() });
  if (r.error) return showToast(cap(r.error) + ".", null, true);
  try { await commit({ put: { things: [r.rec] } }); } catch (e) { asFail(e); return; }
  asFocusSel('[data-act="inactive"]'); liveSay(r.rec.active ? `${th.name} is active.` : `${th.name} is inactive.`);
}
const GONE_THING = "This thing was removed. Nothing was saved.";

// ---------- Rename (4.16: unique per jar, trimmed, case-insensitive; one shared nameTaken) ----------
async function asRename(id) {
  const th = thingById(id); if (!th) return;
  const problem = (raw) => {
    const t = asClean(raw);
    return !t ? "Enter a name." : Array.from(t).length > 80 ? "Use 80 characters or fewer." : nameTaken(th.jar, t, th.id) ? `You already have a thing called that in ${asJarName(th.jar)}.` : "";
  };
  const name = await askDialog({ title: "Rename", body: `Now called ${th.name}. Names are different inside each jar.`, ok: "Save Name", input: { label: "Name", value: th.name, hint: th.jar === "health" || th.jar === "finance" ? TaskForm.NO_SENSITIVE : "" }, validate: problem });
  if (name == null || name === th.name) { asFocusSel('[data-act="rename"]'); return; }
  const cur = thingById(id); if (!cur) return showToast(GONE_THING, null, true);
  if (problem(name)) return showToast(problem(name), null, true); // taken by another tab while the dialog was open
  const r = makeThing({ ...cur, name, updatedAt: nowISO() });
  if (r.error) return showToast(cap(r.error) + ".", null, true);
  try { await commit({ put: { things: [r.rec] } }); } catch (e) { asFail(e); return; }
  asFocusSel('[data-act="rename"]'); showToast(`Renamed to ${name}.`);
}

// ---------- Delete thing: two confirmations, then its logs, readings and fill-ups go in the same transaction ----------
async function asDeleteThing(id) {
  const th = thingById(id); if (!th) return;
  const f = fillupsFor(id), l = logsFor(id), r = readingsFor(id);
  const parts = andList([th.tasks.length && plural(th.tasks.length, "task"), l.length && plural(l.length, "history entry", "history entries"), r.length && plural(r.length, "reading"), f.length && plural(f.length, "fill-up")]);
  const back = () => asFocusSel('[data-act="delete"]');
  if (!(await askDialog({ title: `Delete ${th.name}?`, body: `${parts ? `This also deletes its ${parts}. ` : ""}It can't be undone. If you might want them later, export a backup first.`, ok: "Continue", danger: true }))) return back();
  if (!(await askDialog({ title: "Are you sure?", body: `${th.name} will be gone for good.`, ok: "Delete Thing", danger: true }))) return back();
  try { await commit({ del: { things: [id], fillups: f.map((x) => x.id), logs: l.map((x) => x.id), readings: r.map((x) => x.id) } }); }
  catch (e) { asFail(e); return back(); }
  asS.detail = null; asS.task = null; renderAssets();
  ($("asFilterBtn").offsetParent ? $("asFilterBtn") : $("tabAssets")).focus(); showToast(`Deleted ${th.name}.`);
}

// ---------- the task form (edit, and Add Custom Task) ----------
function asOpenTask(mode, id) { asS.task = { mode, id, fresh: true }; renderAssets(); }
function asCloseTask(focusSel) { asS.task = null; asE.st = null; renderAssets(); asFocusSel(focusSel); }

function renderTaskForm(box, th, m) {
  const adding = asS.task.mode === "add", rec = adding ? null : th.tasks.find((k) => k.id === asS.task.id);
  if (!adding && !rec) { asS.task = null; showToast("This task was removed. Nothing was saved.", null, true); renderAssetsDetail(); return; }
  const row = rec && m.tasks.find((r) => r.taskId === rec.id);
  const st = adding ? TaskForm.blank(th.jar) : TaskForm.fromTask(rec, th.jar, { logs: logsFor(th.id).filter((x) => x.taskId === rec.id), dueDate: row && row.dueDate });
  asE.st = st; asE.busy = false;
  box.replaceChildren();
  const where = adding ? '[data-act="add"]' : `[data-task="${rec.id}"]`;
  const top = el("div", "row"), back = btn("back", th.name, () => asCloseTask(where)); back.prepend(ico("chevr", "ic flip")); top.append(back);
  const h1 = el("h1", null, adding ? "Add Custom Task" : rec.name); h1.id = "tfH";
  const head = el("div"); head.append(h1, el("p", "sub", th.name));
  const form = el("form", "tform"); form.noValidate = true; form.setAttribute("aria-labelledby", "tfH");
  const card = el("section", "card");
  const errBox = {}, inputs = {};
  // One labelled field: label, input, and its message (hidden until the field has an error; the input then points at it).
  const hintIds = {}; // a field's plain hint stays tied to it while an error comes and goes
  const describe = (key, bad) => { const ids = [hintIds[key], bad && errBox[key].id].filter(Boolean).join(" "); if (ids) inputs[key].setAttribute("aria-describedby", ids); else inputs[key].removeAttribute("aria-describedby"); };
  const field = (key, text, props = {}, hint = "") => {
    const w = el("div", "fld"), id = "tf-" + key, lab = el("label", null, text); lab.htmlFor = id;
    const i = el("input"); Object.assign(i, { id, type: "text", autocomplete: "off", value: st[key] ?? "" }, props);
    const e = el("p", "ferr"); e.id = id + "-e"; e.hidden = true;
    i.addEventListener("input", () => {
      st[key] = i.value; clearErr(key); if (key === "months" || key === "name") sync();
      if (key === "remindMiles" || key === "remindHours") st.rt[key === "remindMiles" ? "miles" : "hours"] = true; // typed: Remind is theirs now and never rewritten (4.20 AC 6)
      if (key.startsWith("every") || key.startsWith("remind")) remindSettle(key.startsWith("every"));
    });
    lab.append(i); w.append(lab, e); errBox[key] = e; inputs[key] = i;
    if (hint) { const h = el("p", "hint", hint); h.id = id + "-h"; hintIds[key] = h.id; w.append(h); describe(key, false); }
    return w;
  };
  const clearErr = (key) => { if (!errBox[key]) return; errBox[key].hidden = true; errBox[key].textContent = ""; inputs[key].removeAttribute("aria-invalid"); describe(key, false); setMsg($("tfStatus"), ""); };
  const showErr = (key, text) => { errBox[key].textContent = text; errBox[key].hidden = false; inputs[key].setAttribute("aria-invalid", "true"); describe(key, true); };

  // No length attribute: cleanText and validate() enforce 80 code points (director ruling 2026-11-07).
  const nameF = field("name", "Task name", { placeholder: adding ? "" : undefined }, TaskForm.NO_SENSITIVE);
  // Repeats by: a radio group of only the options that fit this thing's jar.
  const byBox = el("div", "stack-sm"), byLab = el("span", "optlabel", "Repeats by"); byLab.id = "tfByL";
  const by = el("div", "tabs many"); by.setAttribute("role", "radiogroup"); by.setAttribute("aria-labelledby", "tfByL");
  for (const o of TaskForm.options(th.jar)) { const b = el("button", "tab", o.label); b.type = "button"; b.setAttribute("role", "radio"); b.dataset.by = o.key; by.append(b); }
  const byHint = el("p", "hint", "Dates = same calendar date each time (e.g. each spring), no matter when you last did it."); byHint.id = "tfByH";
  byBox.append(byLab, by, byHint);
  const pick = (b) => { st.by = b.dataset.by; clearErr("everyMiles"); clearErr("everyHours"); clearErr("months"); clearErr("nextDate"); sync(); };
  by.addEventListener("click", (ev) => { const b = ev.target.closest("[data-by]"); if (b) pick(b); });
  roving(by, "[data-by]", pick);

  const mono = (key, text, extra, hint) => field(key, text, { inputMode: "numeric", pattern: "[0-9]*", ...extra }, hint);
  const dec = (key, text, extra, hint) => field(key, text, { inputMode: "decimal", pattern: "[0-9]*(\\.[0-9])?", ...extra }, hint);
  const ro = (key, text, why) => { const w = field(key, text, { readOnly: true, placeholder: "None yet" }); inputs[key].setAttribute("aria-describedby", why); return w; };
  const W = {
    everyMiles: mono("everyMiles", "Every (Miles)"), lastMiles: ro("lastMiles", "Last Completed (Miles)", "tfLastWhy"),
    remindMiles: mono("remindMiles", "Remind (Miles)", {}, "Moves this task up to Due This Month when this many miles are left."),
    everyHours: dec("everyHours", "Every (Hours)"), lastHours: ro("lastHours", "Last Completed (Hours)", "tfLastWhy"),
    remindHours: dec("remindHours", "Remind (Hours)", {}, "Moves this task up to Due This Month when this many hours are left."),
    months: mono("months", "Every (Months)"), lastDate: field("lastDate", "Last Completed (Date)", { type: "date", max: today() }),
  };
  inputs.lastMiles.value = st.lastMiles && numText(+st.lastMiles); inputs.lastHours.value = st.lastHours && numText(+st.lastHours);
  // Pairs, so each Every sits directly above its Last Completed in the tab order and the screen reader order, at any width.
  const colA = el("div", "pair"), colB = el("div", "pair");
  colA.append(W.everyMiles, W.lastMiles, W.remindMiles, W.everyHours, W.lastHours, W.remindHours); colB.append(W.months, W.lastDate); // Remind right after its Last Completed, before Every (Months) (4.20 AC 4)
  const grid = el("div", "pairs"); grid.append(colA, colB);
  const monthsHint = el("p", "hint", "Leave Every (Months) blank for no time limit. With both filled, the task is due whichever comes first."); monthsHint.id = "tfMonthsH";
  const lastWhy = el("p", "hint", "Last Completed comes from your history. Mark the task Done to change it."); lastWhy.id = "tfLastWhy";
  const nextF = field("nextDate", "Next Date", { type: "date" });

  // Only During Certain Months (4.14): From and To show only while the switch is on.
  const seasonBox = el("div", "stack-sm"), ss = asSwitch("Only During Certain Months", st.seasonOn, st.seasonOn ? "On" : "Off");
  const sel = (key, text) => {
    const l = el("label", null, text), s = el("select"); s.id = "tf-" + key; l.htmlFor = s.id;
    asMonths.forEach((n, i) => { const o = el("option", null, n); o.value = String(i + 1); s.append(o); });
    s.value = st[key]; s.addEventListener("change", () => { st[key] = s.value; sync(); }); l.append(s); return l;
  };
  const sFrom = sel("from", "Active Months (From)"), sTo = sel("to", "Active Months (To)");
  const sPair = el("div", "pairs"); sPair.append(sFrom, sTo);
  const chipRow = el("div", "row start"), chipLab = el("span", "optlabel", "Shows on the card as"), chipSlot = el("span");
  chipRow.append(chipLab, chipSlot);
  const sOn = el("div", "stack-sm"); sOn.append(sPair, chipRow, el("p", "hint", "The timer pauses outside these months and picks up where it left off. Turn the switch off, or choose January to December, to run all year."));
  const sOff = el("p", "hint", "Runs all year. Turn this on to choose a window, like April to October.");
  ss.b.addEventListener("click", () => { st.seasonOn = !st.seasonOn; sync(); });
  seasonBox.append(ss.w, sOn, sOff);

  card.append(nameF, byBox, grid, lastWhy, monthsHint, nextF, seasonBox);
  let actSw = null;
  if (!adding) {
    actSw = asSwitch("Active", st.active, st.active ? "On" : "Off");
    actSw.b.addEventListener("click", () => { st.active = !st.active; sync(); });
    card.append(actSw.w, el("p", "hint", "Switched off, the task leaves the Pantry. Its history is kept."));
    const v = row ? asDue(row) : null; if (v) card.append(el("p", "hint", `Currently: ${v.vh}`));
  }
  const status = el("div", "status"); status.id = "tfStatus"; status.setAttribute("role", "status");
  const save = el("button", "save", "Save Task"); save.type = "submit";
  const why = asVH("Save Task is unavailable. Name the task first."); why.id = "tfWhy";
  form.append(card, status, save, why);
  if (!adding) { const del = btn("danger-link", "Delete Task", () => asDeleteTask(th.id, rec.id)); del.dataset.act = "deltask"; form.append(del); }
  box.append(top, head, form);

  // Show what the chosen option needs; typed values in hidden fields stay in `st` and are dropped by validate().
  function sync() {
    const v = TaskForm.view(st);
    for (const b of by.children) { const on = b.dataset.by === st.by; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    byHint.hidden = st.by !== "dates";
    const show = (w, on) => { w.hidden = !on; };
    show(W.everyMiles, v.everyMiles); show(W.lastMiles, v.lastMiles && !adding); show(W.remindMiles, v.remindMiles); show(W.everyHours, v.everyHours); show(W.lastHours, v.lastHours && !adding); show(W.remindHours, v.remindHours);
    show(W.months, v.months); show(W.lastDate, v.lastDate);
    colA.hidden = !(v.everyMiles || v.everyHours); colB.hidden = !v.months; grid.hidden = colA.hidden && colB.hidden;
    W.months.querySelector("label").firstChild.textContent = v.monthsLabel;
    inputs.lastDate.readOnly = !v.lastDateEditable; if (!v.lastDateEditable) inputs.lastDate.setAttribute("aria-describedby", "tfLastWhy");
    lastWhy.hidden = adding || !(v.lastMiles || v.lastHours || (v.lastDate && !v.lastDateEditable));
    monthsHint.hidden = !(v.months && st.by !== "time");
    nextF.hidden = !v.nextDate;
    seasonBox.hidden = !v.season; sOn.hidden = !st.seasonOn; sOff.hidden = st.seasonOn;
    ss.set(st.seasonOn, st.seasonOn ? "On" : "Off"); if (actSw) actSw.set(st.active, st.active ? "On" : "Off");
    const chip = Assets.seasonChip({ time: { from: "done", activeFrom: +st.from, activeTo: +st.to } }, today());
    chipSlot.replaceChildren(); if (chip) chipSlot.append(asSeason({ season: chip })); else chipSlot.append("All year");
    const blocked = adding && !asClean(st.name);
    why.hidden = !blocked;
    if (blocked) { save.setAttribute("aria-disabled", "true"); save.setAttribute("aria-describedby", "tfWhy"); } else { save.removeAttribute("aria-disabled"); save.removeAttribute("aria-describedby"); }
  }
  sync();
  // Remind (4.20): follows Every until typed, with one polite announcement after the typing settles; an error that no longer applies clears as Every or Remind is fixed.
  let said = null;
  function remindSettle(everyTyped) {
    if (everyTyped) {
      for (const m of TaskForm.followRemind(st)) { const key = m === "miles" ? "remindMiles" : "remindHours"; inputs[key].value = st[key]; clearErr(key); }
      clearTimeout(said); said = setTimeout(() => { const v = TaskForm.view(st), m = v.remindMiles ? "miles" : "hours", n = v.remindMiles ? st.remindMiles : st.remindHours; if (n !== "" && !st.rt[m]) liveSay(`Remind changed to ${n}.`); }, 700);
    }
    const left = TaskForm.remindIssues(st);
    for (const key of ["remindMiles", "remindHours"]) if (!errBox[key].hidden && !left[key] && errBox[key].textContent === "Remind can't be more than Every.") clearErr(key);
  }
  // A stored Remind above Every shows its message as soon as the task opens, not only on Save (4.20 AC 13).
  // The status line (role=status) reads it once, politely, on arrival (QA R1 M4); the field's own message is tied by aria-describedby and has no role, so there is no double read.
  if (!adding) { const found = Object.entries(TaskForm.remindIssues(st)); for (const [key, msg] of found) showErr(key, msg); if (found.length) setMsg(status, found[0][1], "err"); }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (asE.busy || save.getAttribute("aria-disabled")) return;
    const cur = thingById(th.id); if (!cur) { setMsg(status, GONE_THING, "err"); return; }
    const old = adding ? null : cur.tasks.find((k) => k.id === rec.id);
    if (!adding && !old) { setMsg(status, "This task was removed. Nothing was saved.", "err"); return; }
    for (const k of Object.keys(errBox)) clearErr(k);
    const v = TaskForm.validate(st, cur.jar, { today: today(), adding, otherNames: cur.tasks.filter((k) => !old || k.id !== old.id).map((k) => k.name), dueDate: row && row.dueDate });
    const bad = Object.keys(v.errors);
    if (bad.length) {
      for (const k of bad) if (errBox[k]) showErr(k, v.errors[k]);
      const first = bad.find((k) => inputs[k]);
      setMsg(status, first ? "Fix the marked field and save again." : Object.values(v.errors)[0], "err"); if (first) inputs[first].focus();
      return;
    }
    const spec = v.spec;
    if (adding) { const ids = new Set(cur.tasks.map((k) => k.id)); do spec.id = newId("i"); while (ids.has(spec.id)); } // a fresh id, unique within this thing
    const t = makeTask(spec, cur.jar);
    if (t.error) { setMsg(status, cap(t.error) + ".", "err"); return; }
    const tasks = adding ? [...cur.tasks, t.rec] : cur.tasks.map((k) => (k.id === t.rec.id ? t.rec : k));
    const r = makeThing({ ...cur, tasks, updatedAt: nowISO() });
    if (r.error) { setMsg(status, cap(r.error) + ".", "err"); return; }
    asE.busy = true; save.setAttribute("aria-disabled", "true");
    try { await commit({ put: { things: [r.rec] } }); }
    catch (e) { asE.busy = false; sync(); setMsg(status, saveErrorText(e), "err"); save.focus(); return; } // the form stays open with everything typed
    asE.busy = false;
    asCloseTask(`[data-task="${t.rec.id}"]`); showToast(`Saved ${t.rec.name}.`);
  });
  if (asS.task.fresh) { asS.task.fresh = false; if (adding) inputs.name.focus(); else { h1.tabIndex = -1; h1.focus(); } window.scrollTo(0, 0); }
}

async function asDeleteTask(thingId, taskId) {
  const th = thingById(thingId), k = th && th.tasks.find((x) => x.id === taskId);
  if (!k) { asCloseTask('[data-act="add"]'); return showToast("This task was removed. Nothing was saved.", null, true); }
  if (!(await askDialog({ title: `Delete ${k.name}?`, body: "Its Done history stays with this thing under the task's name. This can't be undone.", ok: "Delete Task", danger: true }))) return asFocusSel('[data-act="deltask"]');
  const cur = thingById(thingId); if (!cur) return asCloseTask('[data-act="add"]');
  const r = makeThing({ ...cur, tasks: cur.tasks.filter((x) => x.id !== taskId), updatedAt: nowISO() });
  if (r.error) return showToast(cap(r.error) + ".", null, true);
  try { await commit({ put: { things: [r.rec] } }); } catch (e) { asFail(e); return; }
  asCloseTask('[data-act="add"]'); showToast(`Deleted ${k.name}. Its history is kept.`);
}
