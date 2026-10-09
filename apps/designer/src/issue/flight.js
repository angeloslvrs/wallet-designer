// Issue workspace · Flight: the values every pass on the trip shares, grouped
// the way an operator reads a flight (identity, route, schedule), with a live
// preview of the shared values and the facts derived from them.

import { DOC_REQUIRED_SEMANTICS } from "@wpd/pass-builder/semantics.js";
import { ROUTE_SEMANTICS } from "@wpd/pass-builder/route.js";
import { esc } from "../esc.js";
import { addableSemantics, canonicalSemantic, effectiveValue, isBlank } from "./model.js";
import { barHtml, footHtml, fieldHtml } from "./shell.js";

const GROUPS = [
  ["Flight", ["airlineCode", "flightNumber", "flightCode"]],
  ["Route", ["departureAirportCode", "destinationAirportCode", "departureGate", "departureTerminal"]],
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
  // Separate rows: a combined "Gate" row read "T1" when only the terminal was set.
  rows.push(["Terminal", v("departureTerminal") ? String(v("departureTerminal")) : ""]);
  rows.push(["Gate", v("departureGate") ? String(v("departureGate")) : ""]);
  rows.push(["Expires", expiry ? `${dayLabel(expiry)} ${hhmm(expiry)}` : arr ? `${dayLabel(arr)} + 1 day` : "arrival + 1 day"]);
  const docKeys = [...new Set(DOC_REQUIRED_SEMANTICS.map(canonicalSemantic))].filter(k => k !== "passengerName");
  const have = docKeys.filter(k => bySem[k] && !isBlank(bySem[k], v(k))).length;
  rows.push(["Apple set", `${have} of ${docKeys.length} flight tags`]);

  const html = rows.map(([k, val]) => `<div class="kv"><span>${esc(k)}</span>${val ? esc(val) : `<span class="is-empty">—</span>`}</div>`).join("");
  return { title, html };
}

// The route editor shows only what a route keeps: route semantics, the schedule
// (its times) and the template's unbound fields — never gates or passenger data.
const SCHEDULE_SEMS = new Set(["currentBoardingDate", "currentDepartureDate", "currentArrivalDate"]);
const routeEditable = (s) => !s.sem || ROUTE_SEMANTICS.has(s.sem) || SCHEDULE_SEMS.has(s.sem);

/** The route's times as a hint: "departs 09:10 · arrives 14:10 · no boarding time". */
export function routeTimesText(route) {
  const s = route?.schedule ?? {};
  const parts = [];
  parts.push(s.boarding ? `boards ${s.boarding}` : "no boarding time");
  if (s.departure) parts.push(`departs ${s.departure}`);
  if (s.arrival) parts.push(`arrives ${s.arrival}${s.arrivalDayOffset ? ` (+${s.arrivalDayOffset} day${s.arrivalDayOffset === 1 ? "" : "s"})` : ""}`);
  return parts.join(" · ");
}

function routeDateHtml(ctx) {
  const picked = Boolean(ctx.flightDate);
  return `
        <div class="iw-field is-wide">
          <label class="iw-label" for="iw-date">Date<span class="iw-req" aria-hidden="true">*</span></label>
          <input id="iw-date" type="date" class="iw-input" value="${esc(ctx.flightDate)}" />
          <span class="iw-hint">${picked ? "Times below come from" : "Pick the day to fill the times below from"} route ${esc(ctx.route.id)}: ${esc(routeTimesText(ctx.route))}${picked ? " — change the date for another day" : ""}</span>
        </div>`;
}

