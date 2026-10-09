// Shared chrome for the Issue workspace screens: the workspace bar (‹ Back,
// trip title, step indicator), the sticky footer (readiness + the one primary),
// and the markup for one slot field. Pure string builders; index.js mounts the
// typed inputs into the [data-slot-input] placeholders after render.

import { esc } from "../esc.js";
import { deriveFor, isBlank } from "./model.js";
import { formatSemanticValue } from "@wpd/pass-builder/suggest.js";

export const cssId = (sid) => sid.replace(/[^a-zA-Z0-9_-]/g, "_");

const STEPS = [["template", "Template"], ["flight", "Flight"], ["passengers", "Passengers"], ["issued", "Issued"]];

export function barHtml(ctx, title) {
  const at = STEPS.findIndex(([k]) => k === ctx.step);
  const steps = STEPS.map(([k, label], i) => {
    const state = i < at ? "is-done" : i === at ? "is-on" : "";
    const disabled = (k === "issued" && !ctx.results.length) || (ctx.step === "issued" && k !== "template" && k !== "issued");
    return `<li><button type="button" class="iw-step ${state}" data-act="step" data-step="${k}" ${i === at ? 'aria-current="step"' : ""} ${disabled ? "disabled" : ""}><span class="iw-step-n">${i + 1}</span>${label}</button></li>`;
  }).join("");
  const kindLabel = ctx.kind === "studio" ? "Studio design" : "Pass Designer";
  const sub = `${ctx.tpl.organizationName || ctx.tpl.id} · ${kindLabel}${ctx.route && !ctx.routeMode ? ` · route ${ctx.route.id}` : ""}`;
  if (ctx.routeMode) {
    return `
    <header class="iw-bar">
      <button type="button" class="btn btn-sm" data-act="back">‹ Templates</button>
      <div class="iw-title"><b data-ws-title>${esc(title || "New route")}</b><small>${esc(sub)}</small></div>
    </header>`;
  }
  return `
    <header class="iw-bar">
      <button type="button" class="btn btn-sm" data-act="back">‹ Templates</button>
      <div class="iw-title"><b data-ws-title>${esc(title || "New flight")}</b><small>${esc(sub)}</small></div>
      <nav aria-label="Issue steps"><ol class="iw-steps">${steps}</ol></nav>
    </header>`;
}

export function footHtml({ quiet = "", primary }) {
  return `
    <footer class="iw-foot">
      <span class="iw-foot-status"><span class="iw-ready" data-ready role="status" aria-live="polite"></span><span data-ready-fix></span></span>
      <div class="iw-foot-acts">${quiet}${primary}</div>
    </footer>`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/;
/** A compact human rendering of a slot value for hints and summaries. */
export function showValue(slot, v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    return isNaN(d) ? v : `${v.slice(0, 10)} ${ISO_RE.exec(v)[1]}`;
  }
  if (slot?.sem && typeof v === "object") return formatSemanticValue(slot.sem, v);
  return String(v);
}

/** What a blank slot will ship as: a derived value or the template's default. */
export function hintFor(slot, values) {
  if (!isBlank(slot, values[slot.id])) return "";
  const d = deriveFor(slot, values);
  if (d !== undefined) return `Blank uses ${showValue(slot, d)}`;
  // Text-like controls already show the template default as their placeholder.
  if (slot.fallback !== undefined && !["text", "timezone", "number"].includes(slot.widget)) return `Blank keeps the template’s ${showValue(slot, slot.fallback)}`;
  return "";
}

/**
 * One slot's field: label, typed-input placeholder, quiet hint (template
 * default / derived value), and an error line that only fills after blur or
 * an Issue attempt.
 */
export function fieldHtml(slot, scope, { values, touched, submitted, error, wide = false, action = "" }) {
  const id = cssId(slot.id);
  const show = error && (submitted || touched?.has(slot.id));
  const hint = hintFor(slot, values);
  const req = slot.required ? `<span class="iw-req" aria-hidden="true">*</span>` : "";
  return `
    <div class="iw-field ${show ? "has-err" : ""} ${wide || slot.widget === "date" || slot.widget === "personName" ? "is-wide" : ""}" data-field="${esc(slot.id)}">
      <span class="iw-label-row"><span class="iw-label" id="lbl-${scope}-${id}">${esc(slot.label)}${req}</span>${action}</span>
      <div class="iw-control" data-slot-input="${esc(slot.id)}" data-scope="${scope}"></div>
      <span class="iw-hint" data-hint>${esc(hint)}</span>
      <span class="iw-err" id="err-${scope}-${id}">${show ? esc(error) : ""}</span>
    </div>`;
}
