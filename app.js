"use strict";
/* Pickle It: screens and interactions. Storage, math and CSV are in data.js. */

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, onClick) { const b = el("button", cls, text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; }
const numIn = (v) => { const s = String(v).trim(); if (s === "") return null; if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN; const n = Number(s); return Number.isFinite(n) ? n : NaN; }; // no exponent (1e3) or hex
const intIn = (v) => { const n = numIn(v); return n == null || Number.isNaN(n) ? n : Number.isInteger(n) ? n : NaN; };
const money = (n, d = 2) => (Number.isFinite(n) ? "$" + n.toFixed(d) : "—");
const mi = (n) => Math.round(n).toLocaleString() + " mi";
const shortDate = (iso) => { const [y, m, d] = String(iso).split("-"); return `${+m}/${+d}/${y.slice(2)}`; };
function longDate(iso) { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + "s"}`;
function andList(parts) { parts = parts.filter(Boolean); return parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const OTHER_APP_STATUS = new Set(["expStatus", "jarStatus", "delExpStatus", "delStatus"]);
function setMsg(node, text, kind = "") {
  if (text && OTHER_APP_STATUS.has(node.id)) { const i = $("impStatus"); i.replaceChildren(); i.className = "status"; } // one status line at a time on App Settings: a later Export or delete message replaces the import result
  node.textContent = text; node.className = "status" + (kind ? " " + kind : "");
}
const setStatus = (text, kind) => setMsg($("status"), text, kind);
const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(PREF_PREFIX + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREF_PREFIX + k, v); } catch {} },
};
const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobile = isIOS || isAndroid;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const agoText = (n) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);
function saveErrorText(e) {
  if (e && e.name === "QuotaExceededError") return "This device is out of space for the app's data. Free up some space, then try again.";
  return "Couldn't save" + (e && e.message ? ` (${e.message})` : "") + ". Try again.";
}
// "Tap again to …" confirmation for small destructive buttons.
// o.name: what the row is, for the spoken name ("Delete fill-up Truck, Oct 5, 45,210 miles"). o.said: the polite line after the delete. o.heading: where focus goes
// when no row is left. The redraw removes the button, so focus goes to the Delete of the row that takes its place (or the last one), else the heading (QA M-2, M-7).
function armedButton(label, armedLabel, action, o = {}) {
  const b = btn("del", label), nm = o.name ? " " + o.name : "", rowSel = ":scope > .fu, :scope > .item";
  const setName = (t) => { if (o.name) b.setAttribute("aria-label", t + nm); };
  let armed = false, timer; setName(label);
  b.addEventListener("click", async () => {
    if (!armed) {
      armed = true; b.textContent = armedLabel; b.classList.add("armed"); setName(armedLabel); liveSay(armedLabel + ".");
      timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove("armed"); setName(label); }, 4000); return;
    }
    clearTimeout(timer); b.disabled = true;
    const row = b.closest(".fu, .item"), box = row && row.parentNode, at = box ? [...box.querySelectorAll(rowSel)].indexOf(row) : -1;
    try {
      await action();
      if (o.said) liveSay(o.said);
      const rows = box ? [...box.querySelectorAll(rowSel)] : [];
      (rows[Math.min(at, rows.length - 1)]?.querySelector(".del") || (o.heading && $(o.heading)))?.focus(); // the row that took its place, else the last one
    } catch (e) { setStatus(saveErrorText(e), "err"); b.disabled = false; }
  });
  return b;
}

// ---------- Saving: write, tell other open tabs, redraw ----------
const bc = "BroadcastChannel" in self ? new BroadcastChannel("pickle-it") : null;
if (bc) bc.onmessage = async (ev) => { if (ev.data === "wiped") { location.reload(); return; } try { await reload(); } catch { return; } renderAll(); }; // reload fails once the connection is closed; the banner already says why
let persistState = null, persistAsked = false;
async function persistOnce() {
  if (persistAsked || persistState === true) return;
  persistAsked = true;
  persistState = await askPersist();
  renderStorage();
}
async function commit(changes, opts) {
  await save(changes, opts);
  bc?.postMessage("changed");
  renderAll();
  persistOnce();
}

// Deletes fill-ups/logs of a thing together with the meter-change row saved with them, in one transaction.
const deleteRecords = (thing, del) => commit({ del: { ...del, readings: changeRowsToDrop(thing, S, del) } });

// ---------- Confirm / ask dialog ----------
// body: a line, or an array of lines (one paragraph each). alt: the text of an optional middle choice (the resolved value is then "ok", "alt" or false);
// the buttons are then stacked as OK, alt, Cancel, in that tab order. outsideCancels: a press and release on the dim area cancels (not for a dialog with a typed field).
function askDialog({ title, body = "", ok = "OK", cancel = "Cancel", alt = null, danger = false, input = null, validate = null, outsideCancels = false }) {
  const d = $("cDialog"), form = $("cForm"), lines = (Array.isArray(body) ? body : [body]).filter(Boolean), btns = $("cOk").parentNode;
  $("cTitle").textContent = title;
  $("cBody").replaceChildren(...lines.map((t) => el("p", null, t))); $("cBody").hidden = !lines.length;
  d.setAttribute("role", danger ? "alertdialog" : "dialog"); // a delete is an alert dialog, read aloud on open
  $("cOk").textContent = ok; $("cOk").className = "save" + (danger ? " danger" : "");
  $("cCancel").textContent = cancel; $("cCancel").hidden = cancel === null; // null: a notice with only OK
  $("cAlt").hidden = !alt; $("cAlt").textContent = alt || ""; btns.classList.toggle("three", !!alt);
  btns.replaceChildren(...(alt ? [$("cOk"), $("cAlt"), $("cCancel")] : [$("cCancel"), $("cOk"), $("cAlt")]));
  $("cInputWrap").hidden = !input;
  setMsg($("cStatus"), "");
  $("cHint").textContent = input && input.hint || ""; $("cHint").hidden = !$("cHint").textContent; // a plain hint tied to the field
  if (input) { $("cInputLabel").textContent = input.label; $("cInput").value = input.value || ""; $("cInput").placeholder = input.placeholder || ""; }
  return new Promise((resolve) => {
    const onSubmit = (ev) => {
      if (ev.submitter?.value === "ok" && input && validate) {
        const err = validate($("cInput").value);
        if (err) { ev.preventDefault(); setMsg($("cStatus"), err, "err"); markInput(true); $("cInput").focus(); } // the message belongs to the field
      }
    };
    const markInput = (bad) => { const i = $("cInput"), ids = [$("cHint").hidden ? "" : "cHint", bad ? "cStatus" : ""].filter(Boolean).join(" "); if (bad) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); if (ids) i.setAttribute("aria-describedby", ids); else i.removeAttribute("aria-describedby"); };
    const onType = () => { markInput(false); setMsg($("cStatus"), ""); };
    const onKey = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("cOk").click(); } };
    let downOut = false;
    const onDown = (ev) => { downOut = ev.target === d; }, onTap = (ev) => { if (outsideCancels && ev.target === d && downOut) d.close("cancel"); downOut = false; };
    const onClose = () => {
      form.removeEventListener("submit", onSubmit); $("cInput").removeEventListener("keydown", onKey); $("cInput").removeEventListener("input", onType); markInput(false); d.removeEventListener("close", onClose);
      d.removeEventListener("pointerdown", onDown); d.removeEventListener("click", onTap);
      const yes = d.returnValue === "ok";
      resolve(input ? (yes ? cleanText($("cInput").value, 80) : null) : alt ? (yes || d.returnValue === "alt" ? d.returnValue : false) : yes);
    };
    d.addEventListener("pointerdown", onDown); d.addEventListener("click", onTap);
    form.addEventListener("submit", onSubmit);
    $("cInput").addEventListener("keydown", onKey); $("cInput").addEventListener("input", onType); markInput(false);
    d.addEventListener("close", onClose);
    d.returnValue = "cancel";
    d.showModal();
    (input ? $("cInput") : cancel === null ? $("cOk") : $("cCancel")).focus();
  });
}

// ---------- Screens ----------
const SCREENS = ["pantry", "log", "jar", "settings"];
let curScreen = null, curJar = null, pendingOpen = null, pendingThing = false; // curJar: the jar whose page is showing; pendingThing: a thing page was asked for from the jar page
// A route change (Back, a link, a typed hash) cancels any open sheet or prompt: nothing is saved, and each dialog's close handler puts focus back where it came from. The Add flow (setupDlg) handles popstate itself.
function closeRouteDialogs() {
  let any = false;
  for (const id of ["mcDialog", "dnDialog", "arDialog", "cDialog"]) { const d = $(id); if (d.open) { d.close("cancel"); any = true; } } // the meter-change prompt sits on top of the sheet, so it goes first
  return any;
}
function route() {
  const closedDlg = closeRouteDialogs();
  let s = location.hash.replace(/^#/, "");
  if (s === "backup") s = "settings"; // old links and bookmarks
  const jarView = s === "vehicles-jar"; // the Vehicles jar page, opened from the last card on the Vehicles page (Fill-Ups and History)
  const asked = jarView ? "vehicles-jar" : s, open = routeAround(asked, S.hiddenJars);
  if (open !== asked) { s = open; history.replaceState(null, "", "#pantry"); } // a hidden jar's address opens the Pantry
  const jar = open !== asked ? null : jarView ? "vehicles" : JAR_NAMES.includes(s) && s !== "vehicles" ? s : null;
  if (jar) s = "jar"; // the jar page (spec 4.21); the Vehicles tab itself is the Fill-Ups and History page (v0.1.1 #9)
  else if (s === "vehicles") s = "log";
  else if (!SCREENS.includes(s) || s === "jar") s = "pantry";
  const arrived = s !== curScreen || jar !== curJar; // a different screen or jar: the jar page starts fresh and its heading takes focus
  if (jar && arrived) resetJarPage(jar);
  for (const n of SCREENS) $("screen-" + n).hidden = n !== s;
  const cur = s === "log" ? "vehicles" : s === "settings" ? "" : s === "jar" ? jar : s;
  for (const a of document.querySelectorAll("#bottomBar a")) {
    if (a.dataset.screen === cur) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (curScreen === "settings" && s !== "settings") resetAssets(); // Filter, Sort, View and search are not remembered after leaving Settings (spec 4.17 AC 12)
  if (s === "settings") { showSettingsTab(pref.get("settingsTab", "assets")); renderAssets(); }
  else if ($("delDialog").open && !deleting) $("delDialog").close(); // leaving Settings at either delete step changes nothing
  if (s === "pantry") renderPantry();
  if (s === "jar") renderJar();
  if (s === "log") { if (arrived) resetLogPage(); renderLog(); }
  if (arrived) window.scrollTo(0, 0);
  const wasScreen = curScreen; curScreen = s; curJar = jar;
  if (closedDlg && arrived) focusHeading = true; // the closed dialog's opener may be on a screen that just hid
  if ((s === "jar" || s === "log") && arrived && wasScreen !== null) focusHeading = true; // arriving from a tab or a link: the heading takes focus (4.21 AC 9)
  if (s === "settings" && pendingThing) { pendingThing = false; const h = $("asDetail").querySelector("h1"); if (h) { h.tabIndex = -1; h.focus(); } } // a thing opened from the jar page
  if (focusHeading) { focusHeading = false; const h = $("screen-" + s).querySelector("h1"); h.tabIndex = -1; h.focus(); }
  if (s === "log") { if (pendingFill) { pendingFill = false; if (vehicleThings().length) openEntry(false); } }
  if (pendingOpen) {
    const d = $(pendingOpen); pendingOpen = null;
    if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: "start", behavior: smooth() }), 50); if (/^H\d$/.test(d.tagName)) { d.tabIndex = -1; d.focus({ preventScroll: true }); } } // a heading (Import a Backup) takes focus
  }
}
window.addEventListener("hashchange", route);
document.addEventListener("click", (ev) => {
  const st = ev.target.closest("[data-settings-tab]");
  if (st) pref.set("settingsTab", st.dataset.settingsTab); // a link that should land on App Settings
  const a = ev.target.closest("[data-open]");
  if (a) { pendingOpen = a.dataset.open; if (location.hash === a.getAttribute("href")) route(); }
  const t = ev.target.closest("#bottomBar a");
  if (t && location.hash === t.getAttribute("href")) window.scrollTo({ top: 0, behavior: smooth() });
});

// J11: a shown jar with nothing in it. The same short setup as first run, opened at that jar. Not redrawn while it is already there, so a focused button stays put.
function jarEmptyCard(jar, box) {
  if (box.dataset.jar === jar && box.childElementCount) return;
  const e = Onboarding.EMPTY_JAR[jar];
  box.dataset.jar = jar;
  box.replaceChildren(ico("jar", "ic big"), el("p", "lead", e.lead), el("p", "hint", e.hint), btn("save", e.button, (ev) => openSetup({ jar, opener: ev.currentTarget })));
}
function renderAll() {
  renderPantry();
  fillVehicleSelects();
  renderLog();
  renderJar();
  renderBackup();
  renderJars();
  renderNudges();
  renderAssets();
}

// ---------- Vehicle pickers ----------
// Two pickers in the entry forms (kept in sync). Inactive vehicles are listed only when no vehicle is active.
const entrySels = [$("eVehicle"), $("mVehicle")];
function fillSelect(sel, keep) {
  sel.replaceChildren();
  const active = vehicleThings().filter((v) => v.active), inactive = vehicleThings().filter((v) => !v.active);
  for (const v of active) sel.add(new Option(v.name, v.id));
  if (!active.length) for (const v of inactive) sel.add(new Option(v.name + " (inactive)", v.id));
  const ok = [...sel.options].some((o) => o.value === keep && !o.disabled);
  sel.value = ok ? keep : (sel.options[0]?.value ?? "");
}
function fillVehicleSelects() {
  const ent = entrySels[0].value || pref.get("entryVehicle");
  for (const s of entrySels) fillSelect(s, ent);
}
function selectVehicle(id) {
  pref.set("entryVehicle", id);
  for (const s of entrySels) fillSelect(s, id);
}
for (const sel of entrySels) sel.addEventListener("change", () => {
  for (const o of entrySels) if (o !== sel) o.value = sel.value;
  pref.set("entryVehicle", sel.value);
  fillMaintItems(); prefillMaintOdo();
});

// ---------- The Vehicles page: Fill-Ups and History (v0.1.1 #8 to #10; docs/design/vehicles-fillups-page.html) ----------
// Lifetime MPG per active vehicle, Service History, Recent Fill-Ups (inactive vehicles too), then a card that opens the Vehicles jar. The first 10 rows show; Show N More adds up to 100.
const LOG_FIRST = 10, LOG_STEP = 100;
let lg = { fills: LOG_FIRST, svc: LOG_FIRST }; // rows shown; in memory only, fresh each time the page is opened
let logJarHid = null; // was the Vehicles jar hidden at the last draw of this page? null: not drawn yet since arriving
const resetLogPage = () => { lg = { fills: LOG_FIRST, svc: LOG_FIRST }; jp.shops = freshShops(); logJarHid = null; };
function renderLog() {
  if (!$("screen-log").hidden) { // the jar was hidden while this page was open (another tab): go to the Pantry, as the jar page does. Arriving with it already hidden is allowed.
    const hid = S.hiddenJars.includes("vehicles"), was = logJarHid; logJarHid = hid;
    if (hid && was === false) { focusHeading = true; history.replaceState(null, "", "#pantry"); route(); liveSay("Vehicles was hidden, so you're back at the Pantry."); return; }
  }
  const active = vehicleThings().filter((v) => v.active), has = active.length > 0;
  $("noVehicles").hidden = has;
  $("logMain").hidden = !has;
  $("logSub").hidden = !has; $("logSub").textContent = plural(active.length, "active vehicle");
  if (!$("screen-log").hidden) { $("logHead").append($("menuWrap")); renderMenu(pantryContext()); }
  renderShops();
  if (!has) { closeEntry(); return; }
  renderAllVehicles(); renderServices(); renderList(); renderJarCard();
  fillStationList(); fillShopSelect(); fillMaintItems();
}

// Entry: the Fill-up and Maintenance tabs
function openEntry(maint) {
  if ($("entry").hidden) {
    resetFillForm(); resetMaintForm(); fillMaintItems();
  }
  $("entry").hidden = false;
  setStatus("");
  showTab(maint);
  $("entry").scrollIntoView({ block: "start", behavior: smooth() });
  setTimeout(() => (maint ? $("mOdo") : $("odometer")).focus({ preventScroll: true }), 250);
}
function closeEntry() { $("entry").hidden = true; }
function showTab(maint) {
  $("tabFill").setAttribute("aria-selected", String(!maint)); $("tabMaint").setAttribute("aria-selected", String(maint));
  $("panelFill").inert = maint; $("panelMaint").inert = !maint;
  if (maint) { if (!$("mDate").value) $("mDate").value = today(); if (!$("mOdo").value) prefillMaintOdo(); fillMaintItems(); }
}
$("tabFill").addEventListener("click", () => showTab(false));
$("tabMaint").addEventListener("click", () => showTab(true));

// Fill-up form
function resetFillForm() {
  for (const id of ["station", "odometer", "ppg", "units", "rtotal"]) $(id).value = "";
  $("date").value = today();
  setMsg($("fStatus"), "");
  refreshDisplay();
}
function refreshDisplay() {
  const p = numIn($("ppg").value), g = numIn($("units").value), t = numIn($("rtotal").value);
  const ok = (x) => x != null && !Number.isNaN(x);
  $("dPrice").textContent = ok(p) ? money(p, 3) : "—";
  $("dGal").textContent = ok(g) ? g.toFixed(3) : "—";
  const cost = ok(p) && ok(g) ? p * g : null;
  $("dCost").textContent = money(cost);
  const chk = $("check");
  chk.className = "check";
  if (cost != null && ok(t)) {
    if (Math.abs(cost - t) > 0.05) { chk.textContent = `Receipt total is ${money(t)}, but $/gallon × gallons = ${money(cost)}. Check both numbers.`; chk.classList.add("warn"); }
    else { chk.textContent = `Matches the receipt total of ${money(t)}.`; chk.classList.add("ok"); }
  } else chk.textContent = "";
}
for (const id of ["ppg", "units", "rtotal"]) $(id).addEventListener("input", refreshDisplay);
$("cancelBtn").addEventListener("click", () => { resetFillForm(); closeEntry(); setStatus(""); });
function fillStationList() {
  const seen = new Set(), list = $("stationList");
  list.replaceChildren();
  for (const f of [...S.fillups].sort((a, b) => cmp(b.date, a.date))) {
    if (f.station && !seen.has(lower(f.station))) { seen.add(lower(f.station)); list.append(new Option(f.station)); }
    if (seen.size >= 30) break;
  }
}
function warningText(name, s) {
  const pct = Math.round(Math.abs(s.deviation) * 100), dir = s.deviation < 0 ? "below" : "above";
  const hint = s.deviation < 0
    ? "A missed fill-up, a partial fill or an odometer typo can cause this. If the numbers are right, it may be worth a look at the vehicle."
    : "This usually means the last fill-up wasn't a full tank, or the odometer or gallons were mistyped.";
  return { title: `${s.latest.mpg.toFixed(1)} MPG is ${pct}% ${dir} average`,
    body: `${name}'s fill-up on ${shortDate(s.latest.date)} got ${s.latest.mpg.toFixed(1)} MPG; its average before that was ${s.priorAvg.toFixed(1)}. ${hint}` };
}
// B9b: the lower/higher odometer check for an old form's records. Returns the plan to commit, or null when it stopped (a message shown, or "No").
// Lower opens the same "Did you type that right?" prompt as the Pantry sheets; No keeps the number and returns to the field; Yes adds the change row.
async function checkedPlan(saveBtn, field, fail, v, recs, date, odometer, now) {
  const o = { date, odometer, changeId: newId("r"), today: today(), now };
  let res = formReadingPlan(v, recs, { ...o, data: readingData(v.id) });
  if (res.lower) {
    saveBtn.disabled = true;
    const yes = await askMeterChange(odometer, res.lower, date);
    saveBtn.disabled = false;
    if (!yes) { field.focus(); field.select(); return null; }
    res = formReadingPlan(v, recs, { ...o, data: readingData(v.id), confirmLower: true }); // checked again: another tab may have added a reading
  }
  if (res.error) { fail(res.error); if (res.later) refusalLink($(saveBtn.id === "mSave" ? "mStatus" : "fStatus"), res.later, "miles", entryDraft(saveBtn.id === "mSave", v)); field.focus(); return null; } // #13
  return res;
}
const CHANGE_NOTE = " Meter change recorded. Older readings adjusted.";
$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fail = (t) => setMsg($("fStatus"), t, "err");
  const v = thingById(entrySels[0].value);
  if (!v) return fail("Choose a vehicle.");
  const odometer = intIn($("odometer").value), ppg = numIn($("ppg").value), units = numIn($("units").value), total = numIn($("rtotal").value);
  if (!$("date").value) return fail("Enter the date.");
  if (odometer == null || Number.isNaN(odometer)) return fail("Enter the odometer as a whole number of miles.");
  if (!(ppg > 0)) return fail("Enter the price per gallon.");
  if (!(units > 0)) return fail("Enter the gallons.");
  if (Number.isNaN(total)) return fail("The receipt total isn't a number. Fix it or clear it.");
  const now = nowISO(), r = makeFillup({ thingId: v.id, date: $("date").value, odometer, units, pricePerUnit: ppg, total, station: $("station").value, missed: false, createdAt: now });
  if (r.error) return fail(cap(r.error) + ".");
  if (S.fillups.some((f) => fillupKey(f) === fillupKey(r.rec))) return fail("This fill-up is already saved (same vehicle, date and odometer).");
  const plan = await checkedPlan($("saveBtn"), $("odometer"), fail, v, { fillups: [r.rec] }, r.rec.date, odometer, now);
  if (!plan) return;
  $("saveBtn").disabled = true;
  try {
    await commit({ put: plan.put });
    resetFillForm(); closeEntry();
    selectVehicle(v.id);
    const s = vehicleStats(fillupsFor(v.id), readingsFor(v.id)), note = plan.change ? CHANGE_NOTE : "";
    if (s.latest?.id === r.rec.id && s.flagged) setStatus(`Saved. Heads up: ${warningText(v.name, s).title}. Check the odometer and gallons.${note}`, "warn");
    else if (s.latest?.id === r.rec.id) setStatus(`Saved: ${v.name}, ${s.latest.mpg.toFixed(1)} MPG on this tank.${note}`, "ok");
    else setStatus(`Saved: ${v.name}, ${units.toFixed(3)} gal at ${mi(odometer)}.${s.fillups === 1 ? " MPG shows up after the next fill-up." : ""}${note}`, "ok");
    $("status").focus(); // the form is closed; keep a keyboard user near the result, not at the top of the page
  } catch (e) { fail(saveErrorText(e)); }
  finally { $("saveBtn").disabled = false; }
});

