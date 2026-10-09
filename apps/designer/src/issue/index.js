// Issue workspace — template → Flight → Passengers → Issued.
// A full-screen workspace (the masthead nav hides while it's open; ‹ Back
// returns to the Templates shelf). Works for both template kinds through the
// semantics-first slots in model.js; the three screens' markup lives in
// flight.js / passengers.js / issued.js, and this module owns state + events.
//
// Rules carried from the spec: one blue primary per screen (in the footer),
// errors only after blur or submit, the footer always says what's ready, the
// Issue button is never disabled up front, and its label is honest about
// updates ("Issue 1 · update 1"). Every mount aborts the previous one.

import { kindAttrs } from "@wpd/pass-builder/field-kinds.js";
import { parseBCBP, bcbpToSemantics } from "@wpd/pass-builder/bcbp.js";
import { renderTypedInput, withZoneOffset } from "../inputs.js";
import { toPassView } from "../preview/wallet/model.js";
import { renderFront } from "../preview/wallet/card.js";
import { renderBack } from "../preview/wallet/back.js";
import { renderDetail } from "../preview/wallet/detail.js";
import { esc } from "../esc.js";
import { toast } from "../toast.js";
import "../preview/wallet/wallet.css";
import {
  templateSlots, defaultIndividual, issueSlots, slotError, isBlank, effectiveValue, tripIdFrom, suggestSerials,
  parseBcbpLines, bcbpMismatch, serialReport, issueLabel, buildTemplateIssueBody, buildStudioIssueBody,
  previewFor, rosterToValues, valuesToRoster, copyToClipboard
} from "./model.js";
import { flightHtml, flightFacts } from "./flight.js";
import { passengersHtml, paxListHtml, pagerHtml } from "./passengers.js";
import { issuedHtml, drawQrCodes } from "./issued.js";
import { cssId, hintFor, showValue } from "./shell.js";

let paxSeq = 0;
const newPax = (values = {}, extra = {}) => ({ id: ++paxSeq, values, serial: "", serialEdited: false, touched: new Set(), barcodeMessage: "", warn: [], ...extra });

/**
 * @param {HTMLElement} root
 * @param {{template?: string, kind?: "designer"|"studio", onBack?: () => void,
 *          openFlight?: (groupId: string) => void, showTemplates?: () => void}} opts
 */
