"use strict";
/* Pickle It: the Readings section on a thing's page in Settings > Assets (R1; spec v1-scope 4.19; mockup docs/design/readings-list.html RL1-RL16).
   Draws the rows ReadingsList builds, pages them (50, then Show N More), and runs Delete: one confirm, or two when a meter change was saved with exactly one
   Done entry or fill-up. Every delete is ONE commit() and ONE Undo toast whose Undo is one commit({ put }) of the exact records (readings-list.js deletePlan).
   Loaded after assets-edit.js, which calls renderReadings() from the thing's page and rdReset() (assets-screen.js) when the person enters or leaves it. */

const rdS = { limit: ReadingsList.FIRST, msg: null }; // how many rows show; a message ("gone" | "failed") left by the last delete
const rdReset = () => { rdS.limit = ReadingsList.FIRST; rdS.msg = null; };
const rdRecs = (id) => ({ readings: readingsFor(id), fillups: fillupsFor(id), logs: logsFor(id) });
const rdButtons = () => [...document.querySelectorAll("#asDetail .rr-del")];
// Where focus goes: a row's Delete button, else the Update button, else the page title.
function rdFocus(key) { (rdButtons().find((b) => b.dataset.key === key) || document.querySelector("#asDetail [data-update]") || document.querySelector("#asDetail h1"))?.focus(); }

function renderReadings(th) {
  if (!ReadingsList.hasSection(th)) return null;
  const rows = ReadingsList.buildRows(th, rdRecs(th.id), today()), sec = el("section", "stack-sm"), hd = el("h2", null, `Readings · ${rows.length}`);
  hd.id = "asReadH"; sec.setAttribute("aria-labelledby", "asReadH");
  const sh = el("div", "sechead"); sh.append(hd); sec.append(sh);
  if (rdS.msg) { // already removed (polite) or the write failed (alert)
    const bad = rdS.msg === "failed", m = el("div", "alert rdmsg" + (bad ? " bad" : "")), t = el("div"), b = el("b", null, bad ? "We couldn't delete that reading." : "This reading was already removed.");
    m.setAttribute("role", bad ? "alert" : "status");
    t.append(el("p", null, ""), el("p", null, bad ? "Nothing was removed. Try again." : "Nothing was changed.")); t.firstChild.append(b); m.append(ico(bad ? "alert" : "info"), t); sec.append(m);
  }
  if (!rows.length) {
    const c = el("div", "card pempty");
    c.append(ico("jar", "ic big"), el("p", "lead", "No readings yet."), el("p", "hint", "Use Update above to add one."));
    sec.append(c); return sec;
  }
  const pg = ReadingsList.page(rows, rdS.limit), ul = el("ul", "list"); ul.setAttribute("role", "list");
  for (const r of pg.shown) {
    const li = el("li", "rr"), rt = el("div", "rt"), rl = el("span", "rl"), pill = el("span", "badge " + (r.change ? "wait" : "mut"));
    if (r.change) pill.append(ico("swap"));
    pill.append(r.change ? "Meter change" : "Reading");
    rl.append(el("span", null, r.dateText), vh(", "), pill); // read in this order: date, kind, value, Delete
    rt.append(rl, vh(", "), el("span", "rv", r.text));
    const del = btn("rr-del", "Delete", () => rdDelete(th.id, r.key)); del.dataset.key = r.key; del.setAttribute("aria-label", r.label);
    li.append(rt, del); ul.append(li);
  }
  sec.append(ul);
  if (pg.footer) {
    const f = pg.footer, cap = el("div", "cap"), more = btn("btn2 small", `Show ${f.more} More`, () => rdShowMore(th.id, rows.length));
    more.append(vh(" readings")); cap.append(el("p", "hint", f.text), more); sec.append(cap);
  }
  return sec;
}

function rdShowMore(thingId, total) {
  const was = Math.min(rdS.limit, total);
  rdS.limit = Math.min(total, rdS.limit + ReadingsList.STEP);
  renderAssets();
  const b = rdButtons(); (b[was] || b[b.length - 1])?.focus(); // the first row that was not there before
  liveSay(`Showing ${Math.min(rdS.limit, total)} of ${total} readings.`);
}

// "Already removed" or "failed": a message in the section, the list redrawn, focus on the row (or where it was).
function rdMessage(kind, key) {
  rdS.msg = kind; renderAssets(); rdFocus(key);
  if (kind === "gone") liveSay("This reading was already removed. Nothing was changed.");
}

async function rdDelete(thingId, key) {
  const th = thingById(thingId); if (!th) return;
  const rows = ReadingsList.buildRows(th, rdRecs(thingId), today()), r = rows.find((x) => x.key === key);
  if (!r) return rdMessage("gone", key);
  const recs = rdRecs(thingId), rec = recs.readings.find((x) => x.id === r.id), steps = ReadingsList.dialogs(r, r.change ? ReadingsList.soleCompanion(rec, recs) : null, today()).steps;
  const ask = (s) => askDialog({ title: s.title, body: s.body, ok: s.ok, alt: s.alt, danger: true, outsideCancels: true }); // Cancel is focused first; Escape and a tap outside cancel
  if (!(await ask(steps[0]))) return rdFocus(key);
  let also = false;
  if (steps[1]) { const a = await ask(steps[1]); if (a !== "ok" && a !== "alt") return rdFocus(key); also = a === "ok"; } // Cancel on the second question cancels the whole delete
  // Everything below uses fresh data: another tab may have changed things while a question was open.
  const plan = ReadingsList.deletePlan(rdRecs(thingId), r.kind, r.id, also);
  if (plan.gone) return rdMessage("gone", key);
  const gone = new Set([key, ...(plan.companion && plan.companion.store === "fillups" ? ["f:" + plan.companion.rec.id] : [])]);
  const i = rows.indexOf(r), near = rows.slice(i + 1).find((x) => !gone.has(x.key)) || rows.slice(0, i).reverse().find((x) => !gone.has(x.key));
  rdS.msg = null;
  try { await commit(plan.changes); } catch (e) { rdMessage("failed", key); return; }
  lastFk = "rd:" + key; dismissFk = "rd:" + (near ? near.key : ""); // Undo puts the row back; Dismiss or the timeout goes to the row that took its place
  showToast(ReadingsList.toastText(r, plan.companion ? plan.companion.store : null), plan.undo);
}
