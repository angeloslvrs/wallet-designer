let active = "front";
const listeners = new Set();

export function mountTabs(navEl) {
  navEl.addEventListener("click", e => {
    const t = e.target.dataset?.tab;
    if (!t) return;
    active = t;
    for (const b of navEl.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.tab === t);
    }
    listeners.forEach(fn => fn(active));
  });
}

export const getActiveTab = () => active;
export const onTabChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
