// Issue workspace — pure model (no DOM). Unit-tested in tests/issue-model.test.js.
//
// Semantics-first: the operator enters Apple's semantic values once (typed:
// names, seats, ISO dates, IANA zones) and every visible field BOUND to a
// semantic is derived from it — never typed twice, never guessed from a field
// key's name (polarity rule). Template fields with no bound semantic are entered
// raw, by key. Both template kinds go through the same slots:
//   designer — a Pass Designer bundle (POST /api/passes {template, data, …})
//   studio   — a saved FormState design (POST /api/passes FormState + designName)
// Each kind ships the same merge surface (fieldKeys / fields / bindings /
// semantics) from GET /api/templates and GET /api/studio-templates.

import { SEMANTIC_CATALOG, REQUIRED_SEMANTICS, DOC_REQUIRED_SEMANTICS, SEMANTIC_DATE_KEYS, TIMEZONE_KEY_ALIASES } from "@wpd/pass-builder/semantics.js";
import { formatSemanticValue } from "@wpd/pass-builder/suggest.js";
import { isEmptyTyped } from "@wpd/pass-builder/suggest-empty.js";
import { semanticKind, validateFieldValue } from "@wpd/pass-builder/field-kinds.js";

const SERIAL_PAD = 3;

// ---- carried over from the old Issue view (same contracts) ------------------

/**
 * Compose the trip groupId, e.g. ("RP247", "2026-06-20") → "RP247@2026-06-20".
 * @returns {string} empty when either piece is missing
 */
export function composeGroupId(flight, date) {
  const f = (flight ?? "").toString().trim().toUpperCase().replace(/\s+/g, "");
  const d = (date ?? "").trim();
  return f && d ? `${f}@${d}` : "";
}

/**
 * Suggested serial for passenger n (1-based): <groupId>-<NNN>.
 * @returns {string} empty when there is no groupId yet
 */
export function suggestSerial(groupId, n) {
  const g = (groupId ?? "").trim();
  return g ? `${g}-${String(n).padStart(SERIAL_PAD, "0")}` : "";
}

/**
 * Suggested serials for a batch: <groupId>-NNN, skipping numbers already issued
 * (adding passengers to an existing flight must not default to overwriting
 * its passes) and serials the operator typed by hand.
 * @param {string} groupId
 * @param {(string|null)[]} fixed per passenger: a hand-typed serial, or null to suggest
 * @param {Set<string>} existing serials already on the server
 * @returns {string[]}
 */
export function suggestSerials(groupId, fixed, existing = new Set()) {
  const taken = new Set([...existing, ...fixed.filter(Boolean)]);
  let n = 0;
  return fixed.map(f => {
    if (f) return f;
    if (!(groupId ?? "").trim()) return "";
    let s;
    do s = suggestSerial(groupId, ++n); while (taken.has(s));
    taken.add(s);
    return s;
  });
}

/**
 * One passenger's values: the trip's shared values overlaid with this row's
 * values for the keys marked individual. A shared value for an individual key
 * is dropped — it belongs to the row — so re-sharing never leaks a stale value.
 * @returns {Record<string, *>}
 */
export function mergeTripValues(sharedValues = {}, rowValues = {}, individualKeys = []) {
  const ind = individualKeys instanceof Set ? individualKeys : new Set(individualKeys);
  const out = {};
  for (const [k, v] of Object.entries(sharedValues)) if (!ind.has(k)) out[k] = v;
  for (const k of ind) if (rowValues[k] !== undefined) out[k] = rowValues[k];
  return out;
}

/**
 * Copy text to the clipboard, reporting real success. Falls back to a hidden
 * textarea + execCommand where the async API is missing (plain-http LAN).
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (text == null) return false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// ---- slots --------------------------------------------------------------------

// Aliases collapse into one slot: a binding to an original* date or a
// *LocationTimeZone edits the same value as its current* / *AirportTimeZone twin.
const DATE_TWIN = {
  originalBoardingDate: "currentBoardingDate", originalDepartureDate: "currentDepartureDate", originalArrivalDate: "currentArrivalDate"
};
const TZ_TWIN = Object.fromEntries(Object.entries(TIMEZONE_KEY_ALIASES).map(([a, b]) => (/Location/.test(a) ? [a, b] : [b, a])));
/** The slot a semantic key is edited through. */
export const canonicalSemantic = (sem) => DATE_TWIN[sem] ?? TZ_TWIN[sem] ?? sem;
const ORIGINAL_OF = Object.fromEntries(Object.entries(DATE_TWIN).map(([o, c]) => [c, o]));
const LOCATION_OF = Object.fromEntries(Object.entries(TZ_TWIN).map(([l, a]) => [a, l]));

