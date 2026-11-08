"use strict";
/* Pickle It: the Pantry screen (docs/design/pantry.html, spec v1-scope 4.1, 4.2, 4.18).
   Boxes, rows, the jar bar and the Menu show REAL tasks from IndexedDB (Due.pantryTasks in due.js, recalculated on every render, nothing derived is stored).
   Done, Skip and Undo save a log (B8); Add Reading, Log Hours and the meter-change prompt save readings (B9).
   Loaded after data.js and due.js and before app.js, which calls renderPantry() and uses $, el, pref. */

const JARS = [["vehicles", "Vehicles"], ["home", "Home"], ["health", "Health"], ["finance", "Finance"]];
const BOX_DEFS = [
  ["overdue", "Overdue", true],
  ["due-this-week", "Due This Week", true],
  ["due-this-month", "Due This Month", false], // owner 2026-11-05: Month and Later start collapsed on a fresh device
  ["due-later", "Due Later", false],
];
const BOX_CAP = 50;
const CANNING_LINES = [
  "Everything's sealed tight. Nothing to pickle this week.", "All jars sealed and on the shelf.",
  "Lids on, labels straight. Nothing due this week.", "The pantry's in order. Put your feet up.",
  "Nothing's bubbling this week.", "Quiet shelves this week. Everything's keeping nicely.",
  "No jars need opening this week.", "Not a dill thing to do this week.",
];
let focusHeading = false; // set by Menu rows that open a screen; app.js route() then moves focus to that screen's heading
let pendingFill = false; // set by the Menu's Enter Fill-Up; app.js route() opens the fill-up form

// ---------- SAMPLE DATA: local testing only ----------
// Used only on localhost / 127.0.0.1 / [::1] with ?sample=... in the URL; never in production (privacy review M5).
// date tasks: days from today. meter tasks: left (units), estDays (days to the estimated date or null), remind, hasReading.
const dt = (name, thing, jar, icon, o) => ({ name, thing, jar, icon, kind: "date", ...o });
function sampleTasks(mode) {
  if (mode === "none") return [];
  const m = (name, thing, jar, icon, unit, left, estDays, remind, hasReading = true) => dt(name, thing, jar, icon, { kind: "meter", unit, left, estDays, remind, hasReading });
  const week = [
    dt("Refill reminder", "Me", "health", "heart", { days: 0 }), dt("Store mower for winter", "Push mower", "home", "engine", { days: 1 }),
    dt("Flu shot", "Sam", "health", "heart", { days: 2 }), m("Generator oil change", "Generator", "home", "engine", "hr", 2, 4, 5),
  ];
  const month = [
    dt("Check tire pressure and tread", "2019 Civic", "vehicles", "car", { days: 9 }), dt("Clean gutters: fall", "Main house", "home", "home", { days: 12 }),
    m("Rotate tires", "Tacoma", "vehicles", "car", "mi", 400, 14, 1000), dt("Review monthly subscriptions", "Household", "finance", "dollar", { days: 20 }),
  ];
  const later = [
    dt("Replace furnace filter", "Main house", "home", "home", { days: 45 }), m("Air filter", "Tacoma", "vehicles", "car", "mi", 4000, null, 1000),
    m("Mower oil", "Push mower", "home", "engine", "hr", 0, null, 3, false), dt("Annual physical", "Me", "health", "heart", { days: 120 }),
    dt("Renew registration", "2019 Civic", "vehicles", "car", { days: 200 }), dt("Pay property tax", "Household", "finance", "dollar", { days: 300 }),
  ];
  const over = [dt("Test smoke and CO alarms", "Main house", "home", "home", { days: -6 }), m("Oil change", "Tacoma", "vehicles", "car", "mi", -120, null, 1000)];
  if (mode === "quiet") return [...month, ...later];
  if (mode === "many") {
    const lots = Array.from({ length: 55 }, (_, i) => dt("Filter check " + (i + 1), "Unit " + (1 + (i % 9)), JARS[i % 4][0], ["car", "home", "heart", "dollar"][i % 4], { days: i % 8 }));
    return [...over, ...lots, ...month, ...later];
  }
  return [...over, ...week, ...month, ...later];
}
const sampleMode = () => (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? new URLSearchParams(location.search).get("sample") : null);
// A sample entry in the same row shape Due.pantryTasks returns.
function sampleRow(k, i) {
  const date = k.kind === "date", est = !date && k.estDays != null ? Due.addUnits(today(), k.estDays, "day") : null, hasReading = date || k.hasReading;
  const text = date ? null : Due.rowText({ meter: k.unit === "mi" ? "miles" : "hours", left: hasReading ? k.left : null, rawEstimate: est, estimatedDate: est, dueDate: est }, today());
  return { id: "s" + i, task: k.name, thing: k.thing, jar: k.jar, kind: "", icon: k.icon, box: Due.boxOf({ days: date ? k.days : k.estDays ?? null, left: !date && hasReading ? k.left : null, remind: k.remind || 0 }),
    over: date ? k.days < 0 : hasReading && k.left < 0, days: date ? k.days : null, left: date ? null : hasReading ? k.left : null, unit: k.unit || "", estDays: date ? null : k.estDays ?? null, meter: !date, text, noDate: false };
}

