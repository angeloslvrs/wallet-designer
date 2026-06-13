// Shared typed-input helpers. Pure functions here are unit-tested; the DOM
// renderer (renderTypedInput) is added in a later task.

// ISO-8601 <-> datetime-local. <input type=datetime-local> only edits the
// wall-clock part, so the UTC offset is parsed/preserved separately.
export const splitIso = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v || "");
  return m ? { local: m[1], offset: m[2] || "" } : { local: "", offset: "" };
};
export const joinIso = (local, offset) => (local ? `${local}:00${offset || ""}` : "");

/** True when a typed value carries nothing worth emitting (drives emit-only-filled). */
export function isEmptyTyped(type, value) {
  if (value === undefined || value === null) return true;
  switch (type) {
    case "boolean": return false;                       // both true and false are real
    case "number":  return value === "" || Number.isNaN(value);
    case "personName": return !value.givenName && !value.familyName;
    case "seats":
    case "stringArray": return !Array.isArray(value) || value.length === 0;
    case "location": return typeof value.latitude !== "number" || typeof value.longitude !== "number";
    case "currency": return value.amount === undefined || value.amount === "" || !value.currencyCode;
    default: return String(value).trim() === "";        // text, date, enum
  }
}
