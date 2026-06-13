/** Type-aware emptiness — package-local twin of the designer's inputs.isEmptyTyped. */
export function isEmptyTyped(type, value) {
  if (value === undefined || value === null) return true;
  switch (type) {
    case "boolean": return false;
    case "number":  return value === "" || Number.isNaN(value);
    case "personName": return !value.givenName && !value.familyName;
    case "seats":
    case "stringArray": return !Array.isArray(value) || value.length === 0;
    case "location": return typeof value.latitude !== "number" || typeof value.longitude !== "number";
    case "currency": return value.amount === undefined || value.amount === "" || !value.currencyCode;
    default: return String(value).trim() === "";
  }
}
