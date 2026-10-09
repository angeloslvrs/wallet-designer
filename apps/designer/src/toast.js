// One shell-level toast: the outcome of a push/delete, announced politely and
// gone again. A single element is reused so repeated pushes never stack.
let hideTimer = null;

export function toast(message, { duration = 2600 } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove("is-shown");
  void el.offsetWidth;   // restart the transition for back-to-back toasts
  el.classList.add("is-shown");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove("is-shown"), duration);
  return el;
}
