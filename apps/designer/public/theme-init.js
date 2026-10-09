// Apply the saved theme before first paint (a same-origin classic script, so it
// satisfies the CSP's default-src 'self' — an inline <script> would be blocked).
try {
  // ?theme=light|dark previews a theme for this load without saving it.
  var q = new URLSearchParams(location.search).get("theme");
  var t = (q === "light" || q === "dark") ? q : localStorage.getItem("wpd:theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: keep the default dark theme */ }