// Placeholders the server clears at issue unless provided (VOLATILE_ISSUE_SEMANTICS
// in apps/server/src/template-status.js): a template's sample schedule and
// sample passenger must never ship as if they were real.
export const VOLATILE_SEMANTICS = new Set([...SEMANTIC_DATE_KEYS, "passengerName", "seats"]);

// Always per passenger (can't be shared): who sits where.
export const PER_PASSENGER_LOCKED = new Set(["passengerName", "seats"]);
// Start per passenger but can be shared (a family on one booking).
const PER_PASSENGER_DEFAULT = ["boardingSequenceNumber", "confirmationNumber", "boardingGroup", "boardingZone", "ticketFareClass", "membershipProgramNumber"];

// Every passenger can carry these, bound or not (scan + roster land here).
const PASSENGER_CORE = ["passengerName", "seats", "boardingSequenceNumber", "confirmationNumber"];
// The flight step always offers these, bound or not, in this order.
const FLIGHT_CORE = [
  "airlineCode", "flightNumber", "flightCode",
  "departureAirportCode", "destinationAirportCode",
  "departureCityName", "destinationCityName",
  "departureGate", "departureTerminal",
  "currentBoardingDate", "currentDepartureDate", "currentArrivalDate",
  "departureAirportTimeZone", "destinationAirportTimeZone"
];
const REQUIRED = new Set(REQUIRED_SEMANTICS.map(canonicalSemantic));
const RECOMMENDED = new Set(DOC_REQUIRED_SEMANTICS.map(canonicalSemantic).filter(k => !REQUIRED.has(k)));

const LABELS = {
  airlineCode: "Airline", flightNumber: "Flight number", flightCode: "Flight code",
  departureAirportCode: "From", destinationAirportCode: "To",
  departureCityName: "From city", destinationCityName: "To city",
  departureGate: "Gate", departureTerminal: "Terminal",
  currentBoardingDate: "Boarding", currentDepartureDate: "Departure", currentArrivalDate: "Arrival",
  departureAirportTimeZone: "Time zone · from", destinationAirportTimeZone: "Time zone · to",
  passengerName: "Passenger", seats: "Seat", boardingSequenceNumber: "Sequence",
  confirmationNumber: "Booking ref", boardingGroup: "Boarding group", boardingZone: "Zone",
  ticketFareClass: "Fare class", membershipProgramNumber: "Frequent flyer #"
};

/** The input widget a semantic renders with (inputs.js renderTypedInput types). */
export function semanticWidget(sem) {
  if (/TimeZone$/.test(sem)) return "timezone";
  return SEMANTIC_CATALOG[sem]?.type ?? "text";
}

/**
 * The editable slots of a template, in display order.
 * A slot is a semantic (`sem:<key>`, typed, possibly bound to a visible field)
 * or an unbound template field (`field:<key>`, entered raw).
 * @param {{fields?: object[], bindings?: object, semantics?: object, preview?: object}} tpl
 * @returns {{id:string, sem?:string, fieldKey?:string, fieldKeys:string[], label:string,
 *            widget:string, kind:string, required:boolean, recommended:boolean,
 *            perPassenger:"locked"|"default"|null, fallback:*}[]}
 */
