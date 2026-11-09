"use strict";
/* Pickle It: the Help card in Settings > App Settings. The text is data (plain strings, never HTML);
   renderHelp() builds it with el() from app.js. Keep the privacy paragraph in step with the privacy policy. */
const HELP_SECTIONS = [
  ["What is the Pantry?", [
    "The Pantry is your home screen. It shows every task that's coming due, across all your jars, sorted into four boxes: Overdue, Due This Week, Due This Month and Due Later. The number at the top counts tasks that are overdue or due this week. When nothing is, the Pantry says so.",
    "A jar is one area of your life: Vehicles, Home, Health or Finance. Tap a jar on the bottom bar to see just its tasks. A red dot means something in that jar needs attention."]],
  ["How do I add a thing?", [
    "A thing is whatever you keep up: a car, a house, a mower, a person, a household. On a new Pantry, tap A Vehicle, A Home, A Person or A Household. Later, open Menu, then Settings, then Assets, and tap Add.",
    "Setup walks you through one page at a time and offers starter tasks. Check the ones you want. Anything you leave unchecked is not added; you can add it later in Assets."]],
  ["What do Done and Skip do?", [
    "When a task is due, tap Done if you did it, or Skip if you're passing on it this time. Either one is saved to the Log, and the task's next due date moves along. Made a mistake? Tap Undo in the message that pops up. It stays for a few seconds.",
    "On a vehicle, Done asks for the odometer, so your readings stay up to date. Skip on a meter task keeps a copy of the current reading."]],
  ["What are readings?", [
    "A reading is a meter value: your odometer, or the hours on a mower or generator. Tap Add Reading on a row that needs one, or open Menu and tap Log Hours. If you type a number lower than the last one, Pickle It asks \"Did you type that right?\" Say Yes if the meter was replaced or reset. Say No to fix it. Wrong reading saved anyway? Delete it from the thing's readings list in Assets."]],
  ["What does \"Repeats by\" mean?", [
    "How a task comes due again: by Miles, Hours, Months, or on fixed Dates. Miles and Hours can add a Months limit, and the task is due whichever comes first. Remind sets how early a Miles or Hours task moves up to Due This Month."]],
  ["How do I back up?", [
    "Open Menu, then Settings, then App Settings, and tap Export Backup (CSV). You get one file with everything in it. The file isn't encrypted and includes everything you've saved, including Health and Finance tasks and notes, so keep it somewhere private.",
    "A dot on the Menu button means a backup is due. To restore or move to another phone, tap Choose CSV file under Import a Backup. You'll see a preview first, then pick Merge (add to what's here) or Replace (swap what's here for the file)."]],
  ["How do I delete everything?", [
    "Settings, then App Settings, then Start Over, then Delete All Data. It asks twice, and you type DELETE the second time. This erases everything Pickle It saved on this device, including your theme and palette. It can't be undone, so export a backup first if you might want it.",
    "It doesn't delete backup files you saved or shared earlier. Delete those yourself. If you used Pickle It on another phone or browser, that copy is separate; run Delete All Data there too."]],
  ["How do I install it on my phone?", [
    "See Install as an App above. On iPhone, open Pickle It in Safari, tap Share, then Add to Home Screen, and open it from the new icon from then on. Do this before you add anything. Data in a Safari tab and data in the Home Screen app are two separate copies.",
    "On Android, open Pickle It in Chrome, tap the menu, then Install app (or Add to Home screen). On a computer, use the install icon at the right end of the address bar in Chrome or Edge."]],
  ["What happens to my data?", [
    "Pickle It keeps what you type on your own device. There are no accounts and no Pickle It server that receives your data, so we can't see what you save, and we don't sell, share or track anything about you. There are no analytics or ads. Your things, tasks, history, readings, fill-ups and notes sit in your browser's storage, and your theme and palette sit in its local storage. Export is the only way data leaves, and only when you choose.",
    "Please keep sensitive details out of names and notes: use \"Dr. visit\", not a diagnosis, and never enter passwords or account numbers."]],
  ["The app looks wrong or is blank", [
    "Close and reopen it while online; it fetches the newest version. Still stuck? Export a backup if you can, then try again."]],
];

function renderHelp(root) {
  root.replaceChildren(...HELP_SECTIONS.map(([q, paras]) => {
    const d = el("details", "how"), s = el("summary", null, q);
    d.append(s, ...paras.map((t) => el("p", "hint", t)));
    return d;
  }));
}