export function mountIssue(root, { template: id, kind = "designer", onBack, openFlight, showTemplates } = {}) {
  root._mountAbort?.abort();
  const { signal } = (root._mountAbort = new AbortController());
  const $ = (s) => root.querySelector(s);

  // ---- state ------------------------------------------------------------------
  let tpl = null;            // template entry (same merge surface for both kinds)
  let design = null;         // studio: the saved FormState
  let baseSlots = [];        // the template's slots
  let slots = [];            // as issued: per-passenger ones lose template defaults (issueSlots)
  let individual = new Set();
  const setIndividual = (next) => { individual = next; slots = issueSlots(baseSlots, individual); };
  let shared = {};           // slot id → value (the flight)
  let sharedTouched = new Set();
  let tripId = "", tripIdEdited = false, expiry = "";
  let pax = [];
  let sel = 0;               // selected passenger index
  let step = "flight";       // flight | passengers | issued
  let mode = "scan";         // passengers input mode: scan | type | roster
  let previewTab = "front";
  let submitted = false;     // an Issue attempt reveals every error
  let pasteReport = [];      // last multi-line paste: per-line errors
  let rosterEdit = false;
  let existing = new Set();  // serials already issued
  let roster = [];
  let results = [];          // issued screen
  let issuing = false;

  const slotById = (sid) => slots.find(s => s.id === sid);
  const sharedSlots = () => slots.filter(s => !individual.has(s.id));
  const paxSlots = () => slots.filter(s => individual.has(s.id));
  const valuesFor = (p) => ({ ...Object.fromEntries(Object.entries(shared).filter(([k]) => !individual.has(k))), ...Object.fromEntries(Object.entries(p?.values ?? {}).filter(([k]) => individual.has(k))) });
  const effectiveTripId = () => (tripIdEdited ? tripId.trim() : tripIdFrom(shared, slots));

  function reSuggestSerials() {
    const gid = effectiveTripId();
    const serials = suggestSerials(gid, pax.map(p => (p.serialEdited ? p.serial : null)), existing);
    pax = pax.map((p, i) => ({ ...p, serial: serials[i] }));
  }

  // ---- validation ---------------------------------------------------------------
  const sharedErrors = () => sharedSlots().map(s => ({ slot: s, msg: slotError(s, shared) })).filter(e => e.msg);
  const paxErrors = (p) => paxSlots().map(s => ({ slot: s, msg: slotError(s, valuesFor(p)) })).filter(e => e.msg);
  const serials = () => serialReport(pax.map(p => p.serial), existing);
  function paxProblems(i, rep = serials()) {
    const out = paxErrors(pax[i]).map(e => `${e.slot.label}: ${e.msg.toLowerCase()}`);
    if (rep.duplicates.has(i)) out.push("serial used twice in this batch");
    if (rep.missing.has(i)) out.push("serial missing");
    return out;
  }
  const tripError = () => (effectiveTripId() ? null : "Needs airline, flight number and departure date — or type a trip id");

  // ---- render -----------------------------------------------------------------
  function render() {
    if (signal.aborted) return;
    const ctx = context();
    root.innerHTML = step === "issued" ? issuedHtml(ctx) : step === "passengers" ? passengersHtml(ctx) : flightHtml(ctx);
    mountFields();
    renderPreview();
    if (step === "issued") drawQrCodes(root, signal);
    refreshFooter();
  }

  function context() {
    return {
      tpl, kind, step, slots, individual, shared, sharedTouched, submitted, tripId: effectiveTripId(), tripIdEdited, tripError: tripError(),
      expiry, pax, sel, mode, previewTab, pasteReport, roster, rosterEdit, existing, results, serials: serials(),
      facts: flightFacts(slots, shared, expiry), valuesFor, paxProblems, sharedErrors: sharedErrors()
    };
  }

  function remountField(sid) {
    const ph = root.querySelector(`[data-slot-input="${CSS.escape(sid)}"][data-scope="shared"]`);
    if (ph) mountFields([ph]);
  }

  // Typed inputs are DOM components: mount them into their placeholders.
  function mountFields(only = null) {
    for (const ph of only ?? root.querySelectorAll("[data-slot-input]")) {
      const sid = ph.dataset.slotInput;
      const scope = ph.dataset.scope;   // "shared" | "pax"
      const slot = slotById(sid);
      if (!slot) continue;
      const p = pax[sel];
      const value = scope === "shared" ? shared[sid] : p?.values[sid];
      const input = renderTypedInput({
        type: slot.widget === "text" && slot.kind === "date" ? "date" : slot.widget,
        value, attrs: kindAttrs(slot.kind), label: slot.label, zone: () => zoneFor(sid),
        onChange: (v) => {
          if (slot.kind === "iata" && typeof v === "string") {
            v = v.toUpperCase();
            const inp = ph.querySelector("input"); if (inp && inp.value !== v) { const pos = inp.selectionStart; inp.value = v; try { inp.setSelectionRange(pos, pos); } catch { /* */ } }
          }
          if (scope === "shared") shared = { ...shared, [sid]: v };
          else pax = pax.map((q, i) => (i === sel ? { ...q, values: { ...q.values, [sid]: v } } : q));
          liveClear(ph, sid, scope);
          onValuesChanged(scope, sid);
        }
      });
      ph.replaceChildren(input);
      // A text-like control shows what blank ships as (template default) — never
      // a generic example that reads like a value.
      const single = input.querySelectorAll("input:not([type=date]):not([type=time]):not([title='UTC offset'])");
      if (single.length === 1 && ["text", "timezone", "number"].includes(slot.widget)) {
        single[0].placeholder = slot.fallback !== undefined ? showValue(slot, slot.fallback) : "";
      }
      for (const inp of input.querySelectorAll("input, select")) {
        inp.setAttribute("aria-describedby", `err-${scope}-${cssId(sid)}`);
        if (!inp.hasAttribute("aria-label")) inp.setAttribute("aria-labelledby", `lbl-${scope}-${cssId(sid)}`);
      }
    }
    // Pass expiry isn't a semantic: its own typed picker (blank = arrival + 1 day).
    const exp = only ? null : $("[data-expiry-input]");
    if (exp) exp.replaceChildren(renderTypedInput({
      type: "date", value: expiry, label: "Pass expiry",
      onChange: (v) => { expiry = v; const f = $("[data-facts]"); if (f) f.innerHTML = flightFacts(slots, shared, expiry).html; }
    }));
  }

  // A schedule time is local to its airport: its default UTC offset follows the
  // airport's zone (typed or the template's), not the operator's browser.
  const ZONE_OF = { "sem:currentBoardingDate": "sem:departureAirportTimeZone", "sem:currentDepartureDate": "sem:departureAirportTimeZone", "sem:currentArrivalDate": "sem:destinationAirportTimeZone" };
  function zoneFor(sid) {
    const tzSlot = slotById(ZONE_OF[sid]);
    if (!tzSlot) return null;
    const v = shared[tzSlot.id];
    return isBlank(tzSlot, v) ? tzSlot.fallback ?? null : v;
  }
  // Changing an airport's zone re-anchors the times entered against it.
  function reanchorDates(tzSid) {
    const zone = shared[tzSid] || slotById(tzSid)?.fallback;
    if (!zone || !/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(zone)) return false;
    let changed = false;
    for (const [dsid, z] of Object.entries(ZONE_OF)) {
      if (z !== tzSid || typeof shared[dsid] !== "string" || !shared[dsid]) continue;
      const next = withZoneOffset(shared[dsid], zone);
      if (next !== shared[dsid]) { shared = { ...shared, [dsid]: next }; changed = true; }
    }
    return changed;
  }

  // While typing: clear an error that's already showing once the value is fine;
  // never raise a new one mid-keystroke (that waits for blur).
  function liveClear(ph, sid, scope) {
    const span = root.querySelector(`#err-${scope}-${cssId(sid)}`);
    if (!span?.textContent) return;
    const msg = scope === "shared" ? slotError(slotById(sid), shared) : slotError(slotById(sid), valuesFor(pax[sel]));
    if (!msg) { span.textContent = ""; ph.closest(".iw-field")?.classList.remove("has-err"); }
  }
  function showFieldError(sid, scope) {
    const span = root.querySelector(`#err-${scope}-${cssId(sid)}`);
    if (!span) return;
    const slot = slotById(sid);
    const msg = scope === "shared" ? slotError(slot, shared) : slotError(slot, valuesFor(pax[sel]));
    span.textContent = msg ?? "";
    span.closest(".iw-field")?.classList.toggle("has-err", Boolean(msg));
  }

  // Partial refreshes that keep focus in the field being edited.
  function onValuesChanged(scope, sid) {
    if (scope === "shared" && Object.values(ZONE_OF).includes(sid) && reanchorDates(sid)) {
      // Re-mount the schedule pickers so they show the new offsets (keep focus on the zone).
      for (const dsid of Object.keys(ZONE_OF)) remountField(dsid);
    }
    if (scope === "shared") {
      if (!tripIdEdited) {
        const before = pax.map(p => p.serial).join();
        reSuggestSerials();
        const t = $("#iw-trip"); if (t && document.activeElement !== t) t.value = effectiveTripId();
        if (before !== pax.map(p => p.serial).join()) refreshPaxList();
      }
      const facts = $("[data-facts]"); if (facts) facts.innerHTML = flightFacts(slots, shared, expiry).html;
      refreshTitle();
      refreshHints("shared");
    } else {
      refreshHints("pax");
      refreshPaxList();
      refreshPager();
    }
    renderPreview();
    refreshFooter();
  }

  function refreshHints(scope) {
    const values = scope === "shared" ? shared : valuesFor(pax[sel]);
    for (const f of root.querySelectorAll(`[data-field]`)) {
      const ph = f.querySelector(`[data-scope="${scope}"]`);
      const h = f.querySelector("[data-hint]");
      const slot = ph && slotById(f.dataset.field);
      if (slot && h) h.textContent = hintFor(slot, values);
    }
  }

  function refreshTitle() { const t = $("[data-ws-title]"); if (t) t.textContent = flightFacts(slots, shared, expiry).title || "New flight"; }

  function refreshPaxList() {
    const host = $("[data-pax-list]");
    if (host) host.innerHTML = paxListHtml(context());
  }
  function refreshPager() {
    const pg = $("[data-pager]");
    if (pg) pg.outerHTML = pagerHtml(context());
  }

  // The live pass: shared values on Flight, the selected passenger on Passengers.
  function renderPreview() {
    const host = $("[data-preview]");
    if (!host || !tpl?.preview) return;
    const p = step === "passengers" ? pax[sel] : null;
    const values = p ? valuesFor(p) : shared;
    const pass = previewFor(tpl.preview, slots, values, p?.serial ?? "");
    if (p?.barcodeMessage && pass.barcodes?.[0]) pass.barcodes = pass.barcodes.map(b => ({ ...b, message: p.barcodeMessage }));
    else if (p?.serial && pass.barcodes?.[0]) pass.barcodes = pass.barcodes.map(b => ({ ...b, message: p.serial }));
    const view = toPassView(pass);
    // Flight step: a thumbnail of shared values — no encoder needed.
    if (step !== "passengers" && view.barcode) view.barcode = { format: "thumbnail", message: "", altText: view.barcode.altText };
    host.replaceChildren();
    try {
      if (step === "passengers" && previewTab === "back") renderBack(host, view, tpl.logo ?? null);
      else if (step === "passengers" && previewTab === "detail") renderDetail(host, pass);
      else renderFront(host, view, tpl.logo ?? null);
    } catch (err) { host.textContent = `Preview unavailable: ${err.message}`; }
  }

  function refreshFooter() {
    const status = $("[data-ready]"), btn = $("[data-primary]");
    if (!status || !btn) return;
    if (step === "flight") {
      const errs = sharedErrors();
      const missing = errs.filter(e => e.msg === "Required").map(e => e.slot.label);
      status.textContent = errs.length
        ? `${missing.length ? `Still needed: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` +${missing.length - 4}` : ""}` : `${errs.length} field${errs.length === 1 ? "" : "s"} to fix`} · a scanned boarding pass can fill the route`
        : "Flight is complete";
      status.classList.toggle("is-ok", !errs.length);
      return;
    }
    if (step === "passengers") {
      const rep = serials();
      const ready = pax.filter((_, i) => !paxProblems(i, rep).length).length;
      const fl = sharedErrors().length + (tripError() ? 1 : 0);
      const parts = [];
      if (!pax.length) parts.push("No passengers yet");
      else parts.push(`${ready} of ${pax.length} ready`);
      if (fl) parts.push(`flight: ${fl} to fix`);
      if (rep.updates.size) parts.push(`${rep.updates.size} will update an existing pass`);
      status.textContent = parts.join(" · ");
      status.classList.toggle("is-ok", Boolean(pax.length) && ready === pax.length && !fl);
      if (!issuing) btn.textContent = pax.length ? issueLabel(pax.length, rep.updates.size) : "Issue passes";
      return;
    }
    const ok = results.filter(r => r.ok);
    status.textContent = ok.length ? `On the Flights board under ${ok[0].groupId}` : "";
  }

  // ---- actions ----------------------------------------------------------------
  function goto(next) {
    step = next;
    if (next === "passengers" && !pax.length) mode = "scan";
    render();
    root.querySelector(".iw-main")?.scrollTo?.(0, 0);
  }

  function addPassengers(list, focus = true) {
    if (!list.length) return;
    pax = [...pax, ...list];
    reSuggestSerials();
    sel = pax.length - list.length;
    if (step !== "passengers") step = "passengers";
    render();
    if (focus) root.querySelector('.iw-right [data-slot-input] input')?.focus();
  }

  // Multi-line paste: one BCBP per line. The first pass fills empty flight
  // fields (scan-first); a pass for another flight is added but flagged.
  function addFromPaste(text) {
    const parsed = parseBcbpLines(text, (raw) => parseBCBP(raw), bcbpToSemantics);
    pasteReport = parsed.filter(r => !r.ok);
    const ok = parsed.filter(r => r.ok);
    if (!ok.length) { render(); return; }
    let filled = [];
    for (const [sid, v] of Object.entries(ok[0].flight ?? {})) {
      const slot = slotById(sid);
      // Only fill what has no value at all: a template default that disagrees
      // is flagged on the passenger instead (its city names / zones would be stale).
      if (slot && !individual.has(sid) && isBlank(slot, effectiveValue(slot, shared))) { shared = { ...shared, [sid]: v }; filled.push(slot.label.toLowerCase()); }
    }
    const list = ok.map(r => {
      const values = {};
      for (const [sid, v] of Object.entries(r.passenger)) if (slotById(sid)) values[sid] = v;
      return newPax(values, { barcodeMessage: r.raw, warn: bcbpMismatch(r.flight, shared, slots), source: "scan" });
    });
    addPassengers(list, false);
    const ta = $("#iw-paste"); if (ta && !pasteReport.length) ta.value = "";
    toast(`Added ${list.length} passenger${list.length === 1 ? "" : "s"}${filled.length ? ` · flight ${filled.join(", ")} filled from the boarding pass` : ""}`);
  }

  async function scanOne() {
    const { scanBarcode } = await import("../scan.js");
    const text = await scanBarcode();
    if (signal.aborted || !text) return;
    addFromPaste(text);
  }

  function removePax(i) {
    pax = pax.filter((_, n) => n !== i);
    sel = Math.max(0, Math.min(sel, pax.length - 1));
    reSuggestSerials();
    render();
  }

  async function issueAll() {
    if (issuing) return;
    submitted = true;
    const rep = serials();
    const flightBad = sharedErrors().length || tripError();
    const firstBad = pax.findIndex((_, i) => paxProblems(i, rep).length);
    if (!pax.length || flightBad || firstBad >= 0) {
      if (firstBad >= 0) sel = firstBad;
      render();
      if (flightBad && firstBad < 0 && pax.length) toast("The flight has fields to fix — Edit flight");
      root.querySelector(".iw-field.has-err input, .iw-field.has-err select")?.focus();
      return;
    }
    issuing = true;
    const btn = $("[data-primary]");
    btn?.classList.add("is-busy");
    const groupId = effectiveTripId();
    results = [];
    for (let i = 0; i < pax.length; i++) {
      if (btn) btn.textContent = `Issuing ${i + 1} of ${pax.length}…`;
      const p = pax[i];
      const args = { groupId, serial: p.serial, slots, values: valuesFor(p), barcodeMessage: p.barcodeMessage, expirationDate: expiry };
      const body = kind === "studio" ? buildStudioIssueBody({ ...args, design, designName: tpl.id }) : buildTemplateIssueBody({ ...args, template: tpl.id });
      let r, j;
      try {
        r = await fetch("/api/passes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        j = await r.json().catch(() => ({}));
      } catch { if (signal.aborted) return; r = null; j = { error: "API offline" }; }
      if (signal.aborted) return;
      const name = p.values["sem:passengerName"];
      results.push({
        pax: p, ok: Boolean(r?.ok), error: j.error ?? (r ? `HTTP ${r.status}` : "API offline"),
        serial: j.serialNumber ?? p.serial, groupId: j.groupId ?? groupId, created: j.created !== false,
        name: name ? [name.familyName, name.givenName].filter(Boolean).join(" / ").toUpperCase() : "Unnamed passenger"
      });
      if (r?.ok) existing.add(j.serialNumber ?? p.serial);
    }
    issuing = false;
    step = "issued";
    render();
  }

  async function saveToRoster() {
    const p = pax[sel];
    if (!p) return;
    const semantics = valuesToRoster(p.values, slots, individual);
    const status = $("[data-roster-status]");
    if (!semantics.passengerName) { if (status) status.textContent = "Add a name first."; return; }
    const label = ($("#iw-roster-label")?.value ?? "").trim();
    let r, j;
    try {
      r = await fetch("/api/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(label ? { label } : {}), semantics }), signal });
      j = await r.json().catch(() => ({}));
    } catch { if (signal.aborted) return; if (status) status.textContent = "API offline — not saved"; return; }
    if (signal.aborted) return;
    if (!r.ok) { if (status) status.textContent = `Not saved: ${j.error ?? r.status}`; return; }
    roster = [...roster.filter(e => e.id !== j.id), j];
    if (status) status.textContent = "Saved to roster";
  }

  async function deleteRoster(rid) {
    const entry = roster.find(e => e.id === rid);
    const who = entry?.label ?? [entry?.semantics?.passengerName?.givenName, entry?.semantics?.passengerName?.familyName].filter(Boolean).join(" ") ?? rid;
    if (!confirm(`Remove ${who} from saved passengers?`)) return;
    let r;
    try { r = await fetch(`/api/roster/${encodeURIComponent(rid)}`, { method: "DELETE", signal }); } catch { if (signal.aborted) return; toast("API offline"); return; }
    if (signal.aborted) return;
    if (!r.ok && r.status !== 404) { toast(`Could not remove (${r.status})`); return; }
    roster = roster.filter(e => e.id !== rid);
    render();
  }

  const dirty = () => step !== "issued" && (pax.length > 0 || Object.values(shared).some(v => v !== undefined && v !== ""));
  function back() {
    if (dirty() && !confirm("Leave this flight? Passengers you haven't issued are discarded.")) return;
    onBack?.();
  }

  // ---- events -----------------------------------------------------------------
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    if (act === "back") return back();
    if (act === "templates") return showTemplates?.();
    if (act === "step") { if (t.dataset.step === "template") return back(); if (t.dataset.step === "issued" && !results.length) return; return goto(t.dataset.step); }
    if (act === "to-passengers") return goto("passengers");
    if (act === "edit-flight") return goto("flight");
    if (act === "issue") return issueAll();
    if (act === "mode") { mode = t.dataset.mode; render(); return; }
    if (act === "paste-add") return addFromPaste($("#iw-paste")?.value ?? "");
    if (act === "scan") return scanOne();
    if (act === "type-add") return addPassengers([newPax({}, { source: "type" })]);
    if (act === "roster-add") { const en = roster.find(x => x.id === t.dataset.id); if (en) addPassengers([newPax(rosterToValues(en, slots), { source: "roster" })], false); return; }
    if (act === "roster-edit") { rosterEdit = !rosterEdit; render(); return; }
    if (act === "roster-del") return deleteRoster(t.dataset.id);
    if (act === "roster-save") return saveToRoster();
    if (act === "pax") { sel = Number(t.dataset.i); render(); return; }
    if (act === "pax-rm") { e.stopPropagation(); return removePax(Number(t.dataset.i)); }
    if (act === "prev" || act === "next") { if (!pax.length) return; sel = (sel + (act === "next" ? 1 : -1) + pax.length) % pax.length; render(); return; }
    if (act === "tab") { previewTab = t.dataset.tab; for (const b of root.querySelectorAll('[data-act="tab"]')) b.setAttribute("aria-selected", String(b === t)); renderPreview(); return; }
    if (act === "vary") { setIndividual(new Set(individual).add(t.dataset.slot)); render(); return; }
    if (act === "share") {
      const sid = t.dataset.slot;
      if (slotById(sid)?.perPassenger === "locked") return;
      const next = new Set(individual); next.delete(sid); setIndividual(next);
      if (isBlank(slotById(sid), shared[sid])) { const v = pax.map(p => p.values[sid]).find(v => !isBlank(slotById(sid), v)); if (v !== undefined) shared = { ...shared, [sid]: v }; }
      render();
      return;
    }
    if (act === "copy-all") {
      const links = results.filter(r => r.ok).map(r => `${r.name}\t${passUrl(r.serial)}`).join("\n");
      const ok = await copyToClipboard(links);
      t.textContent = ok ? "Copied ✓" : "Copy failed";
      return;
    }
    if (act === "copy-link") { const ok = await copyToClipboard(t.dataset.url); t.textContent = ok ? "Copied ✓" : "Copy failed"; return; }
    if (act === "add-more") { pax = []; results = []; submitted = false; reSuggestSerials(); goto("passengers"); return; }
    if (act === "fix-failed") {
      pax = results.filter(r => !r.ok).map(r => r.pax);
      results = []; submitted = true; sel = 0; reSuggestSerials(); goto("passengers"); return;
    }
    if (act === "open-flight") { const g = results.find(r => r.ok)?.groupId ?? effectiveTripId(); return openFlight?.(g); }
  }, { signal });

  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-act-change='vary']")) {
      const sid = e.target.value;
      if (sid) { setIndividual(new Set(individual).add(sid)); render(); }
    }
  }, { signal });

  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "iw-trip") { tripId = t.value; tripIdEdited = Boolean(t.value.trim()); reSuggestSerials(); refreshPaxList(); refreshTitle(); refreshFooter(); const err = $("#err-trip"); if (err && !tripError()) err.textContent = ""; return; }
    if (t.matches("[data-serial]")) {
      pax = pax.map((p, i) => (i === sel ? { ...p, serial: t.value, serialEdited: Boolean(t.value.trim()) } : p));
      if (!t.value.trim()) reSuggestSerials();
      refreshSerialNote(); refreshPaxList(); refreshFooter(); renderPreview();
    }
  }, { signal });

  function refreshSerialNote() {
    const note = $("[data-serial-note]");
    if (!note) return;
    const rep = serials();
    note.className = "iw-note";
    if (rep.duplicates.has(sel)) { note.textContent = "Another passenger in this batch has this serial — each pass needs its own."; note.classList.add("is-err"); }
    else if (rep.updates.has(sel)) { note.textContent = "Already issued — issuing updates that pass on every device that has it."; note.classList.add("is-warn"); }
    else note.textContent = "";
  }

  root.addEventListener("focusout", (e) => {
    const ph = e.target.closest?.("[data-slot-input]");
    if (!ph || ph.contains(e.relatedTarget)) return;
    const sid = ph.dataset.slotInput, scope = ph.dataset.scope;
    if (scope === "shared") sharedTouched.add(sid);
    else if (pax[sel]) pax[sel].touched.add(sid);
    showFieldError(sid, scope);
    if (scope === "pax") refreshPaxList();
  }, { signal });

  root.addEventListener("keydown", (e) => {
    if (step !== "passengers" || !pax.length) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!e.target.closest("[data-pax-list]")) return;
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + pax.length) % pax.length;
      render();
      root.querySelector(`[data-pax-list] [data-i="${sel}"]`)?.focus();
    }
  }, { signal });

  // ---- load -------------------------------------------------------------------
  const passUrl = (serial) => `${location.origin}/api/passes/${encodeURIComponent(serial)}/pkpass`;

  async function load() {
    if (signal.aborted) return;
    if (!id) { showTemplates?.(); return; }
    root.innerHTML = `<div class="view"><p class="empty">Loading…</p></div>`;
    const get = (u) => fetch(u, { signal }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    let list, passes, ros;
    try {
      [list, passes, ros] = await Promise.all([
        get(kind === "studio" ? "/api/studio-templates" : "/api/templates"),
        get("/api/passes").catch(() => []),
        get("/api/roster").catch(() => [])
      ]);
      if (kind === "studio") design = await get(`/api/designs/${encodeURIComponent(id)}`);
    } catch {
      if (signal.aborted) return;
      root.innerHTML = `<div class="view"><div class="empty empty--action"><p>Couldn’t load “${esc(id)}”.</p><p class="hint">The API is offline or the template is gone.</p><button type="button" class="btn btn-primary" data-act="templates">Back to Templates</button></div></div>`;
      return;
    }
    if (signal.aborted) return;
    tpl = (Array.isArray(list) ? list : []).find(t => t.id === id && !t.error);
    if (!tpl) {
      root.innerHTML = `<div class="view"><div class="empty empty--action"><p>“${esc(id)}” isn’t available to issue from.</p><p class="hint">It may have been deleted, or its bundle no longer loads.</p><button type="button" class="btn btn-primary" data-act="templates">Back to Templates</button></div></div>`;
      return;
    }
    tpl = { ...tpl, kind };
    existing = new Set((Array.isArray(passes) ? passes : []).map(p => p.serial));
    roster = Array.isArray(ros) ? ros : [];
    baseSlots = templateSlots(tpl);
    setIndividual(defaultIndividual(baseSlots));
    render();
  }

  load();
}