export function templateSlots(tpl) {
  const fields = tpl?.fields ?? [];
  const baked = tpl?.semantics ?? {};
  const fieldByKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const fieldValues = previewFieldValues(tpl?.preview);
  const boundTo = {};   // canonical semantic → [fieldKey…] it drives
  for (const f of fields) {
    if (!f.boundSemantic) continue;
    const c = canonicalSemantic(f.boundSemantic);
    (boundTo[c] ??= []).push(f.key);
  }
  const semSlot = (sem) => {
    const fks = boundTo[sem] ?? [];
    const first = fieldByKey[fks[0]];
    const volatile = VOLATILE_SEMANTICS.has(sem);
    const bakedValue = baked[sem] ?? (ORIGINAL_OF[sem] ? baked[ORIGINAL_OF[sem]] : undefined) ?? (sem.endsWith("AirportTimeZone") ? baked[sem.replace("Airport", "Location")] : undefined);
    return {
      id: `sem:${sem}`, sem, fieldKeys: fks,
      label: LABELS[sem] ?? SEMANTIC_CATALOG[sem]?.label ?? first?.label ?? sem,
      widget: semanticWidget(sem), kind: semanticKind(sem),
      required: REQUIRED.has(sem), recommended: RECOMMENDED.has(sem),
      perPassenger: PER_PASSENGER_LOCKED.has(sem) ? "locked" : PER_PASSENGER_DEFAULT.includes(sem) ? "default" : null,
      // Blank = this value ships (template default) — never for volatile placeholders.
      fallback: volatile || isEmptyTyped(SEMANTIC_CATALOG[sem]?.type ?? "text", bakedValue) ? undefined : bakedValue
    };
  };
  const out = [];
  const seen = new Set();
  const push = (slot) => { if (!seen.has(slot.id)) { seen.add(slot.id); out.push(slot); } };
  for (const sem of FLIGHT_CORE) push(semSlot(sem));
  for (const sem of PASSENGER_CORE) push(semSlot(sem));
  for (const sem of Object.keys(boundTo)) if (SEMANTIC_CATALOG[sem]) push(semSlot(sem));
  for (const sem of REQUIRED) if (SEMANTIC_CATALOG[sem]) push(semSlot(sem));
  const fc = out.find(x => x.sem === "flightCode");
  if (fc) fc.deriveFrom = { airlineCode: out.find(x => x.sem === "airlineCode")?.fallback, flightNumber: out.find(x => x.sem === "flightNumber")?.fallback };
  for (const f of fields) {
    if (f.boundSemantic && SEMANTIC_CATALOG[canonicalSemantic(f.boundSemantic)]) continue;
    const widget = f.kind === "date" ? "date" : "text";
    push({
      id: `field:${f.key}`, fieldKey: f.key, fieldKeys: [f.key],
      label: f.label || f.key, widget, kind: f.kind ?? "text",
      required: false, recommended: false, perPassenger: null,
      fallback: fieldValues[f.key]
    });
  }
  return out;
}

/** { fieldKey: value } across every field zone of a pass.json. */
export function previewFieldValues(passJson) {
  const out = {};
  const style = passJson?.boardingPass ?? {};
  for (const zone of ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields", "additionalInfoFields"]) {
    for (const f of style[zone] ?? []) if (f?.key && out[f.key] === undefined) out[f.key] = f.value;
  }
  return out;
}

/** Slot ids that start per passenger. */
export function defaultIndividual(slots) {
  return new Set(slots.filter(s => s.perPassenger).map(s => s.id));
}

/** Whether a slot value is empty for its widget. */
export function isBlank(slot, v) {
  if (slot.sem) return isEmptyTyped(SEMANTIC_CATALOG[slot.sem]?.type ?? "text", v);
  return v == null || String(v).trim() === "";
}

/**
 * A blank slot's value derived from other slots: flightCode = airline + number
 * (each typed, else its template default) — only once either is typed, so an
 * untouched template keeps its own code. The flightCode slot carries the
 * defaults it needs (`deriveFrom`), so callers never thread the slot list.
 * @returns {*} undefined when nothing derives
 */
export function deriveFor(slot, values) {
  if (slot?.sem !== "flightCode") return undefined;
  const typed = (id) => { const v = values[id]; return v !== undefined && v !== null && String(v).trim() !== ""; };
  if (!typed("sem:airlineCode") && !typed("sem:flightNumber")) return undefined;
  const al = (typed("sem:airlineCode") ? values["sem:airlineCode"] : slot.deriveFrom?.airlineCode ?? "").toString().trim().toUpperCase();
  const no = typed("sem:flightNumber") ? values["sem:flightNumber"] : slot.deriveFrom?.flightNumber;
  return al && no !== undefined && no !== "" ? `${al}${no}` : undefined;
}

/**
 * The slots as issued: per-passenger slots lose their template default — a
 * template's sample sequence number or booking ref must never ship as if it
 * were this passenger's. Blank per-passenger values clear instead.
 */
export function issueSlots(slots, individual) {
  return slots.map(s => (individual.has(s.id) ? { ...s, fallback: undefined, clearsWhenBlank: true } : s));
}