// Maintenance form
const ADD_SHOP = "__add_shop__";
function fillShopSelect() {
  const sel = $("mShop"), keep = sel.value;
  sel.replaceChildren(new Option("Not specified", ""));
  for (const s of S.shops.vehicles) sel.add(new Option(s, s));
  sel.add(new Option("Add a shop…", ADD_SHOP));
  sel.value = [...sel.options].some((o) => o.value === keep) && keep !== ADD_SHOP ? keep : "";
  sel.dataset.prev = sel.value;
}
$("mShop").addEventListener("change", async () => {
  const sel = $("mShop");
  if (sel.value !== ADD_SHOP) { sel.dataset.prev = sel.value; return; }
  const name = await askDialog({ title: "Add a shop", ok: "Add shop", input: { label: "Shop name", placeholder: "e.g. DIY, Main St. Auto" }, validate: shopNameError });
  if (!name) { sel.value = sel.dataset.prev || ""; return; }
  try { await commit(shopChange([...S.shops.vehicles, name])); } catch (e) { setMsg($("mStatus"), saveErrorText(e), "err"); }
  fillShopSelect(); sel.value = name; sel.dataset.prev = name;
});
function updateMaintSummary() {
  const names = [...$("mItemsList").querySelectorAll("input:checked")].map((i) => i.parentElement.textContent);
  $("mItemsSum").textContent = !names.length ? "Select tasks" : names.length <= 2 ? names.join(", ") : `${names.length} tasks selected`;
}
// A closed picker or dialog keeps its inner scroll position, so reopening it started wherever it was left (usually the bottom): reset on every open / close.
$("mItems").addEventListener("toggle", () => { $("mItemsList").scrollTop = 0; });
document.addEventListener("close", (ev) => { ev.target.scrollTop = 0; }, true); // "close" doesn't bubble, so listen in the capture phase
function fillMaintItems() {
  const list = $("mItemsList"), keep = new Set([...list.querySelectorAll("input:checked")].map((i) => i.value));
  const v = thingById(entrySels[0].value);
  list.replaceChildren();
  if (v && !v.tasks.length) list.append(el("div", "mempty", "This vehicle has no tasks. Use Other repairs below, or add tasks in Settings, under Assets."));
  for (const it of v?.tasks || []) {
    const lab = el("label"), cb = el("input");
    cb.type = "checkbox"; cb.value = it.id; cb.checked = keep.has(it.id);
    cb.addEventListener("change", updateMaintSummary);
    lab.append(cb, document.createTextNode(it.name));
    list.append(lab);
  }
  updateMaintSummary();
}
function prefillMaintOdo() { const cur = latestOdo(entrySels[0].value); $("mOdo").value = cur ? cur.odometer : ""; }
function resetMaintForm() {
  for (const cb of $("mItemsList").querySelectorAll("input:checked")) cb.checked = false;
  $("mOther").value = ""; $("mItems").open = false; $("mDate").value = today(); $("mShop").value = "";
  setMsg($("mStatus"), ""); prefillMaintOdo(); updateMaintSummary();
}
$("mCancel").addEventListener("click", () => { resetMaintForm(); closeEntry(); setStatus(""); });
$("mForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fail = (t) => setMsg($("mStatus"), t, "err");
  const v = thingById(entrySels[0].value);
  if (!v) return fail("Choose a vehicle.");
  const date = $("mDate").value, odometer = intIn($("mOdo").value), shop = $("mShop").value === ADD_SHOP ? "" : $("mShop").value;
  const picked = [...$("mItemsList").querySelectorAll("input:checked")].map((i) => v.tasks.find((it) => it.id === i.value)).filter(Boolean);
  const other = $("mOther").value.trim();
  if (!date) return fail("Enter the date.");
  if (odometer == null || Number.isNaN(odometer)) return fail("Enter the odometer as a whole number of miles.");
  if (!picked.length && !other) return fail("Pick at least one task, or describe the other repairs.");
  // One record per item (so each item's countdown restarts), tied together by a visit id.
  const visit = newId("x"), createdAt = nowISO(), recs = [];
  for (const it of picked) recs.push(makeLog({ thingId: v.id, date, odometer, shop, taskId: it.id, taskName: it.name, notes: "", visit, createdAt }));
  if (other) recs.push(makeLog({ thingId: v.id, date, odometer, shop, taskId: "other", taskName: "Other repairs", notes: other, visit, createdAt }));
  const errs = recs.filter((r) => r.error);
  if (errs.length) return fail(cap(errs[0].error) + ".");
  const plan = await checkedPlan($("mSave"), $("mOdo"), fail, v, { logs: recs.map((r) => r.rec) }, date, odometer, createdAt);
  if (!plan) return;
  $("mSave").disabled = true;
  try {
    await commit({ put: plan.put });
    setStatus(`Saved maintenance: ${v.name}, ${mi(odometer)}${shop ? " at " + shop : ""}: ${andList([...picked.map((i) => i.name), other ? "other repairs" : null])}.${plan.change ? CHANGE_NOTE : ""}`, "ok");
    resetMaintForm(); closeEntry();
    selectVehicle(v.id);
    $("status").focus();
  } catch (e) { fail(saveErrorText(e)); }
  finally { $("mSave").disabled = false; }
});

