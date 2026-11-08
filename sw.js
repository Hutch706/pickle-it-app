/* Pickle It: offline support.
   Network first, so changes you publish show up the next time the app opens. If the network is
   missing or slow (3 seconds), the copy saved on the device is used instead. Every file the app loads
   is saved again each time it comes from the network, so edits never need a version bump here.
   Keep FILES matching the app's files so a fresh install works offline right away; a file that's
   missing from the server is skipped instead of stopping the install. */
const CACHE = "pickle-it-v1";
const FILES = [
  "./", "./index.html", "./app.css", "./theme.js", "./data.js", "./due.js", "./readings-list.js", "./starters.js", "./assets.js", "./jar-page.js", "./tasks-form.js", "./setup.js", "./setup-home.js", "./onboarding.js", "./pantry.js", "./assets-screen.js", "./assets-edit.js", "./assets-readings.js", "./setup-screen.js", "./jar-screen.js", "./help.js", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon.svg", "./icons/favicon-32.png",
];
const TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(FILES.map((u) => c.add(new Request(u, { cache: "reload" })))))
    .then(() => self.skipWaiting()));
});

// Remove this app's older caches. Only pickle-it- ones: the Vehicle Maintenance App may share this
// web address (for example the same github.io account), and its caches aren't ours to delete.
const OWN_CACHE = (k) => k.startsWith("pickle-it-");
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => OWN_CACHE(k) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL("./", self.location).href;
  if (!url.href.startsWith(scope)) return;
  // The app page itself, however it's addressed (/repo/, /repo/index.html, /repo/?x), is one cache entry.
  const isApp = req.mode === "navigate" && (url.href.split(/[?#]/)[0] === scope || url.pathname.endsWith("/index.html"));
  const key = isApp ? new URL("./index.html", self.location).href : url.origin + url.pathname;
  event.respondWith(networkFirst(event, url, key));
});

async function networkFirst(event, url, key) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(url.origin + url.pathname + url.search, { cache: "no-cache", credentials: "same-origin" })
    .then(async (res) => { if (res.ok) await cache.put(key, res.clone()); return res; });
  event.waitUntil(fromNetwork.catch(() => {}));
  const cached = await cache.match(key);
  if (!cached) return fromNetwork;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const res = await Promise.race([fromNetwork.catch(() => null), timeout]);
  return res && res.ok ? res : cached;
}
