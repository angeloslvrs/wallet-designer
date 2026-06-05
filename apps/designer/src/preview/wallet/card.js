import { renderBarcode } from "./barcode.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fieldEl(f) {
  const wrap = el("div", "wallet-field");
  wrap.appendChild(el("div", "wallet-label", f.label));
  wrap.appendChild(el("div", "wallet-value", f.value));
  return wrap;
}

function row(fields, colsMax) {
  const cols = Math.min(Math.max(fields.length, 1), colsMax);
  const r = el("div", `wallet-row cols-${cols}`);
  fields.forEach(f => r.appendChild(fieldEl(f)));
  return r;
}

/**
 * Render the faithful FRONT ticket from a view-model.
 * @param {HTMLElement} root
 * @param {ReturnType<import("./model.js").toPassView>} view
 * @param {string|null} logoDataUrl
 */
export function renderFront(root, view, logoDataUrl) {
  const card = el("div", "wallet-card");
  card.style.background = view.colors.bg;
  card.style.color = view.colors.fg;

  const body = el("div", "wallet-pad");

  // Header: logo (image or text) + right-aligned header fields (max 3)
  const header = el("div", "wallet-header");
  const logo = el("div", "wallet-logo");
  if (logoDataUrl) {
    const img = document.createElement("img");
    img.src = logoDataUrl;
    img.alt = view.logoText || "logo";
    logo.appendChild(img);
  } else {
    logo.appendChild(document.createTextNode(view.logoText || ""));
  }
  header.appendChild(logo);
  const hf = el("div", "wallet-header-fields");
  view.header.slice(0, 3).forEach(f => hf.appendChild(fieldEl(f)));
  header.appendChild(hf);
  body.appendChild(header);

  // Primary: origin → destination, big IATA codes
  const prim = el("div", "wallet-primary");
  const [from, to] = view.primary;
  prim.appendChild(iataBlock(from, "left"));
  prim.appendChild(el("div", "wallet-plane", "✈"));
  prim.appendChild(iataBlock(to, "right"));
  body.appendChild(prim);

  if (view.secondary.length) body.appendChild(row(view.secondary, 3));
  if (view.auxiliary.length) body.appendChild(row(view.auxiliary, 4));
  card.appendChild(body);

  // Perforation + barcode strip
  card.appendChild(el("div", "wallet-perf"));
  if (view.barcode) {
    const strip = el("div", "wallet-strip");
    strip.appendChild(renderBarcode(view.barcode));
    if (view.barcode.altText) strip.appendChild(el("div", "wallet-alt", view.barcode.altText));
    card.appendChild(strip);
  }

  applyLabelColor(card, view.colors.label);
  root.appendChild(card);
}

function iataBlock(f, align) {
  const b = el("div");
  if (align === "right") b.style.textAlign = "right";
  b.appendChild(el("div", "wallet-city", f?.label ?? ""));
  b.appendChild(el("div", "wallet-iata", f?.value ?? "—"));
  return b;
}

// Apply labelColor to every label + city after the tree is built.
function applyLabelColor(card, color) {
  card.querySelectorAll(".wallet-label, .wallet-city").forEach(n => { n.style.color = color; });
}
