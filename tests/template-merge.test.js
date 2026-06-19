import { describe, it, expect } from "vitest";
import { applyTemplateData, templateFieldKeys } from "../packages/pass-builder/template.js";

// A skeleton pass.json the way Pass Designer exports one: placeholder values,
// no serialNumber/authenticationToken/webServiceURL.
function skeleton() {
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.dev.placeholder",
    teamIdentifier: "PLACEHOLDER",
    organizationName: "Rocket Partners Airlines",
    description: "Boarding pass",
    barcodes: [{ format: "PKBarcodeFormatQR", message: "PLACEHOLDER", messageEncoding: "iso-8859-1" }],
    boardingPass: {
      transitType: "PKTransitTypeAir",
      headerFields: [{ key: "gate", label: "GATE", value: "—" }],
      primaryFields: [
        { key: "depart", label: "San Francisco", value: "SFO" },
        { key: "arrive", label: "New York", value: "JFK" }
      ],
      secondaryFields: [{ key: "passenger", label: "PASSENGER", value: "FIRSTNAME LASTNAME" }],
      auxiliaryFields: [{ key: "boarding", label: "BOARDING", value: "", dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" }],
      backFields: [{ key: "ff", label: "FREQUENT FLYER", value: "—" }],
      additionalInfoFields: [{ key: "meal", label: "MEAL", value: "Snack" }]
    },
    semantics: { airlineCode: "RP", passengerName: { givenName: "FIRSTNAME" } }
  };
}

describe("templateFieldKeys", () => {
  it("lists every field key across all zones of the style dict", () => {
    expect(templateFieldKeys(skeleton())).toEqual(
      ["gate", "depart", "arrive", "passenger", "boarding", "ff", "meal"]
    );
  });

  it("returns an empty list for a pass with no style dict", () => {
    expect(templateFieldKeys({ formatVersion: 1 })).toEqual([]);
  });

  it("works for any pass style, not just boardingPass", () => {
    const event = { eventTicket: { primaryFields: [{ key: "eventName", value: "x" }] } };
    expect(templateFieldKeys(event)).toEqual(["eventName"]);
  });
});

describe("applyTemplateData", () => {
  it("sets the value of a field matched by key", () => {
    const out = applyTemplateData(skeleton(), { gate: "B12" });
    expect(out.boardingPass.headerFields[0].value).toBe("B12");
    expect(out.boardingPass.headerFields[0].label).toBe("GATE");
  });

  it("does not mutate the input passJson", () => {
    const input = skeleton();
    applyTemplateData(input, { gate: "B12", semantics: { departureGate: "B12" } });
    expect(input.boardingPass.headerFields[0].value).toBe("—");
    expect(input.semantics.departureGate).toBeUndefined();
  });

  it("accepts the object form to set label/changeMessage alongside value", () => {
    const out = applyTemplateData(skeleton(), {
      gate: { value: "B12", changeMessage: "Gate changed to %@" }
    });
    const gate = out.boardingPass.headerFields[0];
    expect(gate.value).toBe("B12");
    expect(gate.changeMessage).toBe("Gate changed to %@");
    expect(gate.label).toBe("GATE");
  });

  it("ignores a stray `key` property in the object form (field identity is fixed)", () => {
    const out = applyTemplateData(skeleton(), { gate: { key: "hijack", value: "B12" } });
    expect(out.boardingPass.headerFields[0].key).toBe("gate");
  });

  it("deep-merges data.semantics into the template semantics", () => {
    const out = applyTemplateData(skeleton(), {
      semantics: { departureGate: "B12", passengerName: { familyName: "SOLIVERES" } }
    });
    expect(out.semantics.airlineCode).toBe("RP");
    expect(out.semantics.departureGate).toBe("B12");
    expect(out.semantics.passengerName).toEqual({ givenName: "FIRSTNAME", familyName: "SOLIVERES" });
  });

  it("sets barcodeMessage/barcodeAltText on every barcode entry", () => {
    const out = applyTemplateData(skeleton(), { barcodeMessage: "RP247-14A", barcodeAltText: "RP247 14A" });
    expect(out.barcodes[0].message).toBe("RP247-14A");
    expect(out.barcodes[0].altText).toBe("RP247 14A");
    expect(out.barcodes[0].format).toBe("PKBarcodeFormatQR");
  });

  it("appends data.additionalInfoFields to the template's, replacing same-key entries", () => {
    const out = applyTemplateData(skeleton(), {
      additionalInfoFields: [{ key: "delay", label: "DELAY", value: "45 min" }]
    });
    expect(out.boardingPass.additionalInfoFields).toEqual([
      { key: "meal", label: "MEAL", value: "Snack" },
      { key: "delay", label: "DELAY", value: "45 min" }
    ]);
    const replaced = applyTemplateData(skeleton(), {
      additionalInfoFields: [{ key: "meal", label: "MEAL", value: "Hot meal" }]
    });
    expect(replaced.boardingPass.additionalInfoFields).toEqual([
      { key: "meal", label: "MEAL", value: "Hot meal" }
    ]);
  });

  it("throws on a key the template does not declare, listing the declared keys", () => {
    expect(() => applyTemplateData(skeleton(), { seat: "14A" }))
      .toThrow(/seat.*gate/s);
  });

  it("sets the same key in every zone that declares it", () => {
    const tpl = skeleton();
    tpl.boardingPass.backFields.push({ key: "gate", label: "GATE (BACK)", value: "—" });
    const out = applyTemplateData(tpl, { gate: "B12" });
    expect(out.boardingPass.headerFields[0].value).toBe("B12");
    expect(out.boardingPass.backFields[1].value).toBe("B12");
  });

  it("leaves the template untouched when data is empty", () => {
    expect(applyTemplateData(skeleton(), {})).toEqual(skeleton());
  });
});

describe("template expiry reserved key", () => {
  it("accepts expirationDate as a reserved key (does not throw as unknown)", () => {
    const passJson = { boardingPass: { primaryFields: [{ key: "depart", value: "MNL" }] }, semantics: {} };
    expect(() => applyTemplateData(passJson, { expirationDate: "2026-09-01T00:00:00+08:00" })).not.toThrow();
  });
});