export function flightHtml(ctx) {
  const shared = ctx.slots.filter(s => !ctx.individual.has(s.id) && (!ctx.routeMode || routeEditable(s)));
  const field = (s) => fieldHtml(s, "shared", { values: ctx.shared, touched: ctx.sharedTouched, submitted: ctx.submitted, error: ctx.sharedErrors.find(e => e.slot.id === s.id)?.msg });
  const used = new Set();
  const groups = GROUPS.map(([title, sems]) => {
    const inGroup = sems.map(sem => shared.find(s => s.sem === sem)).filter(Boolean);
    inGroup.forEach(s => used.add(s.id));
    let extra = "";
    if (title === "Flight" && ctx.routeMode) {
      extra = `
        <div class="iw-field">
          <label class="iw-label" for="iw-route-id">Route id<span class="iw-req" aria-hidden="true">*</span></label>
          <input id="iw-route-id" class="iw-input mono" value="${esc(ctx.routeId)}" placeholder="PR2987-MNL-TAC" autocomplete="off" />
          <span class="iw-hint">Names the route on the Templates shelf</span>
        </div>`;
    } else if (title === "Flight") {
      extra = `
        <div class="iw-field">
          <label class="iw-label" for="iw-trip">Trip id<span class="iw-req" aria-hidden="true">*</span></label>
          <input id="iw-trip" class="iw-input mono" value="${esc(ctx.tripId)}" placeholder="RP248@2026-11-02" aria-describedby="err-trip" autocomplete="off" />
          <span class="iw-hint">${ctx.tripIdEdited ? "Typed by hand" : "From the flight code + departure date"} · groups the passes on the Flights board</span>
          <span class="iw-err" id="err-trip">${ctx.submitted && ctx.tripError ? esc(ctx.tripError) : ""}</span>
        </div>`;
    }
    if (title === "Schedule" && !ctx.routeMode) {
      extra = `
        <div class="iw-field is-wide">
          <span class="iw-label" id="lbl-expiry">Pass expiry</span>
          <div class="iw-control" data-expiry-input></div>
          <span class="iw-hint">Blank = arrival + 1 day</span>
        </div>`;
    }
    // Issuing from a route: the Date comes first in Schedule — the route keeps
    // times of day, so nothing below fills until a day is picked.
    const lead = title === "Schedule" && ctx.route && !ctx.routeMode ? routeDateHtml(ctx) : "";
    if (!inGroup.length && !extra && !lead) return "";
    return `<section class="iw-group"><h2>${title}</h2><div class="iw-fields">${lead}${inGroup.map(field).join("")}${extra}</div></section>`;
  }).join("");
  // Everything else — time zones, city names, the template's other values —
  // sits behind one disclosure: usually right from the template's defaults.
  // It opens itself when something inside needs attention.
  const MORE_FIRST = ["departureAirportTimeZone", "destinationAirportTimeZone", "departureCityName", "destinationCityName"];
  const rest = shared.filter(s => !used.has(s.id))
    .sort((a, b) => (MORE_FIRST.indexOf(a.sem) + 1 || 99) - (MORE_FIRST.indexOf(b.sem) + 1 || 99));
  const errIn = rest.filter(s => ctx.sharedErrors.some(e => e.slot.id === s.id));
  const shownErr = errIn.some(s => ctx.submitted || ctx.sharedTouched.has(s.id));
  const tz = (sem) => { const s = rest.find(x => x.sem === sem); return s ? (effectiveValue(s, ctx.shared) || "—") : null; };
  const tzLine = tz("departureAirportTimeZone") && tz("destinationAirportTimeZone") ? `${tz("departureAirportTimeZone")} → ${tz("destinationAirportTimeZone")}` : "";
  const restHtml = rest.length
    ? `<details class="iw-group iw-more" data-more ${ctx.moreOpen || shownErr ? "open" : ""}>
        <summary><span class="iw-more-h">More flight details</span>
          <span class="iw-more-sum">${esc([tzLine, `${rest.length} field${rest.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "))}${errIn.length ? ` · <b class="warn-text">needs ${esc(errIn.map(s => s.label).join(", "))}</b>` : ""}</span></summary>
        <p class="iw-group-sub">Time zones, city names and the rest of the template’s values — usually right as they are.</p>
        <div class="iw-fields">${rest.map(field).join("")}</div>
      </details>`
    : "";

  // Minimum first; any other Apple tag on demand. The route editor only offers
  // what a route keeps.
  const GROUP_LABEL = { flight: "Flight", route: "Route", schedule: "Schedule", passenger: "Per passenger", pricing: "Pricing" };
  const addable = addableSemantics(ctx.slots, ctx.routeMode ? { only: (sem) => ROUTE_SEMANTICS.has(sem) } : {});
  const addHtml = addable.length ? `
            <section class="iw-group iw-add">
              <label class="iw-label" for="iw-add-field">Add an Apple field</label>
              <select id="iw-add-field" class="iw-vary" data-act-change="add-field">
                <option value="">+ Add field…</option>
                ${addable.map(g => `<optgroup label="${esc(GROUP_LABEL[g.group] ?? g.group)}">${g.items.map(i => `<option value="${esc(i.sem)}">${esc(i.label)}</option>`).join("")}</optgroup>`).join("")}
              </select>
              <p class="iw-group-sub">The form starts with what Apple requires and what this template uses. Gate, terminals, loyalty, fare class, special-service badges and more are here when a flight needs them.</p>
            </section>` : "";

  const ind = ctx.slots.filter(s => ctx.individual.has(s.id));
  const chips = ind.map(s => s.perPassenger === "locked"
    ? `<span class="iw-chip is-locked" title="Always per passenger">${esc(s.label)}</span>`
    : `<span class="iw-chip">${esc(s.label)}<button type="button" class="iw-chip-x" data-act="share" data-slot="${esc(s.id)}" aria-label="Share ${esc(s.label)} across the flight">Share</button></span>`).join("");
  const varyOpts = shared.filter(s => s.perPassenger !== "locked")
    .map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");

  const facts = ctx.facts;
  const perPassenger = ctx.routeMode ? "" : `
            <section class="iw-group">
              <h2>Per passenger</h2>
              <p class="iw-group-sub">Everything above is entered once and shared by every pass. These are entered for each passenger instead (or come from their scanned boarding pass). <b>Share</b> moves one back up here; <b>Vary per passenger</b> moves a shared one down.</p>
              <div class="iw-chips">${chips}
                ${varyOpts ? `<select class="iw-vary" data-act-change="vary" aria-label="Vary another field per passenger"><option value="">+ Vary per passenger…</option>${varyOpts}</select>` : ""}
              </div>
            </section>`;
  const head = ctx.routeMode
    ? `<div class="iw-head"><h1>Route</h1><p class="view-sub">What every flight of this route shares — flight number, airports, times. Pick any date in the schedule pickers: only the times are saved. Gates, dates and passengers are set when you issue.</p></div>`
    : `<div class="iw-head"><h1>Flight</h1><p class="view-sub">Shared by every pass on this trip. Grey values are this template’s defaults — type to replace them. Anything here can vary per passenger instead.</p></div>`;
  const primary = ctx.routeMode
    ? `<button type="button" class="btn btn-primary" data-act="route-save" data-primary>Save route</button>`
    : `<button type="button" class="btn btn-primary" data-act="to-passengers" data-primary>Passengers →</button>`;
  const quiet = ctx.routeMode ? "" : `<button type="button" class="btn" data-act="route-mode">${ctx.route ? "Update route" : "Save as route"}</button>`;
  return `
    <div class="iw">
      ${barHtml(ctx, ctx.routeMode ? ctx.routeId : facts.title)}
      <div class="iw-main">
        <div class="iw-flight">
          <section class="iw-form stagger">
            ${head}
            ${groups}
            ${restHtml}${addHtml}${perPassenger}
          </section>
          <aside class="iw-side card">
            <h2 class="iw-side-h">Shared values on the pass</h2>
            <div class="iw-preview iw-preview--sm" data-preview></div>
            <div class="iw-facts" data-facts>${facts.html}</div>
          </aside>
        </div>
      </div>
      ${footHtml({ quiet, primary })}
    </div>`;
}
