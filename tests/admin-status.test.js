import { describe, it, expect } from "vitest";
import { applyStatus } from "../apps/server/src/routes/admin.js";
import { normalizeStatusBody } from "../apps/server/src/template-status.js";
import { formStateToPassJson } from "@wpd/pass-builder";

const baseState = () => ({ semantics: { departureGate: "A1" }, displayFields: {} });

// A FormState whose visible `gate` header value equals the semantic — the
// in-sync state a freshly issued pass has, so value-match discovery binds them.
// The `boarding` aux field is a pre-formatted time string (no dateStyle), which
// is the FormState time-field shape that CANNOT bind.
const boundState = () => ({
  semantics: { departureGate: "A1" },
  displayFields: {
    header: [{ key: "gate", label: "GATE", value: "A1" }],
    auxiliary: [{ key: "boarding", label: "BOARDING", value: "3:50 PM" }]
  }
});

describe("applyStatus (FormState, semantics-first)", () => {
  it("maps transitStatus + reason onto semantics and a visible status row with a change banner", () => {
    const { state: next } = applyStatus(baseState(), { transitStatus: "Delayed", transitStatusReason: "crew availability" });
    expect(next.semantics.transitStatus).toBe("Delayed");
    expect(next.semantics.transitStatusReason).toBe("crew availability");
    expect(next.iOS26.additionalInfoFields).toEqual([
      { key: "status", label: "STATUS", value: "Delayed — crew availability", changeMessage: "%@" }
    ]);
  });

  it("clears the status row and both semantics with empty strings", () => {
    const { state: set } = applyStatus(baseState(), { transitStatus: "Cancelled", transitStatusReason: "aircraft fault" });
    const { state: next } = applyStatus(set, { transitStatus: "", transitStatusReason: "" });
    expect(next.semantics.transitStatus).toBeUndefined();
    expect(next.semantics.transitStatusReason).toBeUndefined();
    expect(next.iOS26.additionalInfoFields).toEqual([]);
  });

  it("keeps the delay row (with a banner) independent of the status row", () => {
    const { state: next } = applyStatus(baseState(), { delayed: "45 min", transitStatus: "Delayed" });
    expect(next.iOS26.additionalInfoFields.map(f => f.key).sort()).toEqual(["delay", "status"]);
    expect(next.iOS26.additionalInfoFields.find(f => f.key === "delay").changeMessage).toBe("%@");
  });

  it("normalizes the {value, changeMessage} object form to the plain value in semantics", () => {
    const { state: next } = applyStatus(baseState(), { departureGate: { value: "B12", changeMessage: "Gate changed to %@" } });
    expect(next.semantics.departureGate).toBe("B12");
  });

  it("does not mutate the input state", () => {
    const input = baseState();
    applyStatus(input, { departureGate: "B12", transitStatus: "Delayed" });
    expect(input.semantics.departureGate).toBe("A1");
    expect(input.iOS26).toBeUndefined();
  });

  it("updates the bound visible field + adds a banner and keeps semantics in lockstep", () => {
    const { state, skipped } = applyStatus(boundState(), { departureGate: "B12" });
    expect(state.displayFields.header[0]).toEqual({ key: "gate", label: "GATE", value: "B12", changeMessage: "Gate changed to %@" });
    expect(state.semantics.departureGate).toBe("B12");
    expect(skipped).not.toContain("departureGate");
  });

  it("honors a caller-supplied changeMessage on the bound visible field", () => {
    const { state } = applyStatus(boundState(), { departureGate: { value: "B12", changeMessage: "New gate %@" } });
    expect(state.displayFields.header[0].changeMessage).toBe("New gate %@");
    expect(state.displayFields.header[0].value).toBe("B12");
  });

  it("leaves an unbindable formatted-time field semantics-only and reports it as skipped", () => {
    const { state, skipped } = applyStatus(boundState(), { currentBoardingDate: "2026-06-20T07:30:00-07:00" });
    expect(state.semantics.currentBoardingDate).toBe("2026-06-20T07:30:00-07:00");
    expect(state.displayFields.auxiliary[0].value).toBe("3:50 PM"); // formatted string, untouched
    expect(state.displayFields.auxiliary[0].changeMessage).toBeUndefined();
    expect(skipped).toContain("currentBoardingDate");
  });

  it("maps the semantic schedule keys onto semantics (unbound → reported as skipped)", () => {
    const { state: next, skipped } = applyStatus(baseState(), {
      departureGate: "C3",
      currentBoardingDate: "2026-06-20T07:30:00-07:00",
      currentDepartureDate: "2026-06-20T08:00:00-07:00",
      currentArrivalDate: "2026-06-20T16:45:00-04:00",
      transitProvider: "Train to Concourse B"
    });
    expect(next.semantics.departureGate).toBe("C3");
    expect(next.semantics.currentBoardingDate).toBe("2026-06-20T07:30:00-07:00");
    expect(next.semantics.currentDepartureDate).toBe("2026-06-20T08:00:00-07:00");
    expect(next.semantics.currentArrivalDate).toBe("2026-06-20T16:45:00-04:00");
    expect(next.semantics.transitProvider).toBe("Train to Concourse B");
    expect(skipped.sort()).toEqual(
      ["currentArrivalDate", "currentBoardingDate", "currentDepartureDate", "departureGate", "transitProvider"]
    );
  });
});

describe("applyStatus → formStateToPassJson (the PAL bug: rendered field must change + carry a banner)", () => {
  const fullState = () => ({
    meta: { passTypeId: "pass.test", teamId: "TEAM", organizationName: "Org", serialNumber: "S1", description: "Boarding pass" },
    branding: { logoText: "AIR", foregroundColor: "rgb(255,255,255)", backgroundColor: "rgb(0,0,0)", labelColor: "rgb(255,255,255)" },
    barcode: { format: "PKBarcodeFormatQR", message: "M", altText: "" },
    semantics: { departureGate: "132" },
    displayFields: { header: [{ key: "gate", label: "GATE", value: "132" }] }
  });

  it("a gate status update changes the visible gate field and gives it a changeMessage", () => {
    const { state } = applyStatus(fullState(), { departureGate: "B4" });
    const pj = formStateToPassJson(state);
    const gate = pj.boardingPass.headerFields.find(f => f.key === "gate");
    expect(gate.value).toBe("B4");                       // was stale at "132" before the fix
    expect(gate.changeMessage).toBe("Gate changed to %@"); // → lock-screen banner
  });
});

describe("normalizeStatusBody (route-layer back-compat aliases)", () => {
  it("renames the legacy verbs to semantic keys", () => {
    expect(normalizeStatusBody({
      gate: "B12", boarding: "b", depart: "d", arrive: "a", transitInfo: "t", delayed: "45 min"
    })).toEqual({
      departureGate: "B12", currentBoardingDate: "b", currentDepartureDate: "d",
      currentArrivalDate: "a", transitProvider: "t", delayed: "45 min"
    });
  });

  it("lets a semantic key win over its alias in the same body", () => {
    expect(normalizeStatusBody({ gate: "OLD", departureGate: "NEW" })).toEqual({ departureGate: "NEW" });
  });

  it("passes semantic-only bodies through untouched", () => {
    const body = { departureGate: "B12", transitStatus: "Delayed" };
    expect(normalizeStatusBody(body)).toEqual(body);
  });
});