// ---------- Lifetime MPG, Service History, Recent Fill-Ups, the jar card ----------
const moreBox = (shown, total, what, onMore) => { // "Showing 10 of 214." and Show 100 More; the next rows appear in place and focus goes to the first new one
  const more = Math.min(LOG_STEP, total - shown), box = el("div", "more"), p = el("p"), b = btn("btn2 small", `Show ${more} More`, onMore);
  p.append(el("b", null, `Showing ${shown} of ${total}.`)); b.append(vh(" " + what)); box.append(p, b); return box;
};
function renderAllVehicles() {
  const box = $("allVeh"); box.replaceChildren();
  const model = Assets.buildModel({ things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups, hiddenJars: S.hiddenJars }, today());
  for (const t of JarPage.thingsFor(model, "vehicles", Infinity).shown.filter((x) => x.active)) { // the Things list's order
    const life = vehicleStats(fillupsFor(t.id), readingsFor(t.id)).lifetime, li = el("li", "mp");
    const nm = el("span", "nm", t.name), val = el("span", life ? "val" : "no");
    if (life) val.append(el("b", null, life.toFixed(1)), " mpg"); else val.textContent = "No MPG yet";
    nm.setAttribute("aria-hidden", "true"); val.setAttribute("aria-hidden", "true");
    li.append(vh(`${t.name}, ${life ? life.toFixed(1) + " miles per gallon lifetime" : "no MPG yet"}`), nm, val); box.append(li);
  }
}
function renderList() { // Recent Fill-Ups
  const list = $("list"); list.replaceChildren();
  const all = recentFillups(vehicleThings(), S.fillups, S.readings), now = today();
  if (!all.length) { list.append(el("div", "empty", "No fill-ups yet. Use Enter Fill-Up in the Menu after your next stop at the pump.")); return; }
  const at = held && held.fillId ? all.findIndex((e) => e.r.id === held.fillId) : -1; // the record that blocked an entry (#13) is always shown
  const shown = Math.min(all.length, Math.max(lg.fills, at + 1));
  all.slice(0, shown).forEach(({ v, r, row }, i) => {
    const blocked = held && held.fillId === r.id, gal = +(+r.units).toFixed(3);
    const cost = r.pricePerUnit != null ? r.units * r.pricePerUnit : r.total, tot = Number.isFinite(cost) ? money(cost) : "";
    const trip = row.trip != null ? `${row.trip.toLocaleString()} mi` : "", mpg = row.mpg != null && row.kept ? row.mpg.toFixed(1) : "";
    const item = el("div", "fu" + (blocked ? " blocked" : "")); item.dataset.id = r.id; if (!blocked) item.tabIndex = -1;
    const l1 = el("div", "l1"), l2 = el("div", "l2"), stats = el("div", "stats");
    l1.append(el("b", null, v.name + (v.active ? "" : " (inactive)")), el("span", "dt", dayText(r.date, now)));
    for (const k of [`${Number(r.odometer).toLocaleString()} mi`, `${gal} gal`, tot]) if (k) { if (l2.childNodes.length) l2.append(" · "); l2.append(el("i", null, k)); }
    for (const [lb, val] of [["Trip", trip], ["MPG", mpg]]) { const c = el("div", "c"); c.append(el("span", "lb", lb), el("span", "vl" + (val ? "" : " dash"), val || "—")); stats.append(c); }
    const sr = `${v.name}, ${dayText(r.date, now)}, ${Number(r.odometer).toLocaleString()} miles, ${gal} gallons${tot ? ", " + tot : ""}. ${trip ? "Trip " + row.trip.toLocaleString() + " miles" : "No trip"}. ${mpg ? mpg + " miles per gallon" : "No MPG"}${row.trip != null && !row.kept ? ", left out of lifetime MPG" : ""}.`;
    const vis = el("div", "fvis"); vis.setAttribute("aria-hidden", "true"); vis.append(l1, l2, stats);
    item.append(vh(sr), vis);
    if (blocked) { const b = el("p", "blockedmsg"); b.append(ico("alert"), el("b", null, "This is the record that blocked your entry.")); item.append(b); } // #13
    item.append(armedButton("Delete", "Tap again to delete", () => deleteRecords(v, { fillups: [r.id] }),
      { name: `fill-up ${v.name}, ${dayText(r.date, now)}, ${Number(r.odometer).toLocaleString()} miles`, said: "Fill-up deleted.", heading: "recH" })); // every row: a mistyped fill-up must be removable
    list.append(item);
  });
  if (shown < all.length) list.append(moreBox(shown, all.length, "fill-ups", () => {
    const before = shown; lg.fills = shown + Math.min(LOG_STEP, all.length - shown); renderList();
    liveSay(`Showing ${Math.min(lg.fills, all.length)} of ${all.length} fill-ups.`);
    (list.querySelectorAll(".fu")[before] || list.querySelector(".more .btn2"))?.focus();
  }));
}
function renderServices() {
  const box = $("svcList"), now = today(); box.replaceChildren();
  const visits = new Map();
  for (const s of S.logs) { const v = thingById(s.thingId); if (!v || v.jar !== "vehicles") continue; const k = s.thingId + "|" + s.visit; if (!visits.has(k)) visits.set(k, []); visits.get(k).push(s); }
  const groups = [...visits.values()].map((g) => g.sort((a, b) => cmp(String(a.createdAt), String(b.createdAt)) || cmp(a.id, b.id)))
    .sort((a, b) => cmp(b[0].date, a[0].date) || cmp(String(b[0].createdAt), String(a[0].createdAt)) || cmp(b[0].id, a[0].id));
  if (!groups.length) { box.append(el("div", "empty", "Nothing logged yet. The jar's waiting for its first label.")); return; }
  const shown = Math.min(groups.length, lg.svc);
  const badge = (s) => { const b = el("span", s.status === "skipped" ? "badge mut" : "badge ok"); b.append(ico(s.status === "skipped" ? "skip" : "check"), s.status === "skipped" ? "Skipped" : "Done"); return b; };
  groups.slice(0, shown).forEach((g, i) => {
    const s0 = g[0], v = thingById(s0.thingId), row = el("div", "item"); row.tabIndex = -1;
    const names = g.map((s) => s.taskId === "other" ? (s.notes ? `Other: ${s.notes}` : s.taskName || "Other repairs") : s.taskName || s.notes);
    const meter = (s) => s.odometer != null ? mi(s.odometer) : s.hours != null ? `${numText(s.hours)} hr` : "";
    row.append(el("div", "veh", andList(names)));
    const right = el("div", "rt"); if (g.length === 1) { right.append(badge(s0)); if (s0.odometer == null && s0.hours == null) right.append(el("span", "badge mut", "No reading")); } row.append(right);
    row.append(el("div", "meta", [v.name, dayText(s0.date, now), g.length === 1 ? meter(s0) : "", s0.shop].filter(Boolean).join(" · ")));
    // Edit sits beside Delete (#14). A visit of several logs gets one Edit per log and keeps one Delete for the whole visit.
    const editBtn = (s, name) => { const b = btn("edt", "Edit", (ev) => openLogEdit(s.id, { opener: ev.currentTarget })); b.dataset.logId = s.id; b.setAttribute("aria-label", `Edit log, ${name}, ${v.name}, ${dayText(s.date, now)}`); return b; };
    const acts = el("div", "acts");
    if (g.length > 1) for (let k = 0; k < g.length; k++) {
      const line = el("div", "vline"), nm = el("span", null, names[k]); line.append(nm, badge(g[k]));
      if (g[k].odometer == null && g[k].hours == null) line.append(el("span", "badge mut", "No reading")); else line.append(el("span", "num", meter(g[k])));
      line.append(editBtn(g[k], names[k])); row.append(line);
    } else acts.append(editBtn(g[0], names[0]));
    acts.append(armedButton(g.length > 1 ? "Delete visit" : "Delete", "Tap again to delete", () => { setMsg($("svcMsg"), ""); return deleteRecords(v, { logs: g.map((s) => s.id) }); },
      { name: `${andList(names)}, ${v.name}, ${dayText(s0.date, now)}`, said: g.length > 1 ? "Visit deleted." : "Service log deleted.", heading: "svcH" }));
    row.append(acts);
    box.append(row);
  });
  if (shown < groups.length) box.append(moreBox(shown, groups.length, "visits", () => {
    const before = shown; lg.svc = shown + Math.min(LOG_STEP, groups.length - shown); renderServices();
    liveSay(`Showing ${Math.min(lg.svc, groups.length)} of ${groups.length} visits.`);
    ($("svcList").querySelectorAll(".item")[before] || $("svcList").querySelector(".more .btn2"))?.focus();
  }));
}
function renderJarCard() { // the last card: the Vehicles jar page, with its attention line and red dot
  const n = JarPage.boxesFor(Due.pantryTasks({ things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups, hiddenJars: S.hiddenJars }, today()), "vehicles").attn, mt = $("logJarMt");
  mt.replaceChildren(); if (n) { const d = el("i", "rd"); d.setAttribute("aria-hidden", "true"); mt.append(d); }
  mt.append(JarPage.attnText(n));
}

