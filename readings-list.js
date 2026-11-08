/* Pickle It: the Readings list on a thing's page (R1; spec v1-scope 4.19; data-layer-plan "4.19-4.22 data specification" A; mockup readings-list.html).
   Pure functions: no storage, no DOM, never reads the clock (today is passed in). Loads in the browser as the global `ReadingsList` (after due.js)
   and in Node via require(). It builds the rows, finds the Done entry or fill-up saved with a meter change (derived, nothing stored), words the
   delete dialogs and toasts, and makes the delete plan with its Undo payload. The screen (assets-readings.js) draws and saves; data.js changeRowsToDrop
   uses companionsOf too. Tested in tests/r1-check.mjs and tests/b9-check.mjs. */
(function (root) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./due.js") : root.Due;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FIRST = 50, STEP = 100; // 4.19 AC 9
  const num = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 });
  // "Nov 1"; the year is added when the date is more than 6 months back (4.2a AC 5).
  const dayText = (iso, today) => { const [y, m, d] = iso.split("-").map(Number); return `${MON[m - 1]} ${d}${iso < D.addUnits(today, -6, "month") ? `, ${y}` : ""}`; };
  const unitOf = (meter) => (meter === "miles" ? "mi" : "hr");
  const spoken = (n, meter) => `${num(n)} ${meter === "miles" ? (n === 1 ? "mile" : "miles") : n === 1 ? "hour" : "hours"}`;

  // Does the thing's page show a Readings section? A vehicle (odometer) or any thing with an hour meter (4.19 AC 1).
  const hasSection = (thing) => thing.jar === "vehicles" || D.hasHourMeter(thing);

  // ---------- the link between a meter change and what was saved with it (derived; data-layer-plan A.2) ----------
  // A record is saved with a change row when it is on the same thing and has the same non-empty createdAt, the same date and the same typed number
  // in the change row's meter field; a log must be a Done (a Skip never carries a new number). recs = { logs, fillups }.
  function companionsOf(change, recs) {
    const field = change.odometer != null ? "odometer" : "hours";
    if (!change.createdAt || change[field] == null) return [];
    const same = (r) => r.thingId === change.thingId && r.createdAt === change.createdAt && r.date === change.date && r[field] === change[field];
    return [
      ...(recs.logs || []).filter((l) => l.status === "done" && same(l)).map((rec) => ({ store: "logs", rec })),
      ...(field === "odometer" ? (recs.fillups || []).filter(same).map((rec) => ({ store: "fillups", rec })) : []),
    ];
  }
  // Exactly one saved-with record is "the" companion (the two-question flow); none or several is none (the single dialog, nothing else deleted).
  const soleCompanion = (change, recs) => { const c = companionsOf(change, recs); return c.length === 1 ? c[0] : null; };

  // ---------- rows ----------
  // recs = { readings, fillups, logs } (any thing's). Newest first by date, then by when it was saved, then id.
  function buildRows(thing, recs, today) {
    const rows = [];
    for (const r of recs.readings || []) {
      if (r.thingId !== thing.id) continue;
      const meter = r.hours != null ? "hours" : "miles", v = r[meter === "hours" ? "hours" : "odometer"], change = r.oldValue != null;
      rows.push(row("reading", r, meter, v, change, change ? r.oldValue : null, today));
    }
    if (thing.jar === "vehicles") for (const f of recs.fillups || []) if (f.thingId === thing.id && f.units == null) rows.push(row("fillup", f, "miles", f.odometer, false, null, today)); // odometer-only: what Add Reading writes
    return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt || "") < (b.createdAt || "") ? 1 : (a.createdAt || "") > (b.createdAt || "") ? -1 : a.id < b.id ? 1 : -1));
  }
  function row(kind, rec, meter, value, change, was, today) {
    const u = unitOf(meter), date = dayText(rec.date, today), val = `${num(value)} ${u}`;
    return { key: (kind === "fillup" ? "f:" : "r:") + rec.id, kind, id: rec.id, meter, change, date: rec.date, dateText: date, createdAt: rec.createdAt || "", value, was,
      valueText: val, text: change ? `was ${num(was)} ${u}, now ${val}` : val,
      label: `Delete ${change ? "meter change" : "reading"}, ${change ? `was ${spoken(was, meter)}, now ${spoken(value, meter)}` : spoken(value, meter)}, ${date}` };
  }
  // The rows to draw: the first `limit` and the footer ("Showing 50 of 250 readings." + "Show 100 More"), or no footer.
  function page(rows, limit) {
    const shown = rows.slice(0, limit), left = rows.length - shown.length;
    return { shown, footer: left > 0 ? { text: `Showing ${shown.length} of ${rows.length} readings.`, more: Math.min(STEP, left) } : null };
  }

  // ---------- the dialogs (4.19 AC 6; copy as in the approved mockup) ----------
  // Returns { steps: [{ title, body: [lines], ok, alt? }] }: one step is a single confirm; two steps is the Continue question and then the three-button question.
  function dialogs(r, companion, today) {
    if (!r.change) return { steps: [{ title: "Delete This Reading?", body: [`${r.valueText} on ${r.dateText}. Due dates will be worked out again.`], ok: "Delete Reading" }] };
    const lines = ["Older readings stop being adjusted, so due dates may change.", `The reading you typed with it, ${r.valueText} on ${r.dateText}, is deleted too.`];
    if (!companion) return { steps: [{ title: "Delete This Meter Change?", body: lines, ok: "Delete Meter Change" }] };
    const fill = companion.store === "fillups", rec = companion.rec, when = dayText(rec.date, today);
    return { steps: [
      { title: "Delete This Meter Change?", body: [...lines, `The ${fill ? "fill-up" : "Done entry"} saved with it stays unless you choose otherwise next.`], ok: "Continue" },
      { title: fill ? "Also Delete the Fill-Up?" : "Also Delete the Done Entry?",
        body: [fill ? `A fill-up on ${when}${rec.units != null ? ` (${num(rec.units)} gal)` : ""} was saved with this meter change.` : `${rec.taskName} was marked Done on ${when} when this meter change was saved.`, "You can keep it."],
        ok: "Delete Both", alt: "Delete Change Only" },
    ] };
  }
  // The toast after a delete. both: the saved-with record went too ("logs" | "fillups" | null).
  function toastText(r, both) {
    if (!r.change) return "Reading deleted. Due dates updated.";
    return `Meter change${both ? ` and ${both === "fillups" ? "fill-up" : "Done entry"}` : ""} deleted. Older readings are no longer adjusted.`;
  }

  // ---------- the delete plan (data-layer-plan A.3) ----------
  // recs = { readings, fillups, logs }. kind "reading" (a readings row) or "fillup" (an odometer-only fill-up). Run against fresh data at confirm time.
  // Returns { gone: true } (the row is no longer there) or { changes, undo, companion, thingId }: changes is the one commit() argument, undo the ready-made
  // commit() argument that puts exact clones of every record in `del` back (taken before the write).
  function deletePlan(recs, kind, id, alsoCompanion) {
    const store = kind === "fillup" ? "fillups" : "readings", rec = (recs[store] || []).find((x) => x.id === id);
    if (!rec) return { gone: true };
    const del = { [store]: [id] }, put = { [store]: [structuredClone(rec)] };
    let companion = null;
    if (kind === "reading" && rec.oldValue != null && alsoCompanion) {
      const c = soleCompanion(rec, recs);
      if (c) { companion = c; (del[c.store] = del[c.store] || []).push(c.rec.id); (put[c.store] = put[c.store] || []).push(structuredClone(c.rec)); }
    }
    return { changes: { del }, undo: { put }, companion, thingId: rec.thingId };
  }
  // Undo writes whole records back; if their thing is gone (another tab, a Replace import) nothing is written, so no orphan is made.
  const undoThingId = (undo) => { for (const recs of Object.values(undo.put || {})) if (recs.length) return recs[0].thingId; return null; };
  const canUndo = (undo, things) => { const id = undoThingId(undo); return id != null && things.some((t) => t.id === id); };

  // The Odometer card's entry (R1 M3): the highest value; when a meter change shifts two readings to the same value, the one with the latest date.
  const latest = (es) => es.reduce((a, e) => (!a || e.v > a.v || (e.v === a.v && e.date > a.date) ? e : a), null);
  const api = { latest, FIRST, STEP, num, dayText, hasSection, companionsOf, soleCompanion, buildRows, page, dialogs, toastText, deletePlan, undoThingId, canUndo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReadingsList = api;
})(typeof self !== "undefined" ? self : this);
