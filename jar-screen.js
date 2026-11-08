"use strict";
/* Pickle It: the jar page (docs/design/jar-page.html JP1-JP19, spec v1-scope 4.21): one page behind the Vehicles, Home, Health and Finance tabs.
   The boxes and rows are the Pantry's own (pantry.js boxEl / pantryRow, filtered to one jar by JarPage.boxesFor); the Things list opens the Assets thing page;
   Vehicles also gets Fill-Ups and History and the Shops card. The rules are in jar-page.js (tested in tests/r2-check.mjs). Nothing here is stored except the shop list
   (settings.shops, saved as you go through shopChange in app.js); the shown row counts and the Shops card state are in memory and start fresh each time the page opens.
   Loaded after setup-screen.js and before app.js, which calls resetJarPage() and renderJar() and defines $, el, btn, commit, shopChange. */

const jp = { jar: null, limits: {}, thingsLimit: JarPage.FIRST, shops: null };
// Shops card state (AC 8): open/edit, the add row's text and error, per-row errors, the "Removed ..." line, a write failure, and the save in flight.
const freshShops = () => ({ open: false, edit: false, newVal: "", err: "", rowErr: {}, status: "", fail: "", inflight: null, typed: null }); // typed: { i, v } a rename that failed to write, so its field keeps the text
function resetJarPage(jar) { Object.assign(jp, { jar, limits: {}, thingsLimit: JarPage.FIRST, shops: freshShops() }); } // every arrival starts fresh (4.21 AC 8a)

// A thing's page in Settings > Assets (4.21 AC 5); Back from there returns to the Assets list.
function openJarThing(id) {
  pref.set("settingsTab", "assets"); asS.detail = id; asS.task = null; rdReset(); pendingThing = true;
  if (location.hash === "#settings") route(); else location.hash = "#settings";
}

function jarThingRow(t) {
  const m = JarPage.thingMeta(t), a = el("a", "arow"); a.href = "#settings"; a.dataset.row = t.id;
  const av = el("span", "av"); av.append(ico(rowIcon(t)));
  const mt = el("span", "mt"); mt.append(m.count);
  if (m.soonest) {
    const v = asDue(m.soonest);
    mt.append(" · ", el("b", v.over ? "over" : "", v.over ? "Overdue: " + m.soonest.task : v.ask ? m.soonest.task : `${m.soonest.task} ${v.parts.join(" ")}`));
  } else if (m.allPaused) mt.append(" · all paused");
  const ch = el("span", "ch"); ch.append(ico("chevr"));
  a.append(av, el("span", "nm", t.name), ch, mt);
  a.addEventListener("click", (ev) => { ev.preventDefault(); openJarThing(t.id); });
  return a;
}
function renderJarThings(model) {
  const box = $("jarThings"), tl = JarPage.thingsFor(model, jp.jar, jp.thingsLimit), at = document.activeElement;
  const keep = box.contains(at) ? at.dataset.row || at.dataset.fk : null;
  const h = el("h2", null, `Things · ${tl.total}`); h.id = "jarThingsH";
  const list = el("div", "list"); for (const t of tl.shown) list.append(jarThingRow(t));
  box.replaceChildren(h, list);
  if (tl.footer) {
    const f = tl.footer, c = el("div", "cap"), b = btn("btn2 small", `Show ${f.more} More`, () => {
      const before = jp.thingsLimit; jp.thingsLimit += f.more; renderJar();
      liveSay(`Showing ${Math.min(jp.thingsLimit, f.of)} of ${f.of} things.`);
      const rows = $("jarThings").querySelectorAll("[data-row]"); (rows[before] || rows[rows.length - 1])?.focus();
    });
    b.dataset.fk = "thmore"; b.append(vh(" things")); c.append(el("p", "hint", `Showing ${f.shown} of ${f.of} things.`), b); box.append(c);
  }
  if (keep) [...box.querySelectorAll("[data-row],[data-fk]")].find((e) => (e.dataset.row || e.dataset.fk) === keep)?.focus({ preventScroll: true });
}
function jarMore(id, f) { // "Show N More" on a box: the next rows appear in place, focus goes to the first new one
  const before = jp.limits[id] || JarPage.FIRST; jp.limits[id] = before + f.more; renderJar();
  liveSay(`Showing ${Math.min(jp.limits[id], f.of)} of ${f.of} tasks.`);
  const rows = $("jarBoxes").querySelector(`details[data-box="${id}"]`).querySelectorAll(".drb"); (rows[before] || rows[rows.length - 1])?.focus();
}