// Nudges: back up now and then; on iPhone, use it from the Home Screen
function backupDueText(due) {
  return due.never
    ? "You haven't exported a backup yet. Your records are only on this device, so if it's lost or the browser clears its data, they're gone."
    : `It's been ${due.days} days since your last backup, and you've added records since. Your data lives only on this device.`;
}
function renderNudges() {
  const due = backupDue();
  const snoozed = pref.get("nudgeSnooze", "") > today();
  $("backupNudge").hidden = !due || snoozed;
  if (due) $("backupNudgeText").textContent = backupDueText(due);
  $("iosNudge").hidden = !(isIOS && !isStandalone() && vehicleThings().length && pref.get("iosNudgeHidden") !== "1");
}
$("nudgeLater").addEventListener("click", () => {
  const d = new Date(); d.setDate(d.getDate() + 7);
  pref.set("nudgeSnooze", isoDate(d)); renderNudges(); $("logTitle").focus(); liveSay("Backup reminder snoozed for 7 days.");
});
$("nudgeExport").addEventListener("click", () => doExport($("status")));
$("iosNudgeLater").addEventListener("click", () => { pref.set("iosNudgeHidden", "1"); renderNudges(); $("logTitle").focus(); liveSay("Reminder hidden."); });

// ---------- Shops (the Vehicles list is the only one the screens use so far; the card is in jar-screen.js) ----------
const shopChange = (list) => ({ settings: { shops: { ...S.shops, vehicles: list } } });
const shopNameError = (raw, except = -1) => JarPage.shopNameCheck(raw, S.shops.vehicles, except, cleanText).error;
$("logAddVehicle").addEventListener("click", (ev) => openSetup({ jar: "vehicles", opener: ev.currentTarget }));

