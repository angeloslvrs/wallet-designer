// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderSemanticsEditor, harvestSemantics } from "../apps/designer/src/semantics-editor.js";

describe("renderSemanticsEditor", () => {
  it("renders an input for every required semantic, seeded from initial values", () => {
    const el = renderSemanticsEditor({ values: { airlineCode: "RP", passengerName: { givenName: "A", familyName: "B" } }, onChange() {} });
    document.body.appendChild(el);
    expect(el.querySelector('[data-sem="airlineCode"]')).toBeTruthy();
    expect(el.querySelector('[data-sem="passengerName"]')).toBeTruthy();
    // a required date semantic is present with the datetime widget
    expect(el.querySelector('[data-sem="originalBoardingDate"] input[type="datetime-local"]')).toBeTruthy();
  });
});

describe("harvestSemantics", () => {
  it("returns only filled values (drops empty optionals), keeping typed shapes", () => {
    const values = {
      airlineCode: "RP", flightNumber: 247,
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F" }],
      departureGate: "",                 // empty optional -> dropped
      internationalDocumentsAreVerified: false   // boolean false is real -> kept
    };
    expect(harvestSemantics(values)).toEqual({
      airlineCode: "RP", flightNumber: 247,
      passengerName: { givenName: "Ada", familyName: "Lovelace" },
      seats: [{ seatRow: "14", seatNumber: "F" }],
      internationalDocumentsAreVerified: false
    });
  });
});
