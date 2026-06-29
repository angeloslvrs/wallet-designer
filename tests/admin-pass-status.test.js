import { describe, it, expect } from "vitest";
import { statusOf } from "../apps/server/src/routes/admin.js";

// statusOf derives the Manage status chip from a stored pass record's
// transitStatus semantic, for both record shapes, defaulting to "On Time".
describe("statusOf — derived pass status for the Manage chip", () => {
  it("reads transitStatus from a template record's data.semantics", () => {
    expect(statusOf({ data: { semantics: { transitStatus: "Delayed" } } })).toBe("Delayed");
    expect(statusOf({ data: { semantics: { transitStatus: "Boarding" } } })).toBe("Boarding");
  });

  it("unwraps a {value} patch form", () => {
    expect(statusOf({ data: { semantics: { transitStatus: { value: "Cancelled" } } } })).toBe("Cancelled");
  });

  it("reads transitStatus from a FormState record's state (migrated)", () => {
    expect(statusOf({ state: { semantics: { transitStatus: "Diverted" } } })).toBe("Diverted");
  });

  it("defaults to On Time when there is no status (either shape, missing semantics)", () => {
    expect(statusOf({ data: {} })).toBe("On Time");
    expect(statusOf({ data: { semantics: {} } })).toBe("On Time");
    expect(statusOf({ state: {} })).toBe("On Time");
    expect(statusOf({ data: { semantics: { transitStatus: "" } } })).toBe("On Time");
  });
});
