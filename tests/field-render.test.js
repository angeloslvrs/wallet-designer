import { describe, it, expect } from "vitest";
import { resolvePassFields } from "../packages/pass-builder/field-render.js";

// resolvePassFields turns the Studio-only field extensions — label tokens and
// timeFormat "24h" — into plain Apple fields, so neither reaches a pass.json.

const pass = (fields, semantics = {}) => ({ boardingPass: { primaryFields: fields }, semantics });

describe("label tokens", () => {
  it("resolves {key:upper} and {key} from semantics, collapsing whitespace", () => {
    const out = resolvePassFields(pass(
      [{ key: "depart", label: "{departureCityName:upper} {departureAirportName:upper}", value: "MNL" }],
      { departureCityName: "Manila", departureAirportName: "Ninoy Aquino Intl" }));
    expect(out.boardingPass.primaryFields[0].label).toBe("MANILA NINOY AQUINO INTL");
  });
  it("a missing semantic resolves empty and the label is trimmed", () => {
    const out = resolvePassFields(pass([{ key: "a", label: "{departureCityName:upper}  {departureAirportName}", value: "" }], { departureCityName: "Tacloban" }));
    expect(out.boardingPass.primaryFields[0].label).toBe("TACLOBAN");
  });
  it("numbers stringify; unknown keys and plain braces stay literal", () => {
    const out = resolvePassFields(pass([{ key: "f", label: "PR {flightNumber} {notASemantic} {x", value: "" }], { flightNumber: 2987 }));
    expect(out.boardingPass.primaryFields[0].label).toBe("PR 2987 {notASemantic} {x");
  });
  it("object-valued semantics resolve empty", () => {
    const out = resolvePassFields(pass([{ key: "p", label: "HI {passengerName}", value: "" }], { passengerName: { givenName: "A" } }));
    expect(out.boardingPass.primaryFields[0].label).toBe("HI");
  });
  it("leaves labels without tokens byte-identical", () => {
    const out = resolvePassFields(pass([{ key: "g", label: "GATE  ", value: "12" }]));
    expect(out.boardingPass.primaryFields[0].label).toBe("GATE  ");
  });
});

describe("timeFormat 24h", () => {
  it("renders HH:mm from the ISO string's own local time and strips the attrs", () => {
    const out = resolvePassFields(pass([{ key: "b", label: "BOARDING", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h", timeStyle: "PKDateStyleShort" }]));
    expect(out.boardingPass.primaryFields[0]).toEqual({ key: "b", label: "BOARDING", value: "16:05" });
  });
  it("does not convert through the runtime's zone (Z and other offsets)", () => {
    const out = resolvePassFields(pass([
      { key: "a", label: "A", value: "2026-10-12T23:59:00Z", timeFormat: "24h" },
      { key: "b", label: "B", value: "2026-10-12T00:10-05:00", timeFormat: "24h" }
    ]));
    expect(out.boardingPass.primaryFields.map(f => f.value)).toEqual(["23:59", "00:10"]);
  });
  it("keeps a non-ISO or date-only value and still strips timeFormat", () => {
    const out = resolvePassFields(pass([
      { key: "b", label: "B", value: "", timeFormat: "24h" },
      { key: "c", label: "C", value: "2026-10-12", timeFormat: "24h" }
    ]));
    expect(out.boardingPass.primaryFields).toEqual([{ key: "b", label: "B", value: "" }, { key: "c", label: "C", value: "2026-10-12" }]);
  });
  it("keeps changeMessage", () => {
    const out = resolvePassFields(pass([{ key: "b", label: "B", value: "2026-10-12T07:40:00+08:00", timeFormat: "24h", changeMessage: "Boarding now %@" }]));
    expect(out.boardingPass.primaryFields[0].changeMessage).toBe("Boarding now %@");
  });
  it("leaves fields without timeFormat alone (Wallet formats dateStyle/timeStyle itself)", () => {
    const f = { key: "d", label: "D", value: "2026-10-12T16:05:00+08:00", timeStyle: "PKDateStyleShort" };
    expect(resolvePassFields(pass([f])).boardingPass.primaryFields[0]).toEqual(f);
  });
});

describe("resolvePassFields", () => {
  it("is pure and idempotent", () => {
    const input = pass([{ key: "b", label: "{departureCityName:upper}", value: "2026-10-12T16:05:00+08:00", timeFormat: "24h" }], { departureCityName: "Manila" });
    const snapshot = structuredClone(input);
    const once = resolvePassFields(input);
    expect(input).toEqual(snapshot);
    expect(resolvePassFields(once)).toEqual(once);
  });
  it("covers additionalInfoFields and backFields too", () => {
    const out = resolvePassFields({ boardingPass: { backFields: [{ key: "t", label: "{departureTerminal}", value: "" }], additionalInfoFields: [{ key: "x", label: "{departureCityName}", value: "" }] }, semantics: { departureTerminal: "3", departureCityName: "Manila" } });
    expect(out.boardingPass.backFields[0].label).toBe("3");
    expect(out.boardingPass.additionalInfoFields[0].label).toBe("Manila");
  });
  it("tolerates a pass with no style dict", () => {
    expect(resolvePassFields({ semantics: {} })).toEqual({ semantics: {} });
  });
});