// ---------- Settings screen: tabs, Light / Dark / System, color palette, jars ----------
// Theme and palette are saved on this device as pickle-it:theme and pickle-it:palette. The <head> script applies them before the page draws.
// Roving tabindex for a tablist or radiogroup: Arrow keys move focus and choose, Home and End jump to the first and last.
function roving(group, sel, choose) {
  group.addEventListener("keydown", (ev) => {
    const items = [...group.querySelectorAll(sel)], i = items.indexOf(document.activeElement), k = ev.key;
    if (i < 0) return;
    const step = k === "ArrowRight" || k === "ArrowDown" ? 1 : k === "ArrowLeft" || k === "ArrowUp" ? -1 : 0;
    const n = step ? (i + step + items.length) % items.length : k === "Home" ? 0 : k === "End" ? items.length - 1 : -1;
    if (n < 0) return;
    ev.preventDefault(); items[n].focus(); choose(items[n]);
  });
}
function showSettingsTab(which) {
  const app = which === "app";
  for (const [name, on] of [["Assets", !app], ["App", app]]) {
    const t = $("tab" + name); t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
    $("panel" + name).hidden = !on;
  }
}
function applyAppearance() {
  const root = document.documentElement, mode = normTheme(pref.get("theme")), pal = normPalette(pref.get("palette"));
  if (mode !== "system") root.dataset.theme = mode; else delete root.dataset.theme;
  if (pal !== "green") root.dataset.palette = pal; else delete root.dataset.palette;
  for (const b of document.querySelectorAll("#modePick [data-mode]")) { const on = b.dataset.mode === mode; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
  for (const b of document.querySelectorAll("#palettePick [data-pal]")) { const on = b.dataset.pal === pal; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
  // Match the phone's status bar / browser toolbar to the page background.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", bg);
}
const setTheme = (v) => { pref.set("theme", normTheme(v)); applyAppearance(); };
const setPalette = (v) => { pref.set("palette", normPalette(v)); applyAppearance(); };
(function setupSettings() {
  for (const [k, n] of PALETTES) {
    const b = el("button", "sw"), dot = el("i"); b.type = "button"; b.setAttribute("role", "radio"); b.dataset.pal = k; dot.dataset.p = k;
    dot.append(ico("check")); b.append(dot, n); $("palettePick").append(b);
  }
  $("modePick").addEventListener("click", (ev) => { const b = ev.target.closest("[data-mode]"); if (b) setTheme(b.dataset.mode); });
  $("palettePick").addEventListener("click", (ev) => { const b = ev.target.closest("[data-pal]"); if (b) setPalette(b.dataset.pal); });
  roving($("modePick"), "[data-mode]", (b) => setTheme(b.dataset.mode));
  roving($("palettePick"), "[data-pal]", (b) => setPalette(b.dataset.pal));
  const pickTab = (b) => { const w = b.id === "tabApp" ? "app" : "assets"; pref.set("settingsTab", w); showSettingsTab(w); };
  $("setTabs").addEventListener("click", (ev) => { const b = ev.target.closest('[role="tab"]'); if (b) pickTab(b); });
  roving($("setTabs"), '[role="tab"]', pickTab);
  for (const [jar, name] of JARS) {
    const row = el("div", "toggle"), b = el("button"), st = el("span", "state");
    b.type = "button"; b.setAttribute("role", "switch"); b.dataset.jar = jar; st.setAttribute("aria-hidden", "true");
    b.append(el("span", "nm", name), st, el("span", "sw-ui")); row.append(b); $("jarSwitches").append(row);
  }
  $("jarSwitches").addEventListener("click", (ev) => { const b = ev.target.closest("[data-jar]"); if (b) toggleJar(b.dataset.jar); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyAppearance);
  $("appVersion").textContent = APP_VERSION;
  applyAppearance();
  setupAssets();
  setupAddFlow();
})();

// Show or hide a jar (spec 4.10 AC 7). The list is the settings key hiddenJars; it isn't exported, so it doesn't count as a change to back up.
function renderJars() {
  for (const b of document.querySelectorAll("#jarSwitches [data-jar]")) {
    const shown = !S.hiddenJars.includes(b.dataset.jar);
    b.setAttribute("aria-checked", String(shown)); b.querySelector(".state").textContent = shown ? "Shown" : "Hidden";
  }
}
function jarAttn(jar) { // tasks in the jar that are Overdue or Due this week
  const v = Due.pantryBoxes(Due.pantryTasks({ things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups }, today()));
  return [...v.boxes.overdue, ...v.boxes["due-this-week"]].filter((r) => r.jar === jar).length;
}
async function toggleJar(jar) {
  const st = $("jarStatus"), name = jarLabel(jar), show = S.hiddenJars.includes(jar);
  const next = withJarShown(S.hiddenJars, jar, show);
  if (!next) return setMsg(st, "At least one jar must stay shown.", "err");
  if (!show) {
    const n = jarAttn(jar);
    if (n && !(await askDialog({ title: `Hide ${name}?`, body: `${plural(n, "task")} due this week in ${name} will leave your Pantry. Your data is kept.`, ok: "Hide Jar" }))) return;
  }
  try { await commit({ settings: { hiddenJars: next } }, { touch: false }); setMsg(st, show ? `${name} is back on the tab bar.` : `${name} is hidden. Its data is kept.`); }
  catch (e) { setMsg(st, saveErrorText(e), "err"); }
}

// ---------- Settings screen: backup ----------
function renderBackup() {
  if (S.lastExport) {
    const d = isoDate(new Date(S.lastExport));
    $("lastExp").textContent = `Last exported: ${longDate(d)} (${agoText(daysAgo(d))})`;
  } else $("lastExp").textContent = "Last exported: never";
  const due = backupDue();
  $("expReminder").hidden = !due;
  if (due) $("expReminder").textContent = backupDueText(due);
  $("expCounts").textContent = `On this device: ${countsText({ ...deviceCounts(), shops: 0 }) || "nothing yet"}.`;
  $("exportBtn").disabled = !S.things.length && !shopCount(S.shops);
  $("expHow").textContent = isIOS ? "Opens the share sheet so you can AirDrop it, email it to yourself or save it to Files."
    : isAndroid ? "Opens the share sheet so you can email it to yourself or save it to Drive or Files."
    : `Saves ${exportFileName()} to your Downloads folder. It opens in Excel.`;
  renderStorage();
  renderInstall();
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = el("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function markExported() {
  await save({ settings: { lastExport: nowISO() } }, { touch: false });
  bc?.postMessage("changed");
  renderAll();
}
// Build the file right away (no waiting), so the share sheet still counts as a response to the tap.
async function doExport(statusNode) {
  if (!S.things.length && !shopCount(S.shops)) return setMsg(statusNode, "Nothing to export yet.", "err");
  const name = exportFileName();
  const blob = new Blob(["\ufeff" + buildCSV()], { type: "text/csv;charset=utf-8" }); // the BOM tells Excel it's UTF-8
  if (isMobile && navigator.share && navigator.canShare) {
    const file = new File([blob], name, { type: "text/csv" });
    let can = false;
    try { can = navigator.canShare({ files: [file] }); } catch {}
    if (can) {
      try {
        await navigator.share({ files: [file], title: name });
        await markExported();
        return setMsg(statusNode, `Exported ${name}.`, "ok");
      } catch (e) {
        if (e && e.name === "AbortError") return setMsg(statusNode, "Export cancelled.");
        // Sharing failed for another reason: fall back to a download.
      }
    }
  }
  downloadBlob(blob, name);
  await markExported();
  setMsg(statusNode, `Exported ${name}.${isMobile ? "" : " It's in your Downloads folder."}`, "ok");
}
$("exportBtn").addEventListener("click", () => doExport($("expStatus")));

// Import: pick a file, check it, preview, then Merge or Replace
let pendingImport = null; // { name, an }
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  setMsg($("impStatus"), "");
  pendingImport = null;
  if (file.size > 20 * 1024 * 1024) { setMsg($("impStatus"), `This file is too big (${(file.size / 1048576).toFixed(0)} MB) to be a backup from this app.`, "err"); renderImportPreview(); return; }
  let text;
  try { text = await readTextFile(file); } catch { setMsg($("impStatus"), "Couldn't read that file. Try choosing it again.", "err"); renderImportPreview(); return; }
  pendingImport = { name: file.name, an: analyzeImport(text) };
  renderImportPreview();
  // One announcement each: a usable preview is announced by #impStatus; a fatal message is announced by its own role="alert" paragraph in the preview (so it is not also in #impStatus).
  if (!pendingImport.an.fatal) setMsg($("impStatus"), `Preview of ${file.name} is ready below. Choose Merge, Replace or Cancel.`);
  $("impPreview").scrollIntoView({ block: "nearest", behavior: smooth() });
});
const clearImport = () => { pendingImport = null; renderImportPreview(); };
// "3 things, 7 tasks and 2 shops": c has any of things, tasks, fillups, logs, readings, shops (counts).
function countsText(c) {
  return andList([c.things && plural(c.things, "thing"), c.tasks && plural(c.tasks, "task"), c.fillups && plural(c.fillups, "fill-up"),
    c.logs && plural(c.logs, "log"), c.readings && plural(c.readings, "reading"), c.shops && plural(c.shops, "shop")]);
}
const deviceCounts = () => ({ things: S.things.length, tasks: S.things.reduce((n, v) => n + v.tasks.length, 0), fillups: S.fillups.length, logs: S.logs.length, readings: S.readings.length });
const jarLabel = (j) => JARS.find(([k]) => k === j)?.[1] ?? j;
const listShort = (xs, n = 10) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
function renderImportPreview() {
  const box = $("impPreview");
  box.replaceChildren();
  box.hidden = !pendingImport;
  if (!pendingImport) return;
  const { name, an } = pendingImport;
  const pv = el("div", "pv");
  pv.append(el("h3", null, name));
  if (an.fatal) {
    const fp = el("div"), fm = el("p", "status err", an.fatal); fp.setAttribute("role", "alert"); fp.append(fm); // one alert, so both lines are read together (4.22 AC 1)
    if (an.fatal === "This isn't a Pickle It backup.") fp.append(el("p", "hint", "Pick the .csv file you saved with Export in Pickle It."));
    pv.append(fp);
    pv.append(btn("btn2", "Choose another file", () => { clearImport(); $("importFile").click(); }));
    box.append(pv); return;
  }
  const merge = planImport(an, "merge"), replace = planImport(an, "replace");
  // Usable records only: rows listed as bad below aren't counted. The same text fits every jar.
  const inFile = countsText({ things: an.things.length, ...merge.inFile, shops: shopCount(an.shops) });
  pv.append(el("p", null, `In this file: ${inFile || "no usable records"}.`));

  const dupParts = [merge.dupTasks && plural(merge.dupTasks, "task"), merge.dupFillups && plural(merge.dupFillups, "fill-up"), merge.dupLogs && plural(merge.dupLogs, "log"), merge.dupReadings && plural(merge.dupReadings, "reading")];
  const dups = merge.dupTasks + merge.dupFillups + merge.dupLogs + merge.dupReadings;
  const mAdds = countsText({ things: merge.newThings.length, tasks: merge.tasksAdded, fillups: merge.fillups.length, logs: merge.logs.length, readings: merge.readings.length, shops: merge.shopsAdded });
  const mo = el("div", "opt");
  mo.append(el("strong", null, "Merge"),
    el("span", null, mAdds ? `Adds ${mAdds}. Nothing on this device is removed or overwritten.` : "Adds nothing: everything in this file is already on this device."),
    el("span", "hint", dups ? `Skips ${plural(dups, "duplicate")} (${andList(dupParts)}).` : "No duplicates found."));
  if (merge.thingsMatched) mo.append(el("span", "hint", `${plural(merge.thingsMatched, "thing")} in the file ${merge.thingsMatched === 1 ? "is" : "are"} already on this device; ${merge.thingsMatched === 1 ? "its" : "their"} tasks, logs and readings are added to the existing ${merge.thingsMatched === 1 ? "one" : "ones"}.`));
  if (merge.nameMatches.length) mo.append(el("span", "hint", `Matched by name: ${listShort(merge.nameMatches.map((m) => `${m.name} (${jarLabel(m.jar)})`))}.`));
  const ro = el("div", "opt");
  const here = countsText({ ...deviceCounts(), shops: 0 });
  const rAdds = countsText({ things: replace.newThings.length, tasks: replace.tasksAdded, fillups: replace.fillups.length, logs: replace.logs.length, readings: replace.readings.length, shops: shopCount(replace.shops) });
  ro.append(el("strong", null, "Replace everything"),
    el("span", null, (here ? `Deletes this device's ${here}, then loads ` : "Loads ") + (rAdds || "nothing") + " from the file."));
  const rDups = replace.dupTasks + replace.dupFillups + replace.dupLogs + replace.dupReadings;
  if (rDups) ro.append(el("span", "hint", `Skips ${plural(rDups, "duplicate")} listed twice in the file.`));
  if (replace.badCount > merge.badCount) ro.append(el("span", "hint", `Also skips ${plural(replace.badCount - merge.badCount, "row")} for things that are on this device but not in the file.`));
  pv.append(mo, ro);
  // Names changed because two things in one jar had the same name (in the file, or with a different kind on this device).
  if (merge.renamed.length) {
    const rn = el("div", "alert");
    rn.append(el("strong", null, `${plural(merge.renamed.length, "thing")} renamed because the name was already used in its jar`));
    const ul = el("ul", "badrows");
    for (const r of merge.renamed.slice(0, 10)) ul.append(el("li", null, `${r.from} (${jarLabel(r.jar)}) is now ${r.to}`));
    if (merge.renamed.length > 10) ul.append(el("li", null, `…and ${merge.renamed.length - 10} more.`));
    rn.append(ul);
    pv.append(rn);
  }

  const bad = [...an.bad, ...merge.bad].sort((a, b) => a.line - b.line), badTotal = an.badCount + merge.badCount;
  if (badTotal) {
    const al = el("div", "alert bad");
    al.append(el("strong", null, `${plural(badTotal, "row")} can't be used and will be skipped`));
    const ul = el("ul", "badrows");
    for (const b of bad.slice(0, 50)) { const li = el("li"); li.append(el("b", null, `Line ${b.line}: `), b.msg); ul.append(li); }
    if (badTotal > 50) ul.append(el("li", null, `…and ${badTotal - 50} more.`));
    al.append(ul);
    pv.append(al);
  }
  const btns = el("div", "pv-btns");
  const mb = btn("save", "Merge", () => runImport("merge"));
  mb.disabled = merge.adds === 0;
  const rb = btn("btn2", "Replace everything…", () => runImport("replace"));
  rb.disabled = replace.adds === 0;
  btns.append(mb, rb, btn("link", "Cancel", () => { clearImport(); setMsg($("impStatus"), "Import cancelled. Nothing was saved."); }));
  pv.append(btns);
  box.append(pv);
}
async function runImport(mode) {
  if (!pendingImport) return;
  const { an } = pendingImport;
  if (mode === "replace" && (S.things.length || S.logs.length || S.fillups.length || S.readings.length || shopCount(S.shops))) { // nothing on this device: nothing to lose, so no confirms
    const here = countsText({ ...deviceCounts(), shops: 0 });
    const ok1 = await askDialog({ title: "Replace everything on this device?",
      body: here ? `This deletes the ${here} on this device and loads the file in their place.` : "This loads the file in place of anything on this device.", ok: "Continue" });
    if (!ok1) return;
    const ok2 = await askDialog({ title: "Are you sure?",
      body: "This can't be undone. If you might need what's on this device, cancel and export a backup of it first.", ok: "Delete and replace", danger: true });
    if (!ok2) return;
  }
  const plan = planImport(an, mode); // worked out again in case anything changed since the preview
  for (const b of $("impPreview").querySelectorAll("button")) b.disabled = true;
  try { await applyImport(plan); }
  catch (e) {
    setMsg($("impStatus"), `Couldn't import${e && e.message ? ` (${e.message})` : ""}. Nothing was changed.`, "err");
    renderImportPreview(); return;
  }
  bc?.postMessage("changed");
  pendingImport = null;
  renderAll(); renderImportPreview();
  persistOnce();
  const added = countsText({ things: plan.newThings.length, tasks: plan.tasksAdded, fillups: plan.fillups.length, logs: plan.logs.length, readings: plan.readings.length });
  const dups = plan.dupTasks + plan.dupFillups + plan.dupLogs + plan.dupReadings, bad = an.badCount + plan.badCount;
  const skipped = andList([dups && plural(dups, "duplicate"), bad && plural(bad, "bad row")]);
  const st = $("impStatus");
  setMsg(st, `${mode === "replace" ? "Replaced. Loaded" : "Merged. Added"} ${added || "nothing new"}.${skipped ? ` Skipped ${skipped}.` : ""} `, "ok");
  const hid = JARS.filter(([j]) => S.hiddenJars.includes(j) && plan.newThings.some((t) => t.jar === j)).map(([, n]) => n);
  if (hid.length) st.append(`${andList(hid)} ${hid.length > 1 ? "are" : "is"} hidden, so ${hid.length > 1 ? "those jars' things" : "these"} won't show until you show ${hid.length > 1 ? "them" : "it"} in App Settings. `);
  const go = el("a", null, "Go to Log"); go.href = "#log";
  st.append(go);
}

// Storage and install
function renderStorage() {
  const t = $("storageText");
  if (persistState === true) t.textContent = "This browser has agreed to keep this app's data, so it won't be cleared to free up space. Clearing the browser's website data would still delete it, and it's only on this device, so keep exporting backups.";
  else if (isIOS && !isStandalone()) t.textContent = "You're using this in a Safari tab. Safari can clear data for websites you haven't opened in a while. Add it to your Home Screen (see below) and use it from there.";
  else if (persistState === false) t.textContent = "This browser hasn't promised to keep this app's data, so it could clear it if the device runs low on space. Installing the app (below) usually helps. Either way, export a backup now and then.";
  else t.textContent = "Your data is stored in this browser. Clearing the browser's history or website data deletes it, so keep a backup.";
}
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { installEvt = e; renderInstall(); });
window.addEventListener("appinstalled", () => { installEvt = null; renderInstall(); persistOnce(); });
$("installBtn").addEventListener("click", async () => {
  if (!installEvt) return;
  try { await installEvt.prompt(); await installEvt.userChoice; } catch {}
  installEvt = null; renderInstall();
});
function renderInstall() {
  $("installBtn").hidden = !installEvt || isStandalone();
  $("installLead").textContent = isStandalone() ? "You're using the installed app. To put it on another device, open the same link there and follow the steps below."
    : "Installing gives it its own icon, opens it full screen and lets it work offline.";
}

// ---------- Delete All Data (spec 4.10 AC 12; privacy review 2026-11-05 M1) ----------
// Step 1 says what goes and offers an export; step 2 asks for DELETE. On confirm: this tab lets go of the database and deletes it by name,
// and only after that succeeds are the pickle-it: localStorage keys removed. Other tabs are told to reload. Nothing is claimed before the delete finishes.
let deleting = false, delBlocked = false;
const setDelBusy = (busy) => { for (const id of ["delGo", "delCancel2", "delWord"]) $(id).disabled = busy; };
function stopWaiting() { location.reload(); } // the marker stays: boot reports what happened to the delete (see finishWipe)
function delStep(n) {
  $("delStep1").hidden = n !== 1; $("delStep2").hidden = n !== 2;
  $("delBar2").className = n === 2 ? "on" : "";
  $("delDialog").setAttribute("aria-labelledby", n === 1 ? "delDlgTitle" : "delDlgTitle2");
}
function renderDelBackup() {
  const d = S.lastExport ? daysAgo(isoDate(new Date(S.lastExport))) : null;
  const tail = " so you can bring this back if you change your mind.";
  $("delBackup").textContent = d === null ? `You haven't exported a backup. Export one now${tail}`
    : S.lastChange && S.lastChange > S.lastExport ? `Your last backup was ${agoText(d)}, and you've changed things since. Export a new one now${tail}`
    : `Your last backup was ${agoText(d)}. It's saved wherever you put it.`;
}
$("delBtn").addEventListener("click", () => {
  const c = deviceCounts(), li = [];
  if (c.things) li.push(`${plural(c.things, "thing")} and ${plural(c.tasks, "task")}`);
  if (c.logs) li.push(plural(c.logs, "done-history entry", "done-history entries"));
  if (c.fillups || c.readings) li.push(andList([c.fillups && plural(c.fillups, "fill-up"), c.readings && plural(c.readings, "reading")]));
  if (shopCount(S.shops)) li.push(plural(shopCount(S.shops), "shop"));
  li.push("Your settings: theme and color palette (back to System and Green), hidden jars and what you've collapsed");
  $("delList").replaceChildren(...li.map((t) => el("li", null, t)));
  renderDelBackup(); delStep(1);
  $("delWord").value = ""; $("delGo").disabled = true; setMsg($("delExpStatus"), ""); setMsg($("delStatus"), "");
  $("delCancel2").textContent = "Cancel"; delBlocked = false;
  $("delDialog").showModal();
  $("delCancel1").focus(); // focus starts on the safe choice
});
$("delCancel1").addEventListener("click", () => $("delDialog").close());
$("delCancel2").addEventListener("click", () => (delBlocked ? stopWaiting() : $("delDialog").close()));
// Once the delete is running it can't be called off, but while it only waits for another tab, Esc and Cancel stop the waiting.
$("delDialog").addEventListener("cancel", (ev) => { if (deleting) { ev.preventDefault(); if (delBlocked) stopWaiting(); } });
$("delExport").addEventListener("click", async () => {
  const b = $("delExport"); b.disabled = true;
  try { await doExport($("delExpStatus")); } finally { b.disabled = false; renderDelBackup(); }
});
$("delContinue").addEventListener("click", () => { delStep(2); $("delWord").focus(); });
const delWordOk = () => $("delWord").value.trim().toLowerCase() === "delete";
$("delWord").addEventListener("input", () => { $("delGo").disabled = !delWordOk(); });
$("delWord").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); if (delWordOk()) $("delGo").click(); } });
$("delGo").addEventListener("click", async () => {
  if (deleting || !delWordOk()) return;
  deleting = true;
  try { localStorage.setItem(WIPE_KEY, "1"); } catch {} // so a reload while blocked can finish the cleanup
  setDelBusy(true);
  setMsg($("delStatus"), "Deleting…");
  $("delStatus").tabIndex = -1; $("delStatus").focus(); // keep focus in the dialog, not on the body (the status must have text first, or it isn't focusable)
  try {
    await deleteDB(() => {
      delBlocked = true; $("delCancel2").textContent = "Stop Waiting"; $("delCancel2").disabled = false; $("delCancel2").focus();
      setMsg($("delStatus"), "Close other Pickle It tabs to finish deleting. It will finish by itself. If you stop waiting, the delete may still finish when the other tab closes.");
    });
  } catch (e) {
    // The delete failed, so nothing was removed: say so, take the connection back, and offer a retry.
    deleting = false; delBlocked = false;
    try { localStorage.removeItem(WIPE_KEY); } catch {}
    setDelBusy(false); $("delCancel2").textContent = "Cancel";
    setMsg($("delStatus"), "Couldn't delete your data. Nothing was removed. Try again.", "err");
    $("delWord").focus();
    try { await openDB(); watchVersion(); await reload(); renderAll(); } catch { showFatal("Pickle It lost its connection to your data. Nothing was deleted.", "Reload", () => location.reload()); }
    return;
  }
  try { wipePrefs(localStorage); } catch {} // only after the database is gone
  bc?.postMessage("wiped");
  history.replaceState({ pickleWiped: 1 }, "", "#pantry"); // survives the reload (no storage): boot then says it and moves focus
  location.reload();
});