// ---------- Due text (spec 4.2a) ----------
const addDays = (n) => { const [y, m, d] = today().split("-").map(Number); return new Date(y, m - 1, d + n); };
// The year shows when the date is more than 6 months away, ahead or back (spec 4.2a AC 5), on screen and when spoken.
const needYear = (n) => { const iso = isoDate(addDays(n)); return iso > Due.addUnits(today(), 6, "month") || iso < Due.addUnits(today(), -6, "month"); };
const fmtDay = (n) => addDays(n).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(needYear(n) ? { year: "numeric" } : {}) });
const longDay = (n) => addDays(n).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(needYear(n) ? { year: "numeric" } : {}) });
const amt = (x, unit) => (unit === "mi" ? Math.round(x).toLocaleString() : String(Math.round(x * 10) / 10)) + " " + unit;
const words = (x, unit) => amt(x, unit).replace(/ mi$/, x === 1 ? " mile" : " miles").replace(/ hr$/, x === 1 ? " hour" : " hours");

function dueView(k) {
  if (k.noDate) return k.stuck ? { ask: true, parts: ["Add a date"], vh: "No date yet. Add a date." } : { ask: true, parts: ["Add a last-done date"], vh: "No last-done date yet. Add a last-done date." }; // stuck = a calendar task with no date
  if (k.text == null) {
    const n = k.days;
    if (n < 0) return { over: true, parts: ["since " + fmtDay(n)], vh: "Overdue since " + longDay(n) };
    if (n === 0) return { parts: ["Today"], vh: "Due today" };
    if (n === 1) return { parts: ["Tomorrow"], vh: "Due tomorrow" };
    if (n < 7) return { parts: ["in " + n + " days"], vh: `Due in ${n} days, ${longDay(n)}` };
    return { parts: [fmtDay(n)], vh: "Due " + longDay(n) };
  }
  // Meter task: the visible text is Due.rowText (data-model 3.3a); only the spoken sentence is built here.
  const { unit, left, estDays, text } = k, i = text.indexOf(" / "), parts = i < 0 ? [text] : [text.slice(0, i + 2), text.slice(i + 3)];
  const out = (vh, o = {}) => ({ parts, vh: (k.over && !o.over ? "Overdue, " : "") + vh, over: k.over, ...o });
  if (left == null) return { ask: true, parts, vh: `No ${unit === "mi" ? "odometer" : "hour"} reading yet. Add a reading.`, over: k.over };
  if (left < 0) return out("Overdue, " + words(-left, unit) + " over", { over: true });
  if (text === "Due now") return out("Due now. When you add a reading, the date will update.");
  if (estDays != null) return out(`${words(left, unit)} left, estimated ${longDay(estDays)}`);
  return out(words(left, unit) + " left. No date estimated yet.");
}

