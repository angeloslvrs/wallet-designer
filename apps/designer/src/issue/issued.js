// Issue workspace · Issued: one card per pass — QR to scan on an iPhone, Apple's
// Add to Apple Wallet badge (verbatim artwork, see wallet-badge.js), copy and
// download links. Failed passes say why and can be taken back to fix.

import { esc } from "../esc.js";
import { appleWalletButton } from "../wallet-badge.js";
import { barHtml, footHtml } from "./shell.js";

const passUrl = (serial) => `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;

function card(r) {
  if (!r.ok) {
    return `<article class="iw-card is-failed">
        <div class="iw-card-nm">${esc(r.name)}</div>
        <div class="iw-card-sr mono">${esc(r.serial)}</div>
        <p class="iw-note is-err">Not issued: ${esc(r.error)}</p>
      </article>`;
  }
  const url = passUrl(r.serial);
  return `<article class="iw-card">
      <canvas class="iw-qr" data-qr="${esc(url)}" role="img" aria-label="QR code that opens ${esc(r.name)}’s pass"></canvas>
      <div class="iw-card-nm">${esc(r.name)}</div>
      <div class="iw-card-sr mono">${esc(r.serial)}</div>
      ${r.created ? "" : `<p class="iw-note is-warn">Updated the existing pass</p>`}
      <div class="iw-card-badge">${appleWalletButton(url)}</div>
      <div class="iw-card-links">
        <button type="button" class="btn-link" data-act="copy-link" data-url="${esc(url)}">Copy link</button>
        <a class="btn-link" href="${esc(url)}" download>Download .pkpass</a>
      </div>
    </article>`;
}

export function issuedHtml(ctx) {
  const ok = ctx.results.filter(r => r.ok), failed = ctx.results.filter(r => !r.ok);
  const updated = ok.filter(r => !r.created).length;
  const headline = !ok.length ? "Nothing was issued"
    : `${ok.length} pass${ok.length === 1 ? "" : "es"} ${updated === ok.length ? "updated" : "issued"}${failed.length ? ` · ${failed.length} failed` : ""}`;
  const flight = ctx.facts.title?.split(" · ")[0] || "flight";
  return `
    <div class="iw">
      ${barHtml(ctx, ctx.facts.title)}
      <div class="iw-main">
        <div class="iw-done">
          <div class="iw-head">
            <h1>${esc(headline)}</h1>
            <p class="view-sub">${ok.length ? "Scan a code with an iPhone camera, or send the links. Push gate and status changes from the Flights board." : "Nothing reached the server — see each passenger below."}</p>
          </div>
          <div class="iw-done-acts">
            ${ok.length ? `<button type="button" class="btn" data-act="copy-all">Copy all links</button>` : ""}
            ${failed.length ? `<button type="button" class="btn" data-act="fix-failed">Fix ${failed.length} failed</button>` : ""}
            <button type="button" class="btn" data-act="add-more">Add more passengers</button>
          </div>
          <div class="iw-grid stagger">${ctx.results.map(card).join("")}</div>
        </div>
      </div>
      ${footHtml({ primary: ok.length ? `<button type="button" class="btn btn-primary" data-act="open-flight" data-primary>Open ${esc(flight)}</button>` : "" })}
    </div>`;
}

/** Draw the QR codes once bwip-js (its own lazy chunk) has loaded. */
export async function drawQrCodes(root, signal) {
  const canvases = [...root.querySelectorAll("canvas[data-qr]")];
  if (!canvases.length) return;
  let bwipjs;
  try { ({ default: bwipjs } = await import("bwip-js")); } catch { return; }
  if (signal?.aborted) return;
  for (const c of canvases) {
    try { bwipjs.toCanvas(c, { bcid: "qrcode", text: c.dataset.qr, scale: 3, padding: 2, backgroundcolor: "FFFFFF" }); } catch { /* leave blank */ }
    c.removeAttribute("data-qr");
  }
}