// ---------- Start ----------
// A message across the top when the app can't open its data. label + action add one button (Try again, Reload).
// While it shows, the screens behind it are hidden (body.blocked), so nothing there can be used without a database.
function showFatal(text, label, action) {
  const f = $("fatal");
  f.replaceChildren(text);
  const b = label ? btn("link", label, action) : null;
  if (b) f.append(" ", b);
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  document.body.classList.add("blocked");
  f.hidden = false;
  b?.focus();
}
function hideFatal() { $("fatal").hidden = true; document.body.classList.remove("blocked"); }
// Due dates are never stored, so a new day only needs a redraw: re-armed after each fire; visibilitychange covers a sleeping device.
let midnightTimer = null;
function armMidnight() {
  clearTimeout(midnightTimer);
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  midnightTimer = setTimeout(() => { renderAll(); armMidnight(); }, Math.min(next - n + 1000, 2 ** 31 - 1));
}
// Another tab is upgrading or deleting the database: let go of it so that can finish, and ask for a reload.
function watchVersion() {
  idb.onversionchange = (ev) => { idb.close(); showFatal(ev.newVersion === null ? "Your data was deleted in another tab. Reload to start fresh." : "Pickle It was updated in another tab. Reload to get the new version.", "Reload", () => location.reload()); };
}
async function boot() {
  let wipeMarked = false;
  try { wipeMarked = !!localStorage.getItem(WIPE_KEY); } catch {}
  if (wipeMarked) showFatal("Finishing the delete you started. If other Pickle It tabs are open, close them. It will finish by itself."); // the open below waits behind a pending delete
  try { await openDB(() => showFatal("Close other Pickle It tabs to finish updating. It will finish by itself.")); await reload(); }
  catch (e) {
    if (e?.name === "VersionError") showFatal("This device has data from a newer version of Pickle It. Close the app fully and open it again to get that version.", "Try again", boot);
    else if (e?.name === "AbortError") showFatal("Pickle It couldn't update. Nothing was changed.", "Try again", boot);
    else showFatal("This browser won't let the app save data here, so it can't run. If you're in a private or incognito window, open it in a normal one.");
    return;
  }
  hideFatal();
  let wipeResult = "none";
  if (wipeMarked) { // a delete was started and this page was reloaded: finish the cleanup, then say what happened
    try { wipeResult = finishWipe(localStorage, !S.things.length && !recordCount() && !shopCount(S.shops)); } catch {}
    if (wipeResult === "finished") { applyAppearance(); history.replaceState(null, "", "#pantry"); }
  }
  // Another tab is upgrading the database: let go of it so the upgrade can finish, and ask for a reload.
  watchVersion();
  const platform = isIOS ? "install-ios" : isAndroid ? "install-android" : /Mac/.test(navigator.platform) ? "install-mac" : /Win/.test(navigator.platform) ? "install-windows" : null;
  if (platform && !isStandalone()) $(platform).open = true;
  renderHelp($("helpBody"));
  renderAll();
  route();
  if (history.state && history.state.pickleWiped) { // after Delete All Data: focus the Pantry or welcome heading and say it
    history.replaceState(null, "", "#pantry");
    const h = document.querySelector(".screen:not([hidden]) h1"); if (h) { h.tabIndex = -1; h.focus(); }
    showToast("Everything was deleted. Pickle It is empty and your theme and palette are back to System and Green.");
  }
  if (wipeResult === "finished") askDialog({ title: "Your Data Was Deleted", body: "Everything was deleted. Pickle It is empty and your theme and palette are back to System and Green.", cancel: null })
    .then(() => { const h = document.querySelector(".screen:not([hidden]) h1"); if (h) { h.tabIndex = -1; h.focus(); } }); // focus to the Pantry or welcome heading, not the page body
  else if (wipeResult === "abandoned") askDialog({ title: "Your Data Is Still Here", body: "The delete you started didn't finish, so nothing was removed. You can start it again in Settings.", cancel: null });
  if (navigator.storage?.persisted) { try { persistState = await navigator.storage.persisted(); } catch {} renderStorage(); }
  if (S.things.length || recordCount()) persistOnce();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });
  armMidnight();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// The bar grows at large text; keep the page's bottom padding the same height as the bar.
if ("ResizeObserver" in self) new ResizeObserver(() => document.documentElement.style.setProperty("--tabbar-h", document.querySelector(".tb-in").offsetHeight + "px")).observe(document.querySelector(".tb-in"));
boot();
