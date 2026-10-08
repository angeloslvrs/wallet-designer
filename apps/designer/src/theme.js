// Theme: dark by default (the Studio-dark system), light on the same tokens.
// Persisted in localStorage; first visit follows prefers-color-scheme.
const KEY = "wpd:theme";

export function currentTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage unavailable */ }
  return globalThis.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  for (const b of document.querySelectorAll("[data-theme-toggle]")) {
    b.textContent = theme === "light" ? "☾" : "☀";
    b.title = theme === "light" ? "Switch to dark" : "Switch to light";
  }
  return theme;
}

export function toggleTheme() {
  return applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

export function initTheme() {
  applyTheme(currentTheme());
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) toggleTheme();
  });
}
