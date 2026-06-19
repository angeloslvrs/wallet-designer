// Pure parser for IATA Resolution 792 "Bar Coded Boarding Pass" (BCBP) strings —
// the data encoded in the PDF417/Aztec barcode printed on boarding passes.
// We decode the MANDATORY header + first leg (fixed-position fields); the
// trailing conditional/variable block and any extra legs are not needed for
// autofill and are ignored. BCBP carries the flight DATE (Julian day-of-year)
// but no clock time, gate, terminal, city, or timezone.

import { splitPersonName, seatSemantics } from "./semantics.js";

const HEADER_NAME = [2, 22]; // passenger-name slice bounds in the header
const LEG_START = 23;        // first leg's mandatory block starts here
const MIN_LEN = 60;          // header(23) + leg mandatory(37)

/** Day-of-year (1..366) → "YYYY-MM-DD", picking the year nearest the reference date. */
function julianToISODate(day, referenceDate) {
  const ref = referenceDate ?? new Date();
  const refMs = ref.getTime();
  let best = null;
  for (const y of [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1]) {
    const cand = new Date(Date.UTC(y, 0, 1) + (day - 1) * 86400000);
    const dist = Math.abs(cand.getTime() - refMs);
    if (best === null || dist < best.dist) best = { cand, dist };
  }
  return best.cand.toISOString().slice(0, 10);
}

/**
 * @param {string} raw  the decoded barcode text
 * @param {{referenceDate?: Date}} [opts]
 * @returns {object} structured BCBP fields (see plan)
 */
export function parseBCBP(raw, opts = {}) {
  const s = String(raw ?? "").replace(/^\s+|\s+$/g, "");
  if (s[0] !== "M" || s.length < MIN_LEN) {
    throw new Error("Not a parseable IATA BCBP 'M' boarding-pass barcode");
  }
  const legs = Number.parseInt(s[1], 10);
  if (!Number.isInteger(legs) || legs < 1) {
    throw new Error("Not a parseable IATA BCBP 'M' boarding-pass barcode (bad leg count)");
  }
  const name = s.slice(HEADER_NAME[0], HEADER_NAME[1]).trim();

  let i = LEG_START;
  const take = (n) => { const v = s.slice(i, i + n); i += n; return v; };
  const pnr = take(7).trim();
  const from = take(3).trim();
  const to = take(3).trim();
  const carrier = take(3).trim();
  const flight = take(5).trim();
  const julian = take(3).trim();
  const compartment = take(1).trim();
  const seat = take(4).trim();
  const sequence = take(5).trim();
  const passengerStatus = take(1).trim();
  // remaining (conditional-size hex + variable block + extra legs) intentionally ignored

  const flightDigits = (flight.match(/\d+/) ?? [""])[0];
  const flightNumber = flightDigits ? Number.parseInt(flightDigits, 10) : undefined;
  const seatDigits = (seat.match(/\d+/) ?? [""])[0];
  const seatLetter = seat.replace(/[0-9\s]/g, "");
  const seatComposite = seatDigits ? `${Number.parseInt(seatDigits, 10)}${seatLetter}` : seat;
  const seqDigits = (sequence.match(/\d+/) ?? [""])[0];
  const flightDayOfYear = Number.parseInt(julian, 10);

  return {
    format: "M",
    legs,
    passengerName: splitPersonName(name),
    confirmationNumber: pnr || undefined,
    departureAirportCode: from || undefined,
    destinationAirportCode: to || undefined,
    airlineCode: carrier || undefined,
    flightNumber,
    flightCode: carrier && flightNumber !== undefined ? `${carrier}${flightNumber}` : undefined,
    flightDayOfYear: Number.isInteger(flightDayOfYear) ? flightDayOfYear : undefined,
    flightDate: Number.isInteger(flightDayOfYear) ? julianToISODate(flightDayOfYear, opts.referenceDate) : undefined,
    compartmentCode: compartment || undefined,
    seats: seat ? [seatSemantics(seatComposite)] : [],
    boardingSequenceNumber: seqDigits ? String(Number.parseInt(seqDigits, 10)) : undefined,
    passengerStatus: passengerStatus || undefined
  };
}

/**
 * Map parsed BCBP fields onto Apple boarding semantic keys, keeping only the
 * fields BCBP carries confidently. The flight date is omitted on purpose: BCBP
 * has no clock time, so we never write a (wrong) timestamped departure.
 * @param {object} parsed  output of {@link parseBCBP}
 * @returns {Record<string, any>}
 */
export function bcbpToSemantics(parsed = {}) {
  const out = {};
  const name = parsed.passengerName;
  if (name && (name.givenName || name.familyName)) out.passengerName = name;
  if (parsed.confirmationNumber) out.confirmationNumber = parsed.confirmationNumber;
  if (parsed.departureAirportCode) out.departureAirportCode = parsed.departureAirportCode;
  if (parsed.destinationAirportCode) out.destinationAirportCode = parsed.destinationAirportCode;
  if (parsed.airlineCode) out.airlineCode = parsed.airlineCode;
  if (parsed.flightCode) out.flightCode = parsed.flightCode;
  if (Number.isFinite(parsed.flightNumber)) out.flightNumber = parsed.flightNumber;
  if (Array.isArray(parsed.seats) && parsed.seats.length) out.seats = parsed.seats;
  if (parsed.boardingSequenceNumber) out.boardingSequenceNumber = parsed.boardingSequenceNumber;
  return out;
}
