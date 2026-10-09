// Issue workspace · Passengers: three panes — how passengers arrive (scan/paste
// first, type, roster) + the list | the selected passenger's pass, Apple-faithful
// | that passenger's own fields, serial, and what it inherits from the flight.

import { esc } from "../esc.js";
import { displayName, initials, slotError } from "./model.js";
import { barHtml, footHtml, fieldHtml } from "./shell.js";

const ORDER = ["sem:passengerName", "sem:seats", "sem:boardingSequenceNumber", "sem:confirmationNumber"];
const byOrder = (a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99);

function rowSub(ctx, p) {
  const v = p.values;
  const seat = v["sem:seats"]?.map?.(s => `${s.seatRow ?? ""}${s.seatNumber ?? ""}`).join(", ");
  const seq = v["sem:boardingSequenceNumber"];
  const tail = p.serial ? `…${p.serial.slice(-4)}` : "no serial";
  return [seat, seq ? `seq ${seq}` : "", tail].filter(Boolean).join(" · ");
}

export function paxListHtml(ctx) {
  if (!ctx.pax.length) {
    return `<p class="iw-empty">No passengers yet. Paste boarding-pass barcodes above, or switch to Type.</p>`;
  }
  return ctx.pax.map((p, i) => {
    const problems = ctx.paxProblems(i, ctx.serials);
    const shown = ctx.submitted || p.touched.size > 0;
    const st = problems.length && shown ? ["fix", "is-err"]
      : problems.length ? ["to do", "is-todo"]
        : p.warn.length ? ["check", "is-warn"]
          : ctx.serials.updates.has(i) ? ["update", "is-warn"] : ["ready", "is-ok"];
    const name = displayName(p.values) || "Unnamed passenger";
    return `
      <div class="iw-p ${i === ctx.sel ? "is-on" : ""}">
        <button type="button" class="iw-p-main" data-act="pax" data-i="${i}" ${i === ctx.sel ? 'aria-current="true"' : ""}>
          <span class="iw-av" aria-hidden="true">${esc(initials(p.values))}</span>
          <span class="iw-nm">${esc(name)}<small>${esc(rowSub(ctx, p))}</small></span>
          <span class="iw-st ${st[1]}">${st[0]}</span>
        </button>
        <button type="button" class="iw-p-rm" data-act="pax-rm" data-i="${i}" aria-label="Remove ${esc(name)}">Remove</button>
      </div>`;
  }).join("");
}

export function pagerHtml(ctx) {
  if (!ctx.pax.length) return `<div class="iw-pager" data-pager></div>`;
  const name = displayName(ctx.pax[ctx.sel]?.values) || "Unnamed passenger";
  return `<div class="iw-pager" data-pager>
      <button type="button" class="btn btn-sm" data-act="prev" aria-label="Previous passenger" ${ctx.pax.length < 2 ? "disabled" : ""}>‹</button>
      <span>${esc(name)} · ${ctx.sel + 1} of ${ctx.pax.length}</span>
      <button type="button" class="btn btn-sm" data-act="next" aria-label="Next passenger" ${ctx.pax.length < 2 ? "disabled" : ""}>›</button>
    </div>`;
}

function modePane(ctx) {
  if (ctx.mode === "type") {
    return `<div class="iw-mode">
        <p class="iw-group-sub">Add a blank passenger and fill their fields on the right.</p>
        <button type="button" class="btn" data-act="type-add">Add a passenger</button>
      </div>`;
  }
  if (ctx.mode === "roster") {
    const chips = ctx.roster.map(en => {
      const n = en.semantics?.passengerName;
      const name = typeof n === "string" ? n : [n?.givenName, n?.familyName].filter(Boolean).join(" ") || "?";
      const label = en.label ? `${en.label} · ${name}` : name;
      return ctx.rosterEdit
        ? `<span class="iw-chip">${esc(label)}<button type="button" class="iw-chip-x" data-act="roster-del" data-id="${esc(en.id)}" aria-label="Remove ${esc(label)} from saved passengers">Remove</button></span>`
        : `<button type="button" class="iw-chip iw-chip--add" data-act="roster-add" data-id="${esc(en.id)}">${esc(label)}</button>`;
    }).join("");
    return `<div class="iw-mode">
        ${ctx.roster.length ? `<div class="iw-chips">${chips}</div>
          <button type="button" class="btn-link" data-act="roster-edit">${ctx.rosterEdit ? "Done" : "Edit saved passengers"}</button>`
        : `<p class="iw-group-sub">No saved passengers yet. Save one from their fields on the right and they’ll appear here for every flight.</p>`}
      </div>`;
  }
  const errs = ctx.pasteReport.map(r => `<li>Line ${r.line}: ${esc(r.error)}</li>`).join("");
  return `<div class="iw-mode">
      <label class="iw-label" for="iw-paste">Boarding-pass barcodes, one per line</label>
      <textarea id="iw-paste" class="iw-paste mono" rows="4" spellcheck="false" placeholder="M1SOLIVERES/ANGELO  E5J5056 MNLNRT5J 5056 288Y014A0042 100"></textarea>
      ${errs ? `<ul class="iw-paste-errs" role="alert">${errs}</ul>` : ""}
      <div class="iw-mode-acts">
        <button type="button" class="btn" data-act="paste-add">Add from paste</button>
        <button type="button" class="btn-link" data-act="scan">Camera or photo…</button>
      </div>
    </div>`;
}