function renderJar() {
  if ($("screen-jar").hidden || !jp.jar) return;
  const jar = jp.jar;
  if (S.hiddenJars.includes(jar)) { focusHeading = true; history.replaceState(null, "", "#pantry"); route(); liveSay(`${JarPage.NAME[jar]} was hidden, so you're back at the Pantry.`); return; } // the jar was hidden while its page was open (another tab): say so, focus on the Pantry heading (QA R2 finding 6)
  $("jpTitle").textContent = JarPage.NAME[jar];
  const empty = !S.things.some((t) => t.jar === jar);
  $("jarEmpty").hidden = !empty; $("jarMain").hidden = empty; $("jarSub").hidden = empty;
  if (empty) { jarEmptyCard(jar, $("jarEmpty")); return; } // J11: a shown jar with nothing in it
  delete $("jarEmpty").dataset.jar;
  const data = { things: S.things, logs: S.logs, readings: S.readings, fillups: S.fillups, hiddenJars: S.hiddenJars }, now = today();
  const page = JarPage.boxesFor(Due.pantryTasks(data, now), jar);
  $("jarSub").textContent = JarPage.attnText(page.attn);
  const opts = { ns: "j", onMore: jarMore, quiet: JarPage.wittyShown(page), quietLine: JarPage.wittyLine(jar, now, CANNING_LINES) };
  redrawKeeping($("jarBoxes"), () => {
    const boxes = el("div", "boxes");
    for (const [id, title, open] of BOX_DEFS) boxes.append(boxEl(id, title, open, page.boxes[id], { attn: page.attn }, { ...opts, limit: jp.limits[id] || JarPage.FIRST }));
    $("jarBoxes").append(boxes);
  });
  renderJarThings(Assets.buildModel(data, now));
  $("jarVeh").hidden = jar !== "vehicles";
  if (jar === "vehicles") renderShops();
  $("jarAdd").replaceChildren(ico("plus"), JarPage.ADD_LABEL[jar]);
}

