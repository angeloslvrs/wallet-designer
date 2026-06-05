const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Render the BACK of the pass: airline badge + back fields + iOS 26 additional info.
 * @param {HTMLElement} root
 * @param {ReturnType<import("./model.js").toPassView>} view
 * @param {string|null} logoDataUrl
 */
export function renderBack(root, view, logoDataUrl) {
  const card = el("div", "wallet-back");

  const head = el("div", "wallet-back-head");
  const badge = el("div", "badge");
  badge.style.background = view.colors.bg;
  if (logoDataUrl) {
    const img = document.createElement("img");
    img.src = logoDataUrl; img.alt = "logo";
    img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "contain";
    badge.appendChild(img);
  } else {
    badge.textContent = (view.logoText || "?").slice(0, 2).toUpperCase();
  }
  head.appendChild(badge);
  head.appendChild(el("div", null, view.logoText || ""));
  card.appendChild(head);

  const list = el("div", "wallet-back-list");
  const items = [...view.back, ...view.additional];
  if (!items.length) {
    list.appendChild(el("div", "wallet-back-item", "No back fields."));
  } else {
    for (const f of items) {
      const item = el("div", "wallet-back-item");
      item.appendChild(el("div", "k", f.label));
      item.appendChild(el("div", "v", f.value));
      list.appendChild(item);
    }
  }
  card.appendChild(list);
  root.appendChild(card);
}