/** The value a slot will actually ship with: typed → derived → template default. */
export function effectiveValue(slot, values) {
  const v = values[slot.id];
  if (!isBlank(slot, v)) return v;
  const d = deriveFor(slot, values);
  if (d !== undefined) return d;
  return slot.fallback;
}

/**
 * Validation message for one slot value (null when fine). Required slots are
 * satisfied by a derived value or a non-volatile template default.
 */
export function slotError(slot, values) {
  const own = values[slot.id];
  if (!isBlank(slot, own)) {
    if (slot.sem === "passengerName") {
      return (own.givenName ?? "").trim() || (own.familyName ?? "").trim() ? null : "Enter a name";
    }
    if (slot.sem === "seats") {
      return own.every(s => s.seatRow && s.seatNumber) ? null : "Seats look like 14A, 14B";
    }
    if (["personName", "seats", "boolean", "stringArray", "location", "currency", "capabilities"].includes(slot.widget)) return null;
    return validateFieldValue({ kind: slot.kind, required: false }, String(own));
  }
  if (!slot.required) return null;
  return isBlank(slot, effectiveValue(slot, values)) ? "Required" : null;
}

// ---- trip id ------------------------------------------------------------------

/** The trip id a flight's values compose to: <flightCode>@<departure date>. */
export function tripIdFrom(values, slots) {
  const bySem = Object.fromEntries(slots.filter(s => s.sem).map(s => [s.sem, s]));
  const flight = bySem.flightCode ? effectiveValue(bySem.flightCode, values) : undefined;
  const dep = bySem.currentDepartureDate ? effectiveValue(bySem.currentDepartureDate, values) : undefined;
  const date = typeof dep === "string" ? dep.slice(0, 10) : "";
  return composeGroupId(flight, date);
}

// ---- BCBP --------------------------------------------------------------------

// Per-passenger semantics a boarding-pass barcode carries. Flight-level ones
// (airline, number, airports) describe the trip, not the passenger.
const BCBP_PASSENGER_KEYS = ["passengerName", "seats", "boardingSequenceNumber", "confirmationNumber"];
const BCBP_FLIGHT_KEYS = ["airlineCode", "flightNumber", "departureAirportCode", "destinationAirportCode"];

/**
 * Split pasted text into one BCBP per non-empty line and parse each.
 * @param {string} text
 * @param {(raw:string)=>object} parse   parseBCBP
 * @param {(parsed:object)=>object} toSemantics   bcbpToSemantics
 * @returns {{line:number, raw:string, ok:boolean, error?:string, passenger?:object, flight?:object}[]}
 */
export function parseBcbpLines(text, parse, toSemantics) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const raw = line.replace(/\s+$/, "");
    if (!raw.trim()) return;
    let parsed;
    try { parsed = parse(raw); } catch (err) { out.push({ line: i + 1, raw, ok: false, error: err.message }); return; }
    const sem = toSemantics(parsed);
    const pick = (keys) => Object.fromEntries(keys.filter(k => sem[k] !== undefined).map(k => [`sem:${k}`, sem[k]]));
    out.push({ line: i + 1, raw, ok: true, passenger: pick(BCBP_PASSENGER_KEYS), flight: pick(BCBP_FLIGHT_KEYS), flightDate: parsed.flightDate });
  });
  return out;
}

/**
 * Which of a scanned pass's flight facts disagree with the trip (both set and
 * different). Empty when it belongs to this flight.
 * @returns {string[]} human labels, e.g. ["flight 5J5057"]
 */
export function bcbpMismatch(flightFromBcbp, tripValues, slots) {
  const bySem = Object.fromEntries(slots.filter(s => s.sem).map(s => [s.id, s]));
  const out = [];
  for (const [id, v] of Object.entries(flightFromBcbp ?? {})) {
    const slot = bySem[id];
    if (!slot) continue;
    const trip = effectiveValue(slot, tripValues);
    if (isBlank(slot, trip)) continue;
    if (String(trip).toUpperCase() !== String(v).toUpperCase()) out.push(`${slot.label.toLowerCase()} ${v}`);
  }
  return out;
}

// ---- serials -------------------------------------------------------------------

/**
 * Serial problems across the batch: in-batch duplicates block; serials that
 * already exist on the server will UPDATE that pass (allowed, but said so).
 * @param {string[]} serials one per passenger
 * @param {Set<string>} existing serials already issued
 * @returns {{duplicates:Set<number>, updates:Set<number>, missing:Set<number>}}
 */
