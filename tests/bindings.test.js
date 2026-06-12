import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { discoverBindings } from "../packages/pass-builder/bindings.js";

const fieldKeyOf = (bindings, sem) => bindings[sem]?.fieldKey;

describe("discoverBindings — cebpac (real Pass Designer 1.0 export)", async () => {
  const passJson = JSON.parse(await readFile("templates/cebpac.pkpasstemplate/pass.json", "utf8"));
  const b = discoverBindings(passJson);

  it("binds string semantics by exact sample-value match", () => {
    expect(fieldKeyOf(b, "departureTerminal")).toBe("term");
    expect(fieldKeyOf(b, "boardingSequenceNumber")).toBe("sequence");
    expect(fieldKeyOf(b, "departureAirportCode")).toBe("depart");
    expect(fieldKeyOf(b, "destinationAirportCode")).toBe("arrive");
  });

  it("binds current* date semantics by ±120s proximity to date-typed fields", () => {
    expect(b.currentBoardingDate).toMatchObject({ fieldKey: "boardingTime", source: "date-proximity" });
    expect(b.currentDepartureDate).toMatchObject({ fieldKey: "date", source: "date-proximity" });
    // no date-typed field is near the arrival sample → unbound, informational
    expect(b.currentArrivalDate).toBeUndefined();
  });

  it("binds the seat field via the seatRow+seatNumber composite ('17'+'C' = '17C')", () => {
    expect(b.seats).toMatchObject({ fieldKey: "seat", source: "seat-composite" });
  });

  it("binds passengerName from the SURNAME/GIVEN field value", () => {
    expect(b.passengerName).toMatchObject({ fieldKey: "passenger", source: "name-match" });
  });

  it("leaves semantics with mismatched sample values unbound (boardingGroup '5' vs field '1')", () => {
    expect(b.boardingGroup).toBeUndefined();
  });

  it("flags every inferred binding as a guess (confidence below high)", () => {
    for (const [sem, binding] of Object.entries(b)) {
      expect(binding.confidence, sem).toBe("medium");
    }
  });
});

describe("discoverBindings — dev-sample (second naming convention, same code path)", async () => {
  const passJson = JSON.parse(await readFile("templates/dev-sample.pkpasstemplate/pass.json", "utf8"));
  const b = discoverBindings(passJson);

  it("binds the issue-flow semantics the old hardcoded convention used to assume", () => {
    expect(fieldKeyOf(b, "departureGate")).toBe("gate");
    expect(fieldKeyOf(b, "confirmationNumber")).toBe("confirmation");
    expect(fieldKeyOf(b, "ticketFareClass")).toBe("fare-class");
    expect(fieldKeyOf(b, "priorityStatus")).toBe("priority");
    expect(fieldKeyOf(b, "passengerName")).toBe("passenger");
    expect(fieldKeyOf(b, "seats")).toBe("seat");
    expect(fieldKeyOf(b, "currentBoardingDate")).toBe("boarding");
    expect(fieldKeyOf(b, "currentDepartureDate")).toBe("depart-time");
    expect(fieldKeyOf(b, "boardingSequenceNumber")).toBe("seq");
    expect(fieldKeyOf(b, "membershipProgramNumber")).toBe("ff");
  });
});

describe("discoverBindings — heuristics on synthetic templates", () => {
  const template = (fields, semantics) => ({
    formatVersion: 1,
    boardingPass: { headerFields: fields },
    semantics
  });

  it("treats field-level semantics as authoritative (binds even without a value match)", () => {
    const b = discoverBindings(template(
      [{ key: "porte", label: "GATE", value: "—", semantics: { departureGate: "B7" } }],
      { departureGate: "B7" }
    ));
    expect(b.departureGate).toEqual({ fieldKey: "porte", source: "field-semantics", confidence: "high" });
  });

  it("leaves a semantic unbound when two fields share its sample value (ambiguous)", () => {
    const b = discoverBindings(template(
      [
        { key: "gate-a", label: "GATE", value: "B7" },
        { key: "gate-b", label: "ALSO GATE", value: "B7" }
      ],
      { departureGate: "B7" }
    ));
    expect(b.departureGate).toBeUndefined();
  });

  it("returns an empty map for a template with no style dict or no semantics", () => {
    expect(discoverBindings({})).toEqual({});
    expect(discoverBindings(template([{ key: "gate", value: "B7" }], undefined))).toEqual({});
  });
});
