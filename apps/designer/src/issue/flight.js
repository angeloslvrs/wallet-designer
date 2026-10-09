// Issue workspace · Flight: the values every pass on the trip shares, grouped
// the way an operator reads a flight (identity, route, schedule), with a live
// preview of the shared values and the facts derived from them.

import { DOC_REQUIRED_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { esc } from "../esc.js";
import { canonicalSemantic, effectiveValue, isBlank } from "./model.js";
import { barHtml, footHtml, fieldHtml } from "./shell.js";

const GROUPS = [
  ["Flight", ["airlineCode", "flightNumber", "flightCode"]],
  ["Route", ["departureAirportCode", "destinationAirportCode", "departureCityName", "destinationCityName", "departureGate", "departureTerminal", "departureAirportTimeZone", "destinationAirportTimeZone"]],
  ["Schedule", ["currentBoardingDate", "currentDepartureDate", "currentArrivalDate"]]
];

const hhmm = (iso) => (typeof iso === "string" ? (/T(\d{2}:\d{2})/.exec(iso)?.[1] ?? "") : "");
const dayLabel = (iso) => {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
};
const offset = (iso) => (typeof iso === "string" ? (/([+-]\d{2}):?(\d{2})$|Z$/.exec(iso)?.[0] ?? "") : "");

/**
 * Title + derived facts of the flight as it stands (shared values with derived
 * and template-default fallbacks): route, duration, boards/departs, expiry and
 * how much of Apple's required boarding set is present.
 * @returns {{title: string, html: string}}
 */
export function flightFacts(slots, shared, expiry) {
  const bySem = Object.fromEntries(slots.filter(s => s.sem).map(s => [s.sem, s]));
  const v = (sem) => (bySem[sem] ? effectiveValue(bySem[sem], shared) : undefined);
  const airline = v("airlineCode"), number = v("flightNumber");
  const flight = airline && number !== undefined && number !== "" ? `${airline} ${number}` : (v("flightCode") ?? "");
  const dep = v("currentDepartureDate"), arr = v("currentArrivalDate"), board = v("currentBoardingDate");
  const title = [flight, dayLabel(dep)].filter(Boolean).join(" · ");

  const rows = [];
  const from = v("departureAirportCode"), to = v("destinationAirportCode");
  rows.push(["Route", from || to ? `${from ?? "—"} → ${to ?? "—"}` : ""]);
  const ms = Date.parse(arr) - Date.parse(dep);
  rows.push(["Duration", Number.isFinite(ms) && ms > 0 ? `${Math.floor(ms / 3.6e6)} h ${Math.round((ms % 3.6e6) / 6e4)} m` : ""]);
  rows.push(["Boards", board ? `${hhmm(board)} ${offset(board)}` : ""]);
  rows.push(["Departs", dep ? `${hhmm(dep)} ${offset(dep)}` : ""]);
  rows.push(["Gate", [v("departureGate"), v("departureTerminal") ? `T${String(v("departureTerminal")).replace(/^T/i, "")}` : ""].filter(Boolean).join(" · ")]);
  rows.push(["Expires", expiry ? `${dayLabel(expiry)} ${hhmm(expiry)}` : arr ? `${dayLabel(arr)} + 1 day` : "arrival + 1 day"]);
  const docKeys = [...new Set(DOC_REQUIRED_SEMANTICS.map(canonicalSemantic))].filter(k => k !== "passengerName");
  const have = docKeys.filter(k => bySem[k] && !isBlank(bySem[k], v(k))).length;
  rows.push(["Apple set", `${have} of ${docKeys.length} flight tags`]);

  const html = rows.map(([k, val]) => `<div class="kv"><span>${esc(k)}</span>${val ? esc(val) : `<span class="is-empty">—</span>`}</div>`).join("");
  return { title, html };
}

export function flightHtml(ctx) {
  const shared = ctx.slots.filter(s => !ctx.individual.has(s.id));
  const field = (s) => fieldHtml(s, "shared", { values: ctx.shared, touched: ctx.sharedTouched, submitted: ctx.submitted, error: ctx.sharedErrors.find(e => e.slot.id === s.id)?.msg });
  const used = new Set();
  const groups = GROUPS.map(([title, sems]) => {
    const inGroup = sems.map(sem => shared.find(s => s.sem === sem)).filter(Boolean);
    inGroup.forEach(s => used.add(s.id));
    let extra = "";
    if (title === "Flight") {
      extra = `
        <div class="iw-field">
          <label class="iw-label" for="iw-trip">Trip id<span class="iw-req" aria-hidden="true">*</span></label>
          <input id="iw-trip" class="iw-input mono" value="${esc(ctx.tripId)}" placeholder="RP248@2026-11-02" aria-describedby="err-trip" autocomplete="off" />
          <span class="iw-hint">${ctx.tripIdEdited ? "Typed by hand" : "From the flight code + departure date"} · groups the passes on the Flights board</span>
          <span class="iw-err" id="err-trip">${ctx.submitted && ctx.tripError ? esc(ctx.tripError) : ""}</span>
        </div>`;
    }
    if (title === "Schedule") {
      extra = `
        <div class="iw-field is-wide">
          <span class="iw-label" id="lbl-expiry">Pass expiry</span>
          <div class="iw-control" data-expiry-input></div>
          <span class="iw-hint">Blank = arrival + 1 day</span>
        </div>`;
    }
    if (!inGroup.length && !extra) return "";
    return `<section class="iw-group"><h2>${title}</h2><div class="iw-fields">${inGroup.map(field).join("")}${extra}</div></section>`;
  }).join("");
  const rest = shared.filter(s => !used.has(s.id));
  const restHtml = rest.length
    ? `<section class="iw-group"><h2>Also on this pass</h2><div class="iw-fields">${rest.map(field).join("")}</div></section>`
    : "";

  const ind = ctx.slots.filter(s => ctx.individual.has(s.id));
  const chips = ind.map(s => s.perPassenger === "locked"
    ? `<span class="iw-chip is-locked" title="Always per passenger">${esc(s.label)}</span>`
    : `<span class="iw-chip">${esc(s.label)}<button type="button" class="iw-chip-x" data-act="share" data-slot="${esc(s.id)}" aria-label="Share ${esc(s.label)} across the flight">Share</button></span>`).join("");
  const varyOpts = shared.filter(s => s.perPassenger !== "locked")
    .map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");

  const facts = ctx.facts;
  return `
    <div class="iw">
      ${barHtml(ctx, facts.title)}
      <div class="iw-main">
        <div class="iw-flight">
          <section class="iw-form stagger">
            <div class="iw-head"><h1>Flight</h1><p class="view-sub">Shared by every pass on this trip. Anything here can vary per passenger instead.</p></div>
            ${groups}
            ${restHtml}
            <section class="iw-group">
              <h2>Per passenger</h2>
              <p class="iw-group-sub">Entered on each passenger, not here.</p>
              <div class="iw-chips">${chips}
                ${varyOpts ? `<select class="iw-vary" data-act-change="vary" aria-label="Vary another field per passenger"><option value="">+ Vary per passenger…</option>${varyOpts}</select>` : ""}
              </div>
            </section>
          </section>
          <aside class="iw-side card">
            <h2 class="iw-side-h">Shared values on the pass</h2>
            <div class="iw-preview iw-preview--sm" data-preview></div>
            <div class="iw-facts" data-facts>${facts.html}</div>
          </aside>
        </div>
      </div>
      ${footHtml({ primary: `<button type="button" class="btn btn-primary" data-act="to-passengers" data-primary>Passengers →</button>` })}
    </div>`;
}
