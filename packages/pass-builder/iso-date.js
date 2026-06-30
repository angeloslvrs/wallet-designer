// Strict shape accepted at INPUT boundaries (designer field validation, issue
// time, status API): complete date, complete time WITH seconds, and an explicit
// UTC offset or Z.
const STRICT_ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
// Looser shape for RE-DERIVING dates from already-stored data (expiry/relevance):
// seconds and the UTC offset are OPTIONAL. Boundaries stay strict — this only
// governs what we tolerate when rebuilding a pass that was stored before the
// strict rule existed (e.g. a FormState whose offset field was left blank), so a
// rebuild never silently drops its relevance window / expiry.
const LOOSE_ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

const daysInMonth = (year, month) => {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

// Both regexes capture the same eight groups in the same order; the loose one
// simply leaves seconds/offset undefined, which default here (seconds -> "00",
// offset -> ""). Calendar validity (real month/day) is checked for both.
const finalizeParse = (m, source) => {
  const [, y, mo, d, hour, minute, second = "00", fraction = "", offset = ""] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return {
    year, month, day, hour, minute, second, fraction, offset,
    time: `${hour}:${minute}:${second}`,
    source
  };
};

/**
 * Parse the strict pass-date shape this app accepts from user input:
 * complete date, complete time WITH seconds, and an explicit UTC offset or Z.
 * @param {*} value
 * @returns {{year:number, month:number, day:number, hour:string, minute:string,
 *            second:string, fraction:string, offset:string, time:string, source:string}|null}
 */
export function parseStrictIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const source = value.trim();
  const m = STRICT_ISO_DATE_TIME_RE.exec(source);
  return m ? finalizeParse(m, source) : null;
}

/**
 * Parse a tolerant pass-date shape for re-deriving dates from already-stored
 * data: complete date + time required, but seconds (default ":00") and the UTC
 * offset (default "") are optional. Same return shape as
 * {@link parseStrictIsoDateTime}. NOT for validating fresh user input.
 * @param {*} value
 */
export function parseLooseIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const source = value.trim();
  const m = LOOSE_ISO_DATE_TIME_RE.exec(source);
  return m ? finalizeParse(m, source) : null;
}

/** @param {*} value */
export function isStrictIsoDateTime(value) {
  return parseStrictIsoDateTime(value) !== null;
}

/** @param {*} value */
export function isLooseIsoDateTime(value) {
  return parseLooseIsoDateTime(value) !== null;
}

/** @param {string} key @param {*} value */
export function assertStrictIsoDateTime(key, value) {
  if (value && !isStrictIsoDateTime(value)) {
    throw new Error(`${key}: "${value}" is not an ISO 8601 date-time with timezone`);
  }
}
