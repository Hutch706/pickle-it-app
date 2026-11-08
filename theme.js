// Apply the saved Light/Dark choice and color palette before the page draws, so it doesn't flash.
try {
  var t = localStorage.getItem("pickle-it:theme"), p = localStorage.getItem("pickle-it:palette");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  if (p && p !== "green") document.documentElement.dataset.palette = p;
} catch (e) {}