// ---------- Shops card (Vehicles only; AC 8a-8i) ----------
// Closed title row on every open; Edit shows the view state's list as fields with X buttons and an Add row, and Edit becomes Save. Every add, rename and remove is written at once
// through shopChange (one commit each); Save only leaves edit mode. Focus keys (data-fk): tg, ed, n:<row>, x:<row>, new, add.
const shopsList = () => S.shops.vehicles;
const CUT_MSG = "That name was longer than 80 characters, so it was cut to 80.";
function renderShops(o = {}) {
  const box = $("jarShops"), u = jp.shops, at = document.activeElement;
  if (!o.force && u.edit && box.contains(at) && at.matches("input")) return; // someone is typing: a redraw from another tab must not take it away
  const keep = o.focus || (box.contains(at) ? at.dataset.fk : null), list = shopsList(), n = list.length;
  const head = el("div", "shh"), h2 = el("h2", "shT"); h2.id = "jarShopsT";
  const tg = btn("tg", "", () => { // opening or closing is not saved; closing while editing ends edit mode (nothing is lost: every change was already saved)
    u.open = !u.open; if (!u.open) Object.assign(u, { edit: false, err: "", rowErr: {}, status: "", fail: "", typed: null }); // a name typed in the Add row stays there (QA R2 finding 8a)
    renderShops({ force: true, focus: "tg" });
  });
  tg.dataset.fk = "tg"; tg.setAttribute("aria-expanded", String(u.open)); tg.setAttribute("aria-controls", "jarShopsBody"); tg.setAttribute("aria-label", `Shops, ${n} ${n === 1 ? "shop" : "shops"}`);
  tg.append(el("span", null, "Shops"), el("span", "cnt", String(n)), ico("chevd", "ic chev")); h2.append(tg); head.append(h2);
  if (u.open) {
    const ed = btn("btn2 small ed" + (u.edit ? " pri2" : ""), u.edit ? "Save" : "Edit", u.edit ? saveShops : startShopEdit);
    ed.dataset.fk = "ed"; ed.setAttribute("aria-label", u.edit ? "Save Shops" : "Edit Shops"); head.append(ed);
  }
  const body = el("div", "shbody"); body.id = "jarShopsBody"; body.hidden = !u.open;
  if (!n) body.append(el("p", "hint", "No shops yet."));
  else if (!u.edit) { const ul = el("ul", "shl"); for (const s of list) ul.append(el("li", null, s)); body.append(ul); }
  else {
    const ul = el("ul", "shops");
    list.forEach((name, i) => {
      const li = el("li"), inp = el("input"), rm = btn("xbtn", "×", () => removeShop(i));
      Object.assign(inp, { type: "text", value: u.typed && u.typed.i === i ? u.typed.v : name }); inp.setAttribute("aria-label", "Shop name"); inp.dataset.fk = "n:" + i; inp.autocomplete = "off";
      rm.setAttribute("aria-label", "Remove " + name); rm.dataset.fk = "x:" + i;
      inp.addEventListener("change", () => renameShop(i, inp)); inp.addEventListener("input", () => { delete u.rowErr[i]; if (u.typed && u.typed.i === i) u.typed.v = inp.value; clearShopErr(inp); });
      li.append(inp, rm);
      if (u.rowErr[i]) shopErr(li, inp, u.rowErr[i], "jarShopE" + i);
      ul.append(li);
    });
    body.append(ul);
  }
  if (u.edit) {
    const row = el("div", "addrow"), inp = el("input"), add = btn("go", "Add", () => addShop());
    Object.assign(inp, { type: "text", value: u.newVal, placeholder: "e.g. DIY, Main St. Auto", autocomplete: "off" }); inp.setAttribute("aria-label", "New shop name"); inp.dataset.fk = "new";
    inp.addEventListener("input", () => { u.newVal = inp.value; u.err = ""; clearShopErr(inp); });
    inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addShop(); } });
    add.dataset.fk = "add"; add.append(vh(" Shop")); row.append(inp, add); body.append(row);
    if (u.err) shopErr(body, inp, u.err, "jarShopENew");
  }
  if (u.status) body.append(el("p", "shstat", u.status));
  if (u.fail) { const f = el("p", "status err", u.fail); f.setAttribute("role", "alert"); body.append(f); }
  box.replaceChildren(head, body);
  if (keep) [...box.querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === keep)?.focus({ preventScroll: !o.focus });
}
// An error is an icon plus words under its row, a 2 px border and aria-invalid on the field (not colour alone).
function shopErr(into, inp, msg, id) {
  const p = el("p", "ferr"); p.id = id; p.setAttribute("role", "alert"); p.append(ico("alert"), msg);
  inp.classList.add("inerr"); inp.setAttribute("aria-invalid", "true"); inp.setAttribute("aria-describedby", id); into.append(p);
}
function clearShopErr(inp) {
  inp.classList.remove("inerr"); inp.removeAttribute("aria-invalid"); inp.removeAttribute("aria-describedby");
  const e = inp.parentNode.querySelector(".ferr"); if (e) e.remove();
}
function startShopEdit() {
  const u = jp.shops, list = shopsList();
  Object.assign(u, { edit: true, status: "", fail: "", err: "", rowErr: {}, typed: null });
  list.forEach((s, i) => { const e = JarPage.shopNameCheck(s, list, i, cleanText).error; if (e) u.rowErr[i] = e; }); // names that were already duplicates (an imported backup) show the error until fixed
  renderShops({ force: true, focus: list.length ? "n:0" : "new" });
}
async function addShop() { // true when the shop was added (or nothing was typed)
  const u = jp.shops, c = JarPage.shopNameCheck(u.newVal, shopsList(), -1, cleanText);
  if (c.error) { u.err = c.error; renderShops({ force: true, focus: "new" }); return false; }
  u.status = ""; u.fail = "";
  try { await (u.inflight = commit(shopChange([...shopsList(), c.name]))); }
  catch (e) { u.fail = saveErrorText(e); renderShops({ force: true, focus: "new" }); return false; } // the field keeps what was typed
  Object.assign(u, { newVal: "", err: "", typed: null, status: c.cut ? CUT_MSG : "" }); renderShops({ force: true, focus: "new" }); liveSay(c.cut ? `${c.name} added. ${CUT_MSG}` : `${c.name} added`);
  return true;
}
async function renameShop(i, inp) {
  const u = jp.shops, list = shopsList(); if (i >= list.length) return;
  const c = JarPage.shopNameCheck(inp.value, list, i, cleanText);
  if (c.error) { u.rowErr[i] = c.error; u.typed = { i, v: inp.value }; renderShops({ force: true, focus: "n:" + i }); return; } // not written; the field keeps the typed text (the stored name is unchanged) and focus (AC 8i)
  delete u.rowErr[i]; u.typed = null;
  if (c.name === list[i]) { inp.value = c.name; clearShopErr(inp); return; }
  const next = [...list]; next[i] = c.name; u.status = ""; u.fail = "";
  u.status = c.cut ? CUT_MSG : "";
  try { await (u.inflight = commit(shopChange(next))); } catch (e) { u.fail = saveErrorText(e); u.status = ""; u.typed = { i, v: inp.value }; renderShops({ force: true, focus: "n:" + i }); return; } // the field keeps what was typed and focus (AC 8i)
  renderShops({ force: true, focus: "n:" + i }); if (c.cut) liveSay(CUT_MSG);
}
async function removeShop(i) {
  const u = jp.shops, list = shopsList(), name = list[i]; if (name === undefined) return;
  try { await (u.inflight = commit(shopChange(list.filter((_, j) => j !== i)))); }
  catch (e) { u.fail = saveErrorText(e); renderShops({ force: true, focus: "x:" + i }); return; }
  const left = shopsList().length;
  Object.assign(u, { rowErr: {}, err: "", fail: "", typed: null, status: `Removed ${name}. Maintenance already logged there keeps the name.` });
  renderShops({ force: true, focus: left > i ? "n:" + i : left ? "n:" + (left - 1) : "new" });
  liveSay(u.status);
}
async function saveShops() { // writes nothing itself: only leaves edit mode (a shop typed in the Add row is added first)
  const u = jp.shops;
  if (u.inflight) await u.inflight.catch(() => {});
  if (u.newVal.trim() !== "" && !(await addShop())) return;
  Object.assign(u, { edit: false, newVal: "", err: "", rowErr: {}, status: "", fail: "", typed: null });
  renderShops({ force: true, focus: "ed" }); liveSay("Shops saved.");
}

document.addEventListener("DOMContentLoaded", function jarEvents() {
  $("jarAdd").addEventListener("click", (ev) => openSetup({ jar: jp.jar, opener: ev.currentTarget })); // setup returns focus to this button
});
