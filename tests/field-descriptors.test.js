import { describe, it, expect } from "vitest";
import { loadTemplate, templateFieldDescriptors } from "../packages/pass-builder/template.js";
import { discoverBindings } from "../packages/pass-builder/bindings.js";

// templateFieldDescriptors must resolve each visible field's validation kind
// through the template's discovered semanticKey → fieldKey bindings (rules
// attach to semantics, not to field-key names). Proven against BOTH committed
// real templates — cebpac (Pass Designer 1.0 export) and the hand-written
// dev-sample with its different key vocabulary.

async function descriptorsFor(id) {
  const { passJson } = await loadTemplate(`templates/${id}.pkpasstemplate`);
  const bindings = discoverBindings(passJson);
  return Object.fromEntries(templateFieldDescriptors(passJson, bindings).map(d => [d.key, d]));
}

describe("templateFieldDescriptors — kind resolved via bindings (cebpac)", () => {
  it("resolves each field to the kind its bound semantic implies", async () => {
    const d = await descriptorsFor("cebpac");
    expect(d.depart.kind).toBe("iata");        // departureAirportCode
    expect(d.arrive.kind).toBe("iata");         // destinationAirportCode
    expect(d.sequence.kind).toBe("number");     // boardingSequenceNumber
    expect(d.date.kind).toBe("date");           // currentDepartureDate
    expect(d.boardingTime.kind).toBe("date");   // currentBoardingDate
    expect(d.seat.kind).toBe("seat");           // seats
    expect(d.passenger.kind).toBe("name");      // passengerName
    expect(d.gate.kind).toBe("text");           // unbound
    expect(d.term.kind).toBe("text");           // departureTerminal (string)
  });

  it("carries the bound semantic and required flag", async () => {
    const d = await descriptorsFor("cebpac");
    expect(d.depart.boundSemantic).toBe("departureAirportCode");
    expect(d.depart.required).toBe(true);       // airport codes are required
    expect(d.seat.required).toBe(true);         // seats required
    expect(d.passenger.required).toBe(true);    // passengerName required
    expect(d.sequence.required).toBe(false);    // boardingSequenceNumber not required
    expect(d.gate.boundSemantic).toBeNull();    // unbound
    expect(d.gate.required).toBe(false);
  });

  it("emits input affordances for the constrained kinds", async () => {
    const d = await descriptorsFor("cebpac");
    expect(d.depart.maxLength).toBe(3);
    expect(d.depart.pattern).toBe("[A-Z]{3}");
    expect(d.sequence.pattern).toMatch(/0-9/);
  });
});

describe("templateFieldDescriptors — kind resolved via bindings (dev-sample)", () => {
  it("resolves the same kinds through dev-sample's own key names", async () => {
    const d = await descriptorsFor("dev-sample");
    expect(d.depart.kind).toBe("iata");         // departureAirportCode
    expect(d.arrive.kind).toBe("iata");          // destinationAirportCode
    expect(d.seq.kind).toBe("number");           // boardingSequenceNumber
    expect(d.boarding.kind).toBe("date");        // currentBoardingDate
    expect(d["depart-time"].kind).toBe("date");  // currentDepartureDate
    expect(d.seat.kind).toBe("seat");            // seats
    expect(d.passenger.kind).toBe("name");       // passengerName
    expect(d.gate.kind).toBe("text");            // departureGate (string)
    expect(d.flight.kind).toBe("text");          // flightCode (string)
    expect(d.confirmation.kind).toBe("text");    // confirmationNumber (string)
  });

  it("marks the required schedule/route/identity semantics required", async () => {
    const d = await descriptorsFor("dev-sample");
    expect(d.flight.required).toBe(true);        // flightCode required
    expect(d["depart-time"].required).toBe(true);
    expect(d.boarding.required).toBe(true);
    expect(d.gate.required).toBe(false);         // departureGate not required
    expect(d.seq.required).toBe(false);
  });
});

describe("templateFieldDescriptors — backward compatible", () => {
  it("falls back to style-attr kinds when no bindings are passed", async () => {
    const { passJson } = await loadTemplate("templates/cebpac.pkpasstemplate");
    const d = Object.fromEntries(templateFieldDescriptors(passJson).map(x => [x.key, x]));
    // with no bindings, only dateStyle/timeStyle fields are "date", rest "text"
    expect(d.date.kind).toBe("date");
    expect(d.boardingTime.kind).toBe("date");
    expect(d.depart.kind).toBe("text");
    expect(d.depart.boundSemantic).toBeNull();
    expect(d.depart.required).toBe(false);
  });
});