export function serialReport(serials, existing) {
  const seen = new Map();
  const duplicates = new Set(), updates = new Set(), missing = new Set();
  serials.forEach((raw, i) => {
    const s = (raw ?? "").trim();
    if (!s) { missing.add(i); return; }
    if (seen.has(s)) { duplicates.add(i); duplicates.add(seen.get(s)); } else seen.set(s, i);
    if (existing?.has(s)) updates.add(i);
  });
  return { duplicates, updates, missing };
}

/** The Issue button's honest label: "Issue 2 passes", "Issue 1 · update 1", "Update 1 pass". */
export function issueLabel(total, updates) {
  const fresh = total - updates;
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "es"}`;
  if (!updates) return `Issue ${n(total, "pass")}`;
  if (!fresh) return `Update ${n(updates, "pass")}`;
  return `Issue ${fresh} · update ${updates}`;
}

// ---- issue bodies --------------------------------------------------------------

/**
 * The semantics one passenger's pass carries (filled-only, twins set). A blank
 * per-passenger slot (issueSlots) is sent as null — the template merge deletes
 * the baked sample value; studio bodies drop the key.
 */
export function passengerSemantics(slots, values) {
  const out = {};
  const put = (sem, v) => {
    out[sem] = v;
    // One slot writes both spellings, so a template's baked twin can't disagree:
    if (ORIGINAL_OF[sem]) out[ORIGINAL_OF[sem]] = v;   // at issue, scheduled = current
    if (LOCATION_OF[sem]) out[LOCATION_OF[sem]] = v;   // *AirportTimeZone ↔ *LocationTimeZone
  };
  for (const slot of slots) {
    if (!slot.sem) continue;
    const own = values[slot.id];
    const v = isBlank(slot, own) ? deriveFor(slot, values) : own;
    if (v === undefined || isBlank(slot, v)) { if (slot.clearsWhenBlank) put(slot.sem, null); continue; }
    put(slot.sem, slot.sem === "passengerName" ? { givenName: (v.givenName ?? "").trim(), familyName: (v.familyName ?? "").trim() } : v);
  }
  return out;
}

const dropNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

/**
 * Visible field values one passenger's pass carries, by field key: bound fields
 * derived from their semantic (dates stay ISO — the field's date style formats
 * them on device), unbound fields raw. Blank slots are left out so the template
 * value applies — except volatile placeholders bound to a field (a sample seat
 * must not ship), which are blanked.
 * @returns {Record<string,string>}
 */
export function passengerFieldValues(slots, values) {
  const out = {};
  for (const slot of slots) {
    for (const fk of slot.fieldKeys ?? []) {
      const own = values[slot.id];
      const v = isBlank(slot, own) ? deriveFor(slot, values) : own;
      if (v === undefined || isBlank(slot, v)) {
        if (slot.clearsWhenBlank || (slot.sem && VOLATILE_SEMANTICS.has(slot.sem))) out[fk] = "";
        continue;
      }
      if (!slot.sem) out[fk] = String(v).trim();
      else if (slot.kind === "date") out[fk] = String(v);
      else out[fk] = formatSemanticValue(slot.sem, v);
    }
  }
  return out;
}

/** POST /api/passes body for a designer (template) pass. */
export function buildTemplateIssueBody({ template, groupId, serial, slots, values, barcodeMessage, expirationDate }) {
  const data = { ...passengerFieldValues(slots, values) };
  const sem = passengerSemantics(slots, values);
  if (Object.keys(sem).length) data.semantics = sem;
  const s = (serial ?? "").trim();
  data.barcodeMessage = (barcodeMessage ?? "").trim() || s;
  data.barcodeAltText = s;
  const exp = (expirationDate ?? "").trim();
  if (exp) data.expirationDate = exp;
  return { template, serialNumber: s, groupId: (groupId ?? "").trim(), data };
}

/**
 * POST /api/passes body for a studio (FormState) pass: the design with its
 * sample passenger/schedule removed, this passenger's semantics merged in, bound
 * display fields rewritten by key, and per-pass identity set.
 */
export function buildStudioIssueBody({ design, designName, groupId, serial, slots, values, barcodeMessage, expirationDate }) {
  const state = structuredClone(design);
  const s = (serial ?? "").trim();
  const base = { ...(state.semantics ?? {}) };
  for (const k of VOLATILE_SEMANTICS) delete base[k];
  state.semantics = dropNulls({ ...base, ...passengerSemantics(slots, values) });
  const fieldValues = passengerFieldValues(slots, values);
  for (const zone of Object.keys(state.displayFields ?? {})) {
    state.displayFields[zone] = (state.displayFields[zone] ?? []).map(f => (f.key in fieldValues ? { ...f, value: fieldValues[f.key] } : f));
  }
  const meta = { ...state.meta, serialNumber: s, groupId: (groupId ?? "").trim() };
  delete meta.authenticationToken;   // the server owns tokens (stable per serial)
  const exp = (expirationDate ?? "").trim();
  if (exp) meta.expirationDate = exp; else delete meta.expirationDate;   // blank = arrival + 1 day
  state.meta = meta;
  state.barcode = { ...state.barcode, message: (barcodeMessage ?? "").trim() || s, altText: s };
  // relevantDates are re-derived from the schedule at build (expiry.js); a
  // design's sample ones would point at the wrong day.
  if (state.iOS26?.relevantDates) { state.iOS26 = { ...state.iOS26 }; delete state.iOS26.relevantDates; }
  return { ...state, ...(designName ? { designName } : {}) };
}

// ---- preview -------------------------------------------------------------------

/**
 * A pass.json for the live preview of one passenger: the template's preview
 * with this passenger's field values and semantics overlaid (client-side twin
 * of the server merge; identity is irrelevant to the renderer).
 */
export function previewFor(previewPassJson, slots, values, serial) {
  const out = structuredClone(previewPassJson ?? {});
  const fv = passengerFieldValues(slots, values);
  const bp = out.boardingPass ?? {};
  for (const zone of Object.keys(bp)) {
    if (!Array.isArray(bp[zone])) continue;
    bp[zone] = bp[zone].map(f => (f?.key in fv ? { ...f, value: fv[f.key] } : f));
  }
  const sem = { ...(out.semantics ?? {}) };
  for (const k of VOLATILE_SEMANTICS) delete sem[k];
  out.semantics = dropNulls({ ...sem, ...passengerSemantics(slots, values) });
  if (serial && Array.isArray(out.barcodes)) out.barcodes = out.barcodes.map(b => ({ ...b, message: b.message, altText: serial }));
  return out;
}

/** "SOLIVERES / ANGELO" style display name for a passenger's values, or "". */
export function displayName(values) {
  const n = values?.["sem:passengerName"];
  const f = (n?.familyName ?? "").trim(), g = (n?.givenName ?? "").trim();
  return [f, g].filter(Boolean).join(" / ").toUpperCase();
}

/** Initials for the passenger list avatar. */
export function initials(values) {
  const n = values?.["sem:passengerName"];
  const s = `${(n?.givenName ?? "").trim()[0] ?? ""}${(n?.familyName ?? "").trim()[0] ?? ""}`.toUpperCase();
  return s || "?";
}

/** Roster entries are semantic-keyed: map one straight onto semantic slots. */
export function rosterToValues(entry, slots) {
  const ids = new Set(slots.map(s => s.id));
  const out = {};
  for (const [sem, v] of Object.entries(entry?.semantics ?? {})) {
    const id = `sem:${canonicalSemantic(sem)}`;
    if (!ids.has(id) || v == null || v === "") continue;
    out[id] = sem === "passengerName" && typeof v === "string" ? splitName(v) : v;
  }
  return out;
}

/** Harvest one passenger's per-passenger semantic values for the roster. */
export function valuesToRoster(values, slots, individual) {
  const out = {};
  for (const slot of slots) {
    if (!slot.sem || !individual.has(slot.id)) continue;
    const v = values[slot.id];
    if (!isBlank(slot, v)) out[slot.sem] = v;
  }
  return out;
}

/** "SOLIVERES/ANGELO" or "Angelo Soliveres" → {givenName, familyName}. */
export function splitName(s) {
  const t = String(s ?? "").trim();
  if (t.includes("/")) { const [familyName, givenName = ""] = t.split("/"); return { givenName: givenName.trim(), familyName: familyName.trim() }; }
  const parts = t.split(/\s+/);
  return parts.length > 1 ? { givenName: parts.slice(0, -1).join(" "), familyName: parts.at(-1) } : { givenName: "", familyName: t };
}