function rightPane(ctx) {
  const p = ctx.pax[ctx.sel];
  const flightLink = `<button type="button" class="btn-link" data-act="edit-flight">Edit flight</button>`;
  const fromFlight = `<h2 class="iw-side-h">From the flight</h2><div class="iw-facts">${ctx.facts.html}</div>
    ${ctx.sharedErrors.length || ctx.tripError ? `<p class="iw-note ${ctx.submitted ? "is-err" : "is-todo"}">The flight still needs: ${esc([...ctx.sharedErrors.map(e => e.slot.label), ...(ctx.tripError ? ["trip id"] : [])].join(", "))}.</p>` : ""}
    ${flightLink}`;
  if (!p) return `<aside class="iw-right"><p class="iw-empty">Add a passenger to edit their fields here.</p>${fromFlight}</aside>`;
  const values = ctx.valuesFor(p);
  const fields = ctx.slots.filter(s => ctx.individual.has(s.id)).sort(byOrder)
    .map(s => fieldHtml(s, "pax", { values, touched: p.touched, submitted: ctx.submitted, error: slotError(s, values) })).join("");
  const rep = ctx.serials;
  const reveal = ctx.submitted || p.touched.has("serial");
  const serialNote = rep.duplicates.has(ctx.sel) && reveal ? ["is-err", "Another passenger in this batch has this serial — each pass needs its own."]
    : rep.updates.has(ctx.sel) ? ["is-warn", "Already issued — issuing updates that pass on every device that has it."]
      : rep.missing.has(ctx.sel) && ctx.submitted ? ["is-err", "Needs a serial — set the flight’s trip id or type one."] : ["", ""];
  const warn = p.warn.length ? `<p class="iw-note is-warn">This boarding pass is for ${esc(p.warn.join(", "))} — check it belongs on this flight.</p>` : "";
  return `
    <aside class="iw-right">
      <h2 class="iw-side-h">This passenger</h2>
      ${warn}
      <div class="iw-fields iw-fields--one">${fields}
        <div class="iw-field">
          <label class="iw-label" for="iw-serial">Serial</label>
          <input id="iw-serial" class="iw-input mono" data-serial value="${esc(p.serial)}" autocomplete="off" aria-describedby="iw-serial-note" />
          <span class="iw-hint">${p.serialEdited ? "Typed by hand" : "Suggested from the trip id"} · unique per pass</span>
          <span class="iw-note ${serialNote[0]}" id="iw-serial-note" data-serial-note>${esc(serialNote[1])}</span>
        </div>
      </div>
      <div class="iw-roster-save">
        <input id="iw-roster-label" class="iw-input" placeholder="Label (optional), e.g. DAD" aria-label="Roster label" />
        <button type="button" class="btn btn-sm" data-act="roster-save">Save to roster</button>
        <span class="iw-hint" data-roster-status role="status"></span>
      </div>
      ${fromFlight}
    </aside>`;
}

export function passengersHtml(ctx) {
  const tabs = [["scan", "Scan / paste"], ["type", "Type"], ["roster", "Roster"]]
    .map(([k, label]) => `<button type="button" role="tab" class="iw-tab" data-act="mode" data-mode="${k}" aria-selected="${ctx.mode === k}">${label}</button>`).join("");
  const ptabs = [["front", "Front"], ["back", "Back"], ["detail", "iOS 26 detail"]]
    .map(([k, label]) => `<button type="button" role="tab" class="iw-tab" data-act="tab" data-tab="${k}" aria-selected="${ctx.previewTab === k}">${label}</button>`).join("");
  return `
    <div class="iw">
      ${barHtml(ctx, ctx.facts.title)}
      <div class="iw-main">
        <div class="iw-pax">
          <section class="iw-left">
            <div class="iw-head"><h1>Passengers</h1><p class="view-sub">Scan or paste boarding passes. Everything else comes from the flight.</p></div>
            <div class="iw-tabs" role="tablist" aria-label="Add passengers by">${tabs}</div>
            ${modePane(ctx)}
            <h2 class="iw-side-h">On this flight · ${ctx.pax.length}</h2>
            <div class="iw-plist" data-pax-list>${paxListHtml(ctx)}</div>
          </section>
          <section class="iw-canvas">
            <div class="iw-tabs iw-tabs--center" role="tablist" aria-label="Pass side">${ptabs}</div>
            <div class="iw-preview iw-preview--lg" data-preview></div>
            ${pagerHtml(ctx)}
          </section>
          ${rightPane(ctx)}
        </div>
      </div>
      ${footHtml({ primary: `<button type="button" class="btn btn-primary" data-act="issue" data-primary>Issue passes</button>` })}
    </div>`;
}