// ---------- Small DOM helpers ----------
const SVGNS_P = "http://www.w3.org/2000/svg";
function ico(id, cls = "ic") {
  const s = document.createElementNS(SVGNS_P, "svg"); s.setAttribute("class", cls); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(SVGNS_P, "use"); u.setAttribute("href", "#i-" + id); s.append(u); return s;
}
const vh = (text) => el("span", "vh", text);
// ---------- Toast with Undo (spec 4.2 AC 11; data-layer-plan B8.4) ----------
// One toast at a time, latest wins. It holds only what the last save wrote, as { logs, fillups, readings } id lists (B9.6). The 8 seconds pause while the pointer or focus is on it and restart when both leave.
let toastTimer = null, undoSet = null, lastFk = null, dismissFk = null;
function liveSay(text) { // a quiet announcement for things the hidden toast can't say
  let n = document.getElementById("pLive");
  if (!n) { n = vh(""); n.id = "pLive"; n.setAttribute("role", "status"); document.body.append(n); }
  n.textContent = ""; setTimeout(() => { n.textContent = text; }, 50);
}
// Where focus goes when the toast closes: back to the row (Undo) or to where the row went (Dismiss, timeout). "menu" = the Menu button.
const goBack = (k) => (k === "menu" ? $("menuBtn").focus() : String(k).startsWith("assets:") ? asFocusUpdate(k.slice(7)) : String(k).startsWith("rd:") ? rdFocus(k.slice(3)) : focusPantryRow(k)); // "assets:<meter>" = the Update button on a thing in Settings > Assets (S3); "rd:<row key>" = that Readings row's Delete button (R1)
function toastBox() {
  let box = document.getElementById("ptoast");
  if (box) return box;
  box = el("div", "ptoast"); box.id = "ptoast"; box.setAttribute("role", "status");
  const hide = (undone) => { clearTimeout(toastTimer); const had = box.contains(document.activeElement) || document.activeElement === document.body; box.hidden = true; undoSet = null; if (had) goBack(undone ? lastFk : dismissFk ?? lastFk); };
  const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(() => hide(false), 8000); };
  const rearm = () => setTimeout(() => { if (!box.hidden && !box.dataset.sticky && !box.matches(":hover") && !box.querySelector(":focus-visible")) arm(); }, 0);
  const undo = btn("", "Undo", async () => {
    const set = undoSet; if (!set || undo.getAttribute("aria-disabled")) return;
    clearTimeout(toastTimer); // aria-disabled, not disabled: a disabled button would drop keyboard focus
    // A delete's Undo is a ready-made { put } of exact clones (R1); it writes nothing if the thing is gone, so no orphan record is made.
    if (set.put && !ReadingsList.canUndo(set, S.things)) { box.firstChild.textContent = "Couldn't undo: this thing was removed."; box.dataset.sticky = "1"; return; }
    undo.setAttribute("aria-disabled", "true");
    try { await commit(set.put ? { put: set.put } : { del: set }); } // a save's Undo deletes by id: touches nothing else; an id already gone is a quiet no-op
    catch (e) { box.firstChild.textContent = saveErrorText(e).replace(/^Couldn't save/, "Couldn't undo"); box.dataset.sticky = "1"; undo.removeAttribute("aria-disabled"); return; }
    if (undoSet === set) { hide(true); liveSay("Undone."); }
  });
  box.append(el("p", null, ""), undo, btn("", "Dismiss", () => hide(false)));
  // Hover pauses; so does keyboard focus. A tap that moved focus here by script does not (the toast would never leave for a touch user).
  box.addEventListener("mouseenter", () => clearTimeout(toastTimer)); box.addEventListener("focusin", (e) => { if (e.target.matches(":focus-visible")) clearTimeout(toastTimer); });
  box.addEventListener("mouseleave", rearm); box.addEventListener("focusout", rearm);
  // Pad the page by the toast's height while it shows, so the lowest row can be scrolled clear of it.
  new ResizeObserver(() => document.body.style.setProperty("--toast-h", box.hidden ? "0px" : box.offsetHeight + "px")).observe(box);
  box.arm = arm; document.body.prepend(box); // first in the page, so first in tab order
  return box;
}
// undo: { logs?, fillups?, readings? } id lists that Undo deletes together, or { put: { store: [records] } } that Undo writes back (a delete, R1). sticky: no auto-hide (an error the person must read).
// A toast that carries an Undo takes focus onto its Undo button: the 8 seconds are too short to Tab to it from wherever focus was.
function showToast(msg, undo = null, sticky = false) {
  const box = toastBox(), u = box.children[1];
  box.firstChild.textContent = msg; undoSet = undo; u.hidden = !undo; u.removeAttribute("aria-disabled");
  if (sticky) box.dataset.sticky = "1"; else delete box.dataset.sticky;
  box.hidden = false; clearTimeout(toastTimer); if (!sticky) box.arm();
  if (undo) u.focus();
}
// "Not built yet" notes must not replace a pending Undo: with an Undo showing they are only announced.
function softNote(msg) { const box = document.getElementById("ptoast"); if (undoSet && box && !box.hidden) liveSay(msg); else showToast(msg); }
// The rows on screen: the Pantry's boxes, or the jar page's boxes (jar-screen.js) when that page is showing. Only one of the two is ever visible.
const rowsRoot = () => ($("screen-jar").hidden ? $("pantryBody") : $("jarBoxes"));
const pfk = (k) => (k ? [...rowsRoot().querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === k) || null : null);
function focusPantryRow(fk) { (pfk(fk) || rowsRoot().querySelector("summary"))?.focus(); }

// ---------- Done and Skip (data-layer-plan B8) ----------
const GONE = "This task was removed. Nothing was saved.";
// The task as it is in S right now (another tab may have changed it): { thing, task, row } or null when it was removed.
function lookupTask(thingId, taskId) {
  const thing = thingById(thingId), task = thing && thing.tasks.find((k) => k.id === taskId);
  if (!task) return null;
  const row = Due.pantryTasks({ things: [thing], logs: logsFor(thingId), readings: readingsFor(thingId), fillups: fillupsFor(thingId) }, today(), thingId + "|" + taskId)[0];
  return row ? { thing, task, row } : null;
}
// Where focus goes after the row moves: the row itself if it stayed, else the next row in its box, the previous, else the box heading.
function focusPlan(rowFk) {
  const b = pfk(rowFk), li = b && b.closest("li"), box = b && b.closest("details.box"), sib = (x) => (x && x.querySelector(".drb") ? x.querySelector(".drb").dataset.fk : null);
  for (const o of rowsRoot().querySelectorAll(".drb[aria-expanded=true]")) { o.setAttribute("aria-expanded", "false"); document.getElementById(o.getAttribute("aria-controls")).hidden = true; } // the moved row must not reopen
  return { self: rowFk, box: box && box.dataset.box, next: sib(li && li.nextElementSibling), prev: sib(li && li.previousElementSibling), sum: box ? "sum:" + box.dataset.box : null };
}
function focusTarget(p) {
  const inBox = (k) => { const e = pfk(k); return e && e.closest("details.box") && e.closest("details.box").dataset.box === p.box ? e : null; };
  return inBox(p.self) || inBox(p.next) || inBox(p.prev) || pfk(p.sum) || rowsRoot().querySelector("summary");
}
// The toast after a Done, Skip or reading: "Paused until Apr 1." when the save paused a seasonal task, and focus on Undo.
// Undo returns focus to the row, Dismiss or the timeout to where the row went (plan; null for the Menu's Log Hours).
function afterSave(plan, rowFk, cur, msg, undo) {
  const now = cur && lookupTask(cur.thing.id, cur.task.id);
  lastFk = rowFk || "menu"; dismissFk = plan ? focusTarget(plan)?.dataset.fk ?? null : "menu";
  showToast(msg + (now && now.row.chip ? " " + now.row.chip + "." : ""), undo);
}
const skipping = new Set(); // a Skip in flight; the buttons stay enabled so focus is not dropped
const retryIds = new Map(); // a Skip that failed to save reuses its id on the next tap, so a retry can never write two logs
async function skipTask(k, rowFk) {
  const cur = lookupTask(k.thingId, k.taskId);
  if (!cur) { showToast(GONE, null, true); return; }
  const key = "skip:" + k.id; if (!retryIds.has(key)) retryIds.set(key, newId("m"));
  const res = pantryLog(cur.thing, cur.task, cur.row, { status: "skipped", id: retryIds.get(key), today: today() });
  if (res.error) { showToast(res.error, null, true); return; }
  if (skipping.has(key)) return;
  const plan = focusPlan(rowFk); skipping.add(key);
  try { await commit({ put: { logs: [res.rec] } }); }
  catch (e) { skipping.delete(key); showToast(saveErrorText(e), null, true); return; }
  skipping.delete(key); retryIds.delete(key);
  afterSave(plan, rowFk, cur, "Skipped: " + cur.task.name + ".", { logs: [res.rec.id] });
}

const readingData = (thingId) => ({ logs: logsFor(thingId), readings: readingsFor(thingId), fillups: fillupsFor(thingId) });
// The meter-change prompt (B9.5): an alertdialog on top of the open sheet. Resolves true only for "Yes"; No, Escape and a tap outside all mean No.
// Neither button is the default: focus starts on the heading so Enter can't confirm by accident.
function askMeterChange(entered, last, date) {
  const d = $("mcDialog");
  $("mcLast").textContent = `That's lower than the last reading (${numText(last.typed)}${date < today() ? " on " + dayText(last.date, today()) : ""}).`;
  $("mcTyped").textContent = `You typed ${numText(entered)}.`;
  return new Promise((resolve) => {
    const away = (e) => { if (e.target === d) d.close("no"); };
    const closed = () => { d.removeEventListener("close", closed); d.removeEventListener("click", away); resolve(d.returnValue === "yes"); };
    d.returnValue = "no"; d.addEventListener("close", closed); d.addEventListener("click", away);
    d.showModal(); $("mcTitle").focus();
  });
}

// aria-disabled, not disabled: a disabled button drops keyboard focus to the page while a save runs. The busy flags already stop a second save.
const setBusy = (b, on) => (on ? b.setAttribute("aria-disabled", "true") : b.removeAttribute("aria-disabled"));
// A sheet's one message (its status line) is described only on the field it is about, and is cleared as soon as the person edits.
function describeErr(inputs, input) {
  for (const i of inputs) { i.dataset.base ??= i.getAttribute("aria-describedby") || ""; const v = (i.dataset.base + (i === input ? " " + i.dataset.status : "")).trim(); v ? i.setAttribute("aria-describedby", v) : i.removeAttribute("aria-describedby"); }
}
const dn = { thingId: "", taskId: "", id: "", changeId: "", fk: "", spec: null, touched: false, busy: false, saved: false };
function openDone(k, rowFk) {
  const cur = lookupTask(k.thingId, k.taskId);
  if (!cur) { showToast(GONE, null, true); return; }
  const spec = doneSpec(cur.thing, cur.task, cur.row), hrs = spec.field === "hours";
  Object.assign(dn, { thingId: k.thingId, taskId: k.taskId, id: newId("m"), changeId: newId("r"), fk: rowFk, spec, touched: false, busy: false, saved: false });
  $("dnTitle").textContent = cur.task.name; $("dnSub").textContent = cur.thing.name;
  const date = $("dnDate"), rd = $("dnRead"), hint = $("dnHint");
  date.value = date.max = today();
  $("dnReadWrap").hidden = !spec.field; $("dnReadLabel").textContent = hrs ? "Hours" : "Odometer (miles)";
  rd.step = hrs ? "0.1" : "1"; rd.inputMode = hrs ? "decimal" : "numeric"; rd.value = spec.current ?? "";
  hint.textContent = !spec.field ? "" : spec.current != null ? "Last reading: " + spec.current.toLocaleString("en-US") : spec.required ? "" : "Leave this blank if you don't know it.";
  hint.hidden = !hint.textContent;
  for (const i of [date, rd]) { i.removeAttribute("aria-invalid"); i.readOnly = false; }
  setBusy($("dnSave"), false); setMsg($("dnStatus"), ""); describeErr([date, rd], null);
  $("dnDialog").showModal();
  if (spec.field) { rd.focus(); rd.select(); } else date.focus();
}
async function saveDone(ev, confirmed = false) {
  ev.preventDefault();
  if (dn.busy) return;
  const date = $("dnDate"), rd = $("dnRead"), fail = (text, input) => {
    setMsg($("dnStatus"), text, "err"); for (const i of [date, rd]) i.removeAttribute("aria-invalid"); describeErr([date, rd], input);
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  };
  const cur = lookupTask(dn.thingId, dn.taskId); // recompute now: another tab may have changed this task since the sheet opened
  if (!cur) { fail(GONE); return; }
  const reading = $("dnReadWrap").hidden ? null : numIn(rd.value);
  const res = pantryLog(cur.thing, cur.task, cur.row, { status: "done", date: date.value, reading, id: dn.id, changeId: dn.changeId, today: today(), now: nowISO(), data: readingData(dn.thingId), confirmLower: confirmed });
  if (res.error) { fail(res.error, /^(Pick|Can't save: the date)/.test(res.error) ? date : rd); return; }
  if (res.lower) { // lower than the last reading: ask; nothing is saved until Yes
    dn.busy = true; setBusy($("dnSave"), true);
    const yes = await askMeterChange(reading, res.lower, date.value);
    dn.busy = false; setBusy($("dnSave"), false);
    if (!yes) { rd.focus(); rd.select(); return; }
    return saveDone(ev, true);
  }
  dn.busy = true; setBusy($("dnSave"), true); date.readOnly = rd.readOnly = true; setMsg($("dnStatus"), ""); describeErr([date, rd], null);
  const plan = focusPlan(dn.fk);
  const put = { logs: [res.rec] }; if (res.change) put.readings = [res.change]; // the log and its meter-change row are one transaction
  try { await commit({ put }); }
  catch (e) { dn.busy = false; setBusy($("dnSave"), false); date.readOnly = rd.readOnly = false; fail(saveErrorText(e)); $("dnSave").focus(); return; } // the sheet stays open with the entries kept; the id is reused on retry
  dn.busy = false; dn.saved = true; setBusy($("dnSave"), false);
  $("dnDialog").close();
  afterSave(plan, dn.fk, cur, "Marked done: " + cur.task.name + "." + (res.change ? " Meter change recorded." : ""), { logs: [res.rec.id], ...(res.change ? { readings: [res.change.id] } : {}) });
}

// ---------- Add Reading and Log Hours (data-layer-plan B9.2) ----------
const ar = { thingId: "", meter: "miles", fk: "", id: "", changeId: "", menu: false, busy: false, saved: false };
const hourThings = () => S.things.filter((t) => t.active && Due.hasHourMeter(t)).sort((a, b) => JARS.findIndex(([j]) => j === a.jar) - JARS.findIndex(([j]) => j === b.jar) || cmp(nameKey(a.name), nameKey(b.name)));
function arPickThing(id) { // the sub-line, the shared line and the "Last reading" hint follow the chosen thing
  const th = thingById(id), miles = ar.meter === "miles";
  ar.thingId = th ? th.id : "";
  $("arSub").textContent = th && !ar.menu ? th.name : ""; $("arSub").hidden = !$("arSub").textContent;
  $("arShared").hidden = !th; $("arShared").textContent = th ? `Updates every ${miles ? "odometer" : "hour-meter"} task on ${th.name}.` : "";
  const last = th ? Due.checkReading(readingData(th.id), th, ar.meter, today(), 0, nowISO(), today()).last : null;
  $("arHint").textContent = !th ? "" : last ? `Last reading: ${numText(last.typed)} on ${dayText(last.date, today())}` : "No reading yet.";
}
// From a task row's Add Reading: { thingId, meter, fk }. From the Menu's Log Hours: { menu: true } (a picker when more than one thing has an hour meter).
function openReading({ thingId = "", meter = "miles", fk = "", menu = false }) {
  const list = menu ? hourThings() : [];
  if (menu && !list.length) { showToast("No thing has an hour meter.", null, true); return; }
  if (menu) { thingId = list.length === 1 ? list[0].id : ""; meter = "hours"; }
  else if (!thingById(thingId)) { showToast("This thing was removed. Nothing was saved.", null, true); return; }
  Object.assign(ar, { meter, fk, menu, busy: false, saved: false, id: newId(meter === "miles" ? "f" : "r"), changeId: newId("r") });
  const rd = $("arRead"), miles = meter === "miles", who = $("arWho");
  $("arTitle").textContent = miles ? "Add odometer reading" : "Add hours reading";
  $("arWhoWrap").hidden = list.length < 2; who.replaceChildren(el("option", null, "Choose one"));
  who.firstChild.value = "";
  for (const t of list.length > 1 ? list : []) { const o = el("option", null, `${t.name}, ${JARS.find(([j]) => j === t.jar)[1]}`); o.value = t.id; who.append(o); }
  $("arDate").value = $("arDate").max = today();
  $("arReadLabel").textContent = miles ? "Odometer (miles)" : "Hours"; rd.step = miles ? "1" : "0.1"; rd.inputMode = miles ? "numeric" : "decimal"; rd.value = ""; // blank on purpose: a prefilled number saved by habit would stamp a stale reading
  for (const i of [who, $("arDate"), rd]) { i.removeAttribute("aria-invalid"); i.readOnly = false; i.disabled = false; }
  arPickThing(thingId); setMsg($("arStatus"), ""); describeErr([who, $("arDate"), rd], null); setBusy($("arSave"), false);
  $("arDialog").showModal();
  (list.length > 1 ? who : rd).focus();
}
async function saveReading(confirmed = false) {
  if (ar.busy) return;
  const who = $("arWho"), date = $("arDate"), rd = $("arRead"), inputs = [who, date, rd];
  const fail = (text, input) => {
    setMsg($("arStatus"), text, "err"); for (const i of inputs) i.removeAttribute("aria-invalid"); describeErr(inputs, input);
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  };
  const lock = (on) => { ar.busy = on; setBusy($("arSave"), on); date.readOnly = rd.readOnly = on; who.disabled = on && document.activeElement !== who; };
  if (!ar.thingId) { fail("Pick which one.", who); return; }
  const thing = thingById(ar.thingId); // now, not when the sheet opened: another tab may have changed it
  if (!thing) { fail("This thing was removed. Nothing was saved."); return; }
  const value = numIn(rd.value);
  const res = readingPlan(thing, ar.meter, { date: date.value, value, id: ar.id, changeId: ar.changeId, today: today(), now: nowISO(), data: readingData(thing.id), confirmLower: confirmed });
  if (res.error) { fail(res.error, /^(Pick|Can't save: the date)/.test(res.error) ? date : rd); return; }
  if (res.lower) {
    lock(true);
    const yes = await askMeterChange(value, res.lower, date.value);
    lock(false);
    if (!yes) { rd.focus(); rd.select(); return; }
    return saveReading(true);
  }
  lock(true); setMsg($("arStatus"), ""); describeErr(inputs, null);
  const plan = ar.menu ? null : focusPlan(ar.fk);
  try { await commit({ put: res.put }); }
  catch (e) { lock(false); fail(saveErrorText(e)); $("arSave").focus(); return; } // the sheet stays open with the entries kept; the ids are reused on retry
  ar.busy = false; ar.saved = true; setBusy($("arSave"), false);
  $("arDialog").close();
  afterSave(plan, ar.fk, null, res.change ? "Meter change recorded." : `Reading saved: ${numText(value)} ${ar.meter === "miles" ? "mi" : "hr"}.`, res.undo);
}
document.addEventListener("DOMContentLoaded", function readingEvents() {
  const d = $("arDialog");
  $("arForm").addEventListener("submit", (ev) => { ev.preventDefault(); saveReading(false); });
  $("arCancel").addEventListener("click", () => { if (!ar.busy) d.close(); });
  d.addEventListener("cancel", (e) => { if (ar.busy) e.preventDefault(); });
  d.addEventListener("close", () => { if (!ar.saved) { if (ar.menu) $("menuBtn").focus(); else if (ar.fk.startsWith("assets:")) asFocusUpdate(ar.fk.slice(7)); else focusPantryRow(pfk("act:" + ar.fk.slice(4) + ":Add Reading") ? "act:" + ar.fk.slice(4) + ":Add Reading" : ar.fk); } });
  const clearAr = () => { setMsg($("arStatus"), ""); describeErr([$("arWho"), $("arDate"), $("arRead")], null); };
  $("arWho").addEventListener("change", () => { $("arWho").removeAttribute("aria-invalid"); clearAr(); arPickThing($("arWho").value); });
  for (const i of [$("arDate"), $("arRead")]) i.addEventListener("input", () => { i.removeAttribute("aria-invalid"); clearAr(); });
});
// app.js (which defines $) loads after this file, so wire the sheet once every script has run.
document.addEventListener("DOMContentLoaded", function doneEvents() {
  const d = $("dnDialog");
  $("dnForm").addEventListener("submit", saveDone);
  $("dnCancel").addEventListener("click", () => { if (!dn.busy) d.close(); });
  d.addEventListener("cancel", (e) => { if (dn.busy) e.preventDefault(); }); // Escape while saving
  d.addEventListener("close", () => { if (!dn.saved) focusPantryRow(pfk("act:" + dn.fk.slice(4) + ":Done") ? "act:" + dn.fk.slice(4) + ":Done" : dn.fk); }); // back to the Done button (some browsers don't focus a button on click, and the row may have been redrawn behind the sheet)
  const clearDn = () => { setMsg($("dnStatus"), ""); describeErr([$("dnDate"), $("dnRead")], null); };
  $("dnRead").addEventListener("input", () => { dn.touched = true; $("dnRead").removeAttribute("aria-invalid"); clearDn(); });
  $("dnDate").addEventListener("input", () => {
    $("dnDate").removeAttribute("aria-invalid"); clearDn();
    const v = $("dnDate").value; // an earlier date clears the untouched prefill (the latest reading is wrong for an older date)
    if (dn.spec && dn.spec.field && !dn.touched && validISODate(v)) $("dnRead").value = v < today() ? "" : dn.spec.current ?? "";
  });
});

// ---------- Pantry body ----------
function pantryRow(k, boxId, ns = "") { // ns keeps ids apart when the same rows are also drawn on the jar page ("j")
  const li = el("li", "dr" + (dueView(k).over ? " over" : ""));
  const v = dueView(k), jarName = JARS.find(([j]) => j === k.jar)[1], aid = ns + "pa-" + k.id;
  const b = el("button", "drb"); b.type = "button"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", aid);
  const tile = el("span", "ji"); tile.append(ico(rowIcon(k)));
  const tx = el("span", "ptx"); tx.append(el("b", null, k.task), el("small", null, k.thing));
  const w = el("span", "pw");
  if (v.over) { const bd = el("span", "badge err"); bd.setAttribute("aria-hidden", "true"); bd.append(ico("alert"), "Overdue"); w.append(bd); } // the hidden sentence below already says Overdue
  const vis = el("span"); vis.setAttribute("aria-hidden", "true");
  for (const p of v.parts) vis.append(el("i", v.ask ? "ask" : null, p));
  w.append(vis);
  b.setAttribute("aria-label", `${k.task}, ${k.thing}, ${jarName}. ${v.vh}`); // one name, built here, so no stray space before a comma
  const pb = el("span", "pbody"); pb.append(tx, w); // wraps as a pair so the due text drops under the title at large text
  b.append(tile, pb); b.dataset.fk = "row:" + aid;
  const acts = el("div", "pacts"); acts.id = aid; acts.hidden = true; acts.setAttribute("role", "group"); acts.setAttribute("aria-label", `${k.task}, ${k.thing}`);
  const mk = (cls, icon, label, hidden) => { const a = el("button", "act" + cls); a.type = "button"; a.dataset.fk = "act:" + aid + ":" + label; a.append(ico(icon), label); if (hidden) a.append(vh(hidden)); a.addEventListener("click", () => (label === "Done" && k.thingId ? openDone(k, b.dataset.fk) : label === "Skip" && k.thingId ? skipTask(k, b.dataset.fk)
    : label === "Add Reading" && k.thingId ? openReading({ thingId: k.thingId, meter: k.unit === "mi" ? "miles" : "hours", fk: b.dataset.fk }) : softNote(k.thingId ? "Open isn't built yet." : "Not saved yet: sample data only."))); return a; };
  // A calendar task with no start date can't be placed by a log, so it offers only Open (QA B7/B8 bug 1).
  if (k.stuck) acts.append(mk(" pri", "chevr", "Open"));
  else acts.append(mk(" pri", "check", "Done"), mk("", "skip", "Skip", " this time"), k.meter ? mk("", "gauge", "Add Reading") : mk("", "chevr", "Open"));
  b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") !== "true";
    for (const o of rowsRoot().querySelectorAll(".drb[aria-expanded=true]")) { o.setAttribute("aria-expanded", "false"); document.getElementById(o.getAttribute("aria-controls")).hidden = true; }
    b.setAttribute("aria-expanded", String(open)); acts.hidden = !open;
  });
  li.append(b, acts);
  return li;
}

const rowIcon = (k) => k.icon || ({ vehicles: "car", home: ["mower", "generator", "snow-blower", "power-tools"].includes(k.kind) ? "engine" : "home", health: "heart", finance: "dollar" })[k.jar];

function pantryContext() {
  const dev = sampleMode() != null;
  const rows = dev ? sampleTasks(sampleMode()).map(sampleRow)
    : Due.pantryTasks({ things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups, hiddenJars: S.hiddenJars }, today());
  const v = Due.pantryBoxes(rows);
  return {
    tasks: rows, boxes: v.boxes, attn: v.attn, jarDots: v.jarDots, dev,
    empty: dev ? !rows.length : !S.things.length, // spec 4.2 AC 12: the first-step prompt only when there are no things at all
    hasVehicle: S.things.some((t) => t.jar === "vehicles" && t.active),
    hasHours: dev ? rows.some((k) => k.unit === "hr") : S.things.some((t) => t.active && Due.hasHourMeter(t)),
  };
}

// The Pantry with no things at all (spec 4.2 AC 12; mockups P9, O1): what Pickle It is, the four first steps, and Import a Backup. Each step opens the Add flow at that jar (setup-screen.js).
function firstStepCard() {
  const W = Onboarding.WELCOME, view = Onboarding.firstRunView(S.things, { ios: isIOS, standalone: isStandalone() });
  const c = el("div", "card pempty");
  c.append(ico("jar", "ic big"), el("p", "lead", W.lead), el("p", "hint", W.hint), el("p", "hint", W.about));
  if (view.iosNote) { // only in iPhone or iPad Safari, not in the installed app (O1)
    const n = el("div", "nudge"); n.setAttribute("role", "note");
    const p = el("p"); p.append(el("strong", null, W.iosBold), " " + W.iosRest);
    const acts = el("div", "nudge-acts"), a = el("a", "mbtn", "Show Me How"); Object.assign(a, { href: "#settings" }); a.dataset.open = "install-ios"; a.dataset.settingsTab = "app";
    acts.append(a); n.append(p, acts); c.append(n);
  }
  const grid = el("div", "addgrid");
  for (const st of view.steps) {
    const b = btn("btn2", "", (ev) => openSetup({ jar: st.jar, opener: ev.currentTarget })); b.dataset.fk = "add:" + st.jar; b.setAttribute("aria-label", "Start with " + st.label.toLowerCase()); // "A Vehicle" -> "Start with a vehicle"
    b.append(ico(suJarIcon[st.jar]), st.label); grid.append(b);
  }
  const imp = el("a", "btn2 wide", ""); imp.href = "#settings"; imp.dataset.settingsTab = "app"; imp.dataset.open = "impTitle"; imp.dataset.fk = "import";
  imp.append(ico("upload"), "Import a Backup");
  c.append(grid, imp);
  return c;
}

// o (the jar page, jar-screen.js): ns = id prefix, limit = rows shown, onMore = the Show More handler (the Pantry's footer links to each jar instead), quiet/quietLine = the witty line rule and text.
function boxEl(id, title, defOpen, list, ctx, o = {}) {
  const ns = o.ns || "", limit = o.limit || BOX_CAP;
  const d = el("details", "box"); d.dataset.box = id;
  d.open = pref.get("box-" + id, defOpen ? "1" : "0") === "1";
  const sum = el("summary"), h = el("h2", null, title); h.id = ns + "h-" + id; sum.dataset.fk = "sum:" + id;
  const cnt = el("span", "cnt", String(list.length)); cnt.append(vh(list.length === 1 ? " task" : " tasks"));
  const chev = ico("chevd", "ic chev"); sum.append(h, cnt, chev); d.append(sum);
  // Save only what the person does (a click or Enter/Space on the summary), never the default we set on render.
  sum.addEventListener("click", () => setTimeout(() => pref.set("box-" + id, d.open ? "1" : "0"), 0));
  if (!list.length) {
    const quiet = id === "due-this-week" && (o.quiet ?? !ctx.attn);
    d.append(el("p", "pnone" + (quiet ? " lead" : ""), quiet ? o.quietLine || CANNING_LINES[Math.floor(Date.parse(today()) / 864e5) % CANNING_LINES.length] : "Nothing here yet."));
    return d;
  }
  const ul = el("ul", "dl");
  for (const k of list.slice(0, limit)) ul.append(pantryRow(k, id, ns));
  d.append(ul);
  if (o.onMore && list.length > limit) {
    const f = JarPage.cap(list, limit).footer, more = el("div", "more"), b = btn("btn2 small", `Show ${f.more} More`, () => o.onMore(id, f));
    b.dataset.fk = "more:" + id; b.append(vh(" tasks in " + title)); more.append(el("p", null, `Showing ${f.shown} of ${f.of}.`), b); d.append(more);
  } else if (list.length > limit) {
    const more = el("div", "more"); more.append(el("p", null, `Showing ${limit} of ${list.length}`));
    const links = el("div", "jlinks"), rest = {};
    for (const k of list.slice(limit)) rest[k.jar] = (rest[k.jar] || 0) + 1;
    for (const [j, name] of JARS) if (rest[j]) { const a = el("a", null, `${name} (${rest[j]})`); a.href = "#" + j; a.dataset.fk = "jl:" + id + ":" + j; links.append(a); }
    more.append(links); d.append(more);
  }
  return d;
}

// renderAll also runs on tab refocus and on a save in another tab: redraw `body` with draw(), keeping the open row and the focused control (also used by the jar page).
function redrawKeeping(body, draw) {
  const fkOf = (e) => (e && body.contains(e) ? e.dataset.fk : null), focusKey = fkOf(document.activeElement), openKey = fkOf(body.querySelector(".drb[aria-expanded=true]"));
  body.replaceChildren();
  draw();
  const byKey = (k) => (k ? [...body.querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === k) : null);
  const ob = byKey(openKey); // reopen directly: a click would bubble to the document and close the Menu
  if (ob) { ob.setAttribute("aria-expanded", "true"); document.getElementById(ob.getAttribute("aria-controls")).hidden = false; }
  byKey(focusKey)?.focus({ preventScroll: true });
}

function renderPantry() {
  const ctx = pantryContext(), body = $("pantryBody");
  $("sampleNote").hidden = !ctx.dev;
  $("pantryCount").textContent = ctx.empty ? "Nothing on the shelves yet"
    : ctx.attn === 0 ? "Nothing needs attention this week" : ctx.attn === 1 ? "1 task needs attention this week" : `${ctx.attn} tasks need attention this week`;
  redrawKeeping(body, () => {
    if (ctx.empty) {
      body.append(firstStepCard());
    } else {
      const boxes = el("div", "boxes");
      for (const [id, title, open] of BOX_DEFS) boxes.append(boxEl(id, title, open, ctx.boxes[id], ctx));
      body.append(boxes);
    }
  });
  // Jar bar: red dot (decorative, aria-hidden) + the dot's meaning in the link's name. One aria-label, so no stray space before the comma.
  for (const a of document.querySelectorAll("#bottomBar a[data-screen]")) {
    const j = a.dataset.screen; if (!(j in ctx.jarDots)) continue;
    a.hidden = S.hiddenJars.includes(j); // a hidden jar has no tab (spec 4.1 AC 3)
    a.querySelector(".dot").hidden = !ctx.jarDots[j];
    if (ctx.jarDots[j]) a.setAttribute("aria-label", JARS.find(([k]) => k === j)[1] + ", has overdue or due this week tasks"); else a.removeAttribute("aria-label");
  }
  renderMenu(ctx);
}

// ---------- Menu (spec 4.18) ----------
function menuRows(ctx) {
  const due = typeof backupDue === "function" ? backupDue() : null;
  const rows = [];
  if (ctx.hasVehicle) rows.push({ label: "Enter Fill-Up", icon: "fuel", go: () => { pendingFill = true; location.hash = "#log"; if (curScreen === "log") route(); } });
  if (ctx.hasHours) rows.push({ label: "Log Hours", icon: "clock", go: () => openReading({ menu: true }) });
  rows.push({ label: "Settings", icon: "gear", sub: due ? "Backup due" : "", dot: !!due, go: () => { focusHeading = true; location.hash = "#settings"; } });
  return rows;
}
function renderMenu(ctx) {
  const rows = menuRows(ctx), menu = $("menuList"), btnEl = $("menuBtn");
  const dot = rows.some((r) => r.dot), at = menuItems().indexOf(document.activeElement);
  $("backupDot").hidden = !dot; $("menuName").textContent = dot ? "Menu, backup due" : "Menu";
  menu.replaceChildren();
  for (const r of rows) {
    const b = el("button", "mi"); b.type = "button"; b.setAttribute("role", "menuitem"); b.tabIndex = -1;
    const tt = el("span", "mt2"); tt.append(el("b", null, r.label)); if (r.sub) tt.append(el("small", null, r.sub));
    b.append(ico(r.icon), tt); if (r.dot) { const d = el("i", "mdot"); d.setAttribute("aria-hidden", "true"); b.append(d); }
    b.addEventListener("click", () => { closeMenu(false); r.go(); });
    menu.append(b);
  }
  if (!menu.hidden && btnEl.getAttribute("aria-expanded") !== "true") menu.hidden = true;
  if (at >= 0) menuItems()[Math.min(at, rows.length - 1)]?.focus();
}
const menuItems = () => [...$("menuList").querySelectorAll(".mi")];
function openMenu(i) { $("menuList").hidden = false; $("menuBtn").setAttribute("aria-expanded", "true"); const it = menuItems(); it[i < 0 ? it.length - 1 : i].focus(); }
function closeMenu(refocus) { $("menuList").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); if (refocus) $("menuBtn").focus(); }
// app.js (which defines $) loads after this file, so wire the events once every script has run.
document.addEventListener("DOMContentLoaded", function menuEvents() {
  const b = $("menuBtn"), m = $("menuList");
  b.addEventListener("click", () => (m.hidden ? openMenu(0) : closeMenu(true)));
  b.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); openMenu(0); } else if (e.key === "ArrowUp") { e.preventDefault(); openMenu(-1); } });
  m.addEventListener("keydown", (e) => {
    const it = menuItems(), i = it.indexOf(document.activeElement), k = e.key;
    if (k === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (k === "Tab") closeMenu(false);
    else if (k === "ArrowDown") { e.preventDefault(); it[(i + 1) % it.length].focus(); }
    else if (k === "ArrowUp") { e.preventDefault(); it[(i + it.length - 1) % it.length].focus(); }
    else if (k === "Home") { e.preventDefault(); it[0].focus(); }
    else if (k === "End") { e.preventDefault(); it[it.length - 1].focus(); }
  });
  document.addEventListener("click", (e) => { if (!m.hidden && !$("menuWrap").contains(e.target)) closeMenu(false); });
  window.addEventListener("hashchange", () => closeMenu(false));
});
