// Shared typed-input helpers. Pure functions here are unit-tested; the DOM
// renderer (renderTypedInput) is added in a later task.

// ISO-8601 <-> datetime-local. <input type=datetime-local> only edits the
// wall-clock part, so the UTC offset is parsed/preserved separately.
export const splitIso = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(v || "");
  return m ? { local: m[1], offset: m[2] || "" } : { local: "", offset: "" };
};
export const joinIso = (local, offset) => (local ? `${local}:00${offset || ""}` : "");

// Type-aware emptiness lives in the package so the Suggest engine and the
// designer share one implementation (drives emit-only-filled).
export { isEmptyTyped } from "@wpd/pass-builder/suggest-empty.js";
