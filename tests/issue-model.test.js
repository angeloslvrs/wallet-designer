import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplate, templateFieldDescriptors, templateFieldKeys, discoverBindings, formStateToPassJson, applyTemplateData } from "../packages/pass-builder/index.js";
import { parseBCBP, bcbpToSemantics } from "../packages/pass-builder/bcbp.js";
import {
  composeGroupId, suggestSerial, suggestSerials, mergeTripValues, templateSlots, defaultIndividual, issueSlots, slotError, effectiveValue,
  tripIdFrom, parseBcbpLines, bcbpMismatch, serialReport, issueLabel, passengerSemantics, passengerFieldValues,
  buildTemplateIssueBody, buildStudioIssueBody, previewFor, rosterToValues, valuesToRoster, splitName, displayName, canonicalSemantic
} from "../apps/designer/src/issue/model.js";

// Issue workspace model: semantics-first slots over both template kinds. A
// semantic is typed once; every field bound to it is derived; unbound fields
// are raw. The bodies built here go through the REAL server issue path below.

let devSample, studio, design;
const tz = { "sem:departureAirportTimeZone": "America/Los_Angeles", "sem:destinationAirportTimeZone": "America/New_York" };
const FLIGHT = {
  "sem:airlineCode": "RP", "sem:flightNumber": 248, "sem:departureAirportCode": "SFO", "sem:destinationAirportCode": "JFK",
  "sem:departureGate": "C9",
  "sem:currentBoardingDate": "2026-11-02T07:30:00-08:00", "sem:currentDepartureDate": "2026-11-02T08:00:00-08:00",
  "sem:currentArrivalDate": "2026-11-02T16:30:00-05:00", ...tz
};
const PAX = { "sem:passengerName": { givenName: "Maria", familyName: "Soliveres" }, "sem:seats": [{ seatRow: "14", seatNumber: "B" }], "sem:boardingSequenceNumber": "043" };

function bcbp({ name = "SOLIVERES/MARIA", from = "SFO", to = "JFK", carrier = "RP", flight = "0248", seat = "014B", seq = "0043" } = {}) {
  return ["M", "1", name.padEnd(20), "E", "ABC123".padEnd(7), from, to, carrier.padEnd(3), flight.padEnd(5), "306", "Y", seat, seq.padEnd(5), "1", "00"].join("");
}

beforeAll(async () => {
  const { passJson } = await loadTemplate("templates/dev-sample.pkpasstemplate");
  const bindings = discoverBindings(passJson);
  devSample = { id: "dev-sample", kind: "designer", fieldKeys: templateFieldKeys(passJson), fields: templateFieldDescriptors(passJson, bindings), bindings, semantics: passJson.semantics, preview: passJson, _passJson: passJson };
  design = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
  const sp = formStateToPassJson(design);
  const sb = discoverBindings(sp);
  studio = { id: "rocket", kind: "studio", fieldKeys: templateFieldKeys(sp), fields: templateFieldDescriptors(sp, sb), bindings: sb, semantics: design.semantics, preview: sp };
});

describe("carried-over helpers", () => {
  it("compose trip ids and serials", () => {
    expect(composeGroupId("rp 247", "2026-06-20")).toBe("RP247@2026-06-20");
    expect(composeGroupId("RP247", "")).toBe("");
    expect(suggestSerial("RP247@2026-06-20", 3)).toBe("RP247@2026-06-20-003");
    expect(suggestSerial("", 1)).toBe("");
  });
  it("suggests batch serials that skip issued ones and keep hand-typed ones", () => {
    const g = "RP248@2026-11-02";
    expect(suggestSerials(g, [null, "MINE", null], new Set([`${g}-001`]))).toEqual([`${g}-002`, "MINE", `${g}-003`]);
    expect(suggestSerials("", [null], new Set())).toEqual([""]);
  });
  it("mergeTripValues keeps individual keys from the row only", () => {
    expect(mergeTripValues({ a: 1, b: 2 }, { b: 9, c: 3 }, ["b"])).toEqual({ a: 1, b: 9 });
  });
});

describe("slots", () => {
  it("collapse date and time-zone twins and fold bound fields under their semantic", () => {
    const slots = templateSlots(devSample);
    const ids = slots.map(s => s.id);
    expect(ids).not.toContain("sem:originalDepartureDate");
    expect(ids).not.toContain("sem:departureLocationTimeZone");
    const gate = slots.find(s => s.id === "sem:departureGate");
    expect(gate.fieldKeys).toEqual(["gate"]);
    expect(slots.find(s => s.id === "sem:currentBoardingDate").fieldKeys).toEqual(["boarding"]);
    // fields with no bound semantic stay raw, by key (a date-styled one keeps a date picker)
    const raw = templateSlots({ fields: [{ key: "lounge", label: "LOUNGE", kind: "text", boundSemantic: null }, { key: "doors", kind: "date", boundSemantic: null }], preview: { boardingPass: { backFields: [{ key: "lounge", value: "Sky Club" }] } } });
    expect(raw.find(s => s.id === "field:lounge")).toMatchObject({ label: "LOUNGE", fallback: "Sky Club", widget: "text" });
    expect(raw.find(s => s.id === "field:doors").widget).toBe("date");
    expect(canonicalSemantic("originalArrivalDate")).toBe("currentArrivalDate");
  });

  it("always offers the passenger core, per passenger; name and seat are locked", () => {
    const slots = templateSlots(devSample);
    const ind = defaultIndividual(slots);
    for (const id of ["sem:passengerName", "sem:seats", "sem:boardingSequenceNumber", "sem:confirmationNumber"]) expect(ind.has(id)).toBe(true);
    expect(slots.find(s => s.id === "sem:passengerName").perPassenger).toBe("locked");
    expect(ind.has("sem:departureGate")).toBe(false);
  });

  it("a blank non-volatile slot ships the template default and satisfies required; volatile ones never do", () => {
    const slots = templateSlots(devSample);
    const airline = slots.find(s => s.id === "sem:airlineCode");
    expect(effectiveValue(airline, {})).toBe("RP");
    expect(slotError(airline, {})).toBeNull();
    const dep = slots.find(s => s.id === "sem:currentDepartureDate");
    expect(dep.fallback).toBeUndefined();
    expect(slotError(dep, {})).toBe("Required");
    expect(slotError(dep, { [dep.id]: "tomorrow" })).toMatch(/ISO|date/i);
    const name = slots.find(s => s.id === "sem:passengerName");
    expect(slotError(name, {})).toBe("Required");
    expect(slotError(name, { [name.id]: { givenName: " ", familyName: "" } })).toBe("Enter a name");
  });

  it("derives flightCode and the trip id from the flight", () => {
    const slots = templateSlots(devSample);
    expect(tripIdFrom(FLIGHT, slots)).toBe("RP248@2026-11-02");
    // a typed number with the template's airline left blank still re-derives the code
    const fc = slots.find(s => s.sem === "flightCode");
    expect(effectiveValue(fc, { "sem:flightNumber": 9 })).toBe("RP9");
    expect(effectiveValue(fc, {})).toBe("RP247");   // untouched: the template's own code
  });

  it("per-passenger slots never ship the template's sample values", () => {
    const base = templateSlots(devSample);
    const slots = issueSlots(base, defaultIndividual(base));
    const { "sem:departureGate": _gate, ...flight } = FLIGHT;
    const values = { ...flight, "sem:passengerName": PAX["sem:passengerName"] };
    const fv = passengerFieldValues(slots, values);
    expect(fv.seq).toBe("");            // template sample "23" cleared
    expect(fv.confirmation).toBe("");
    const sem = passengerSemantics(slots, values);
    expect(sem.boardingSequenceNumber).toBeNull();   // null deletes the baked value at merge
    expect(sem.departureGate).toBeUndefined();       // shared + blank: template default stays
    const merged = applyTemplateData(devSample._passJson, buildTemplateIssueBody({ template: "dev-sample", groupId: "G", serial: "S", slots, values }).data);
    expect(merged.semantics.boardingSequenceNumber).toBeUndefined();
    const st = buildStudioIssueBody({ design, groupId: "G", serial: "S", slots: issueSlots(templateSlots(studio), defaultIndividual(templateSlots(studio))), values });
    expect(st.semantics.boardingSequenceNumber).toBeUndefined();
    expect(st.semantics.confirmationNumber).toBeUndefined();
  });
});

describe("BCBP multi-line paste", () => {
  it("parses one passenger per line and reports bad lines by number", () => {
    const res = parseBcbpLines(`${bcbp()}\n\nnot a pass\n${bcbp({ name: "REYES/JUAN", seat: "014C", seq: "0044" })}`, (r) => parseBCBP(r, { referenceDate: new Date(Date.UTC(2026, 9, 1)) }), bcbpToSemantics);
    expect(res.map(r => [r.line, r.ok])).toEqual([[1, true], [3, false], [4, true]]);
    expect(res[0].passenger["sem:passengerName"]).toEqual({ givenName: "MARIA", familyName: "SOLIVERES" });
    expect(res[0].passenger["sem:seats"]).toEqual([{ seatRow: "14", seatNumber: "B" }]);
    expect(res[0].flight["sem:flightNumber"]).toBe(248);
    expect(res[2].passenger["sem:boardingSequenceNumber"]).toBe("44");
  });

  it("flags a boarding pass for another flight", () => {
    const slots = templateSlots(devSample);
    expect(bcbpMismatch({ "sem:flightNumber": 248, "sem:departureAirportCode": "SFO" }, FLIGHT, slots)).toEqual([]);
    expect(bcbpMismatch({ "sem:flightNumber": 249 }, FLIGHT, slots)).toEqual(["flight number 249"]);
  });
});

describe("serials", () => {
  it("separates blocking in-batch duplicates from updates of existing passes", () => {
    const r = serialReport(["A-1", "A-2", "A-1", "", "OLD"], new Set(["OLD"]));
    expect([...r.duplicates].sort()).toEqual([0, 2]);
    expect([...r.updates]).toEqual([4]);
    expect([...r.missing]).toEqual([3]);
  });
  it("labels the issue button honestly", () => {
    expect(issueLabel(1, 0)).toBe("Issue 1 pass");
    expect(issueLabel(2, 0)).toBe("Issue 2 passes");
    expect(issueLabel(2, 1)).toBe("Issue 1 · update 1");
    expect(issueLabel(1, 1)).toBe("Update 1 pass");
  });
});

describe("designer template body", () => {
  it("sends typed semantics once and derives every bound field from them", () => {
    const slots = templateSlots(devSample);
    const values = { ...FLIGHT, ...PAX };
    const sem = passengerSemantics(slots, values);
    expect(sem.originalDepartureDate).toBe(FLIGHT["sem:currentDepartureDate"]);
    expect(sem.departureLocationTimeZone).toBe("America/Los_Angeles");
    expect(sem.flightCode).toBe("RP248");
    const fv = passengerFieldValues(slots, values);
    expect(fv).toMatchObject({ gate: "C9", seat: "14B", passenger: "MARIA SOLIVERES", flight: "RP248", boarding: "2026-11-02T07:30:00-08:00", seq: "043" });
    const body = buildTemplateIssueBody({ template: "dev-sample", groupId: "RP248@2026-11-02", serial: "RP248-001", slots, values });
    expect(body).toMatchObject({ template: "dev-sample", serialNumber: "RP248-001", groupId: "RP248@2026-11-02" });
    expect(body.data.barcodeMessage).toBe("RP248-001");
    // the server accepts it: every key is a declared field or reserved
    expect(() => applyTemplateData(devSample._passJson, body.data)).not.toThrow();
  });

  it("blanks a bound sample seat when the passenger has none", () => {
    const slots = templateSlots(devSample);
    const fv = passengerFieldValues(slots, { ...FLIGHT, "sem:passengerName": PAX["sem:passengerName"] });
    expect(fv.seat).toBe("");
    expect(fv.ff).toBeUndefined();   // non-volatile + blank → template value applies
  });
});

describe("studio design body", () => {
  it("drops the design's sample passenger and schedule, rewrites bound fields, sets identity", () => {
    const slots = templateSlots(studio);
    const values = { ...FLIGHT, ...PAX };
    const body = buildStudioIssueBody({ design, designName: "rocket", groupId: "RP248@2026-11-02", serial: "RP248-002", slots, values });
    expect(body.designName).toBe("rocket");
    expect(body.meta).toMatchObject({ serialNumber: "RP248-002", groupId: "RP248@2026-11-02" });
    expect(body.meta.authenticationToken).toBeUndefined();
    expect(body.semantics.passengerName).toEqual({ givenName: "Maria", familyName: "Soliveres" });
    expect(body.semantics.seats).toEqual([{ seatRow: "14", seatNumber: "B" }]);
    expect(body.semantics.originalBoardingDate).toBe(FLIGHT["sem:currentBoardingDate"]);
    expect(body.semantics.membershipProgramName).toBe("Rocket Rewards");   // non-volatile design values stay
    const all = Object.values(body.displayFields).flat();
    expect(all.find(f => f.key === "passenger").value).toBe("MARIA SOLIVERES");
    expect(all.find(f => f.key === "seat").value).toBe("14B");
    expect(all.find(f => f.key === "gate").value).toBe("C9");
    expect(body.barcode.message).toBe("RP248-002");
    expect(JSON.stringify(body)).not.toMatch(/ANGELO/);
    expect(design.meta.serialNumber).toBe("RP-FULL-001");   // the design itself is untouched
  });

  it("issues through the real server path with designName and the explicit trip id", async () => {
    process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-issue-model-")), "passes.json");
    process.env.TEMPLATES_DIR = "templates";
    const { registerPass } = await import("../apps/server/src/routes/admin.js");
    const slots = templateSlots(studio);
    const res = await registerPass(buildStudioIssueBody({ design, designName: "rocket", groupId: "RP248@2026-11-02", serial: "RP248-010", slots, values: { ...FLIGHT, ...PAX } }));
    expect(res).toMatchObject({ serialNumber: "RP248-010", groupId: "RP248@2026-11-02", designName: "rocket", created: true });
    const tslots = templateSlots(devSample);
    const t = await registerPass(buildTemplateIssueBody({ template: "dev-sample", groupId: "RP248@2026-11-02", serial: "RP248-011", slots: tslots, values: { ...FLIGHT, ...PAX } }));
    expect(t.created).toBe(true);
  });
});

describe("baked sample values", () => {
  it("every baked semantic gets a slot, so a sample passenger value is cleared per passenger", async () => {
    const { passJson } = await loadTemplate("templates/cebpac.pkpasstemplate");
    const b = discoverBindings(passJson);
    const ceb = { fields: templateFieldDescriptors(passJson, b), bindings: b, semantics: passJson.semantics, preview: passJson };
    const base = templateSlots(ceb);
    expect(base.some(s => s.id === "sem:boardingGroup")).toBe(true);
    expect(base.some(s => s.id === "sem:eventType")).toBe(false);
    const slots = issueSlots(base, defaultIndividual(base));
    const sem = passengerSemantics(slots, { "sem:passengerName": { givenName: "A", familyName: "B" } });
    expect(sem.boardingGroup).toBeNull();
    expect(applyTemplateData(passJson, { semantics: sem }).semantics.boardingGroup).toBeUndefined();
  });

  it("studio bodies rewrite bound iOS 26 additional-info rows too", () => {
    const d = structuredClone(design);
    d.iOS26 = { ...(d.iOS26 ?? {}), additionalInfoFields: [{ key: "booking", label: "BOOKING", value: "GHK2X9" }] };
    const slots = [{ id: "sem:confirmationNumber", sem: "confirmationNumber", fieldKeys: ["booking"], widget: "text", kind: "text" }];
    const body = buildStudioIssueBody({ design: d, groupId: "G", serial: "S", slots, values: { "sem:confirmationNumber": "REAL42" } });
    expect(body.iOS26.additionalInfoFields[0].value).toBe("REAL42");
  });
});

describe("preview + roster", () => {
  it("previews one passenger without the template's sample person", () => {
    const slots = templateSlots(devSample);
    const p = previewFor(devSample.preview, slots, { ...FLIGHT, ...PAX }, "S-1");
    expect(p.boardingPass.secondaryFields.find(f => f.key === "passenger").value).toBe("MARIA SOLIVERES");
    expect(p.semantics.passengerName.familyName).toBe("Soliveres");
  });
  it("maps semantic-keyed roster entries straight onto slots and back", () => {
    const slots = templateSlots(devSample);
    const v = rosterToValues({ semantics: { passengerName: "SOLIVERES/ANGELO", membershipProgramNumber: "X1", nonsense: 1 } }, slots);
    expect(v["sem:passengerName"]).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(displayName(v)).toBe("SOLIVERES / ANGELO");
    expect(valuesToRoster({ ...PAX, ...FLIGHT }, slots, defaultIndividual(slots))).toEqual({ passengerName: PAX["sem:passengerName"], seats: PAX["sem:seats"], boardingSequenceNumber: "043" });
    expect(splitName("Juan Dela Cruz")).toEqual({ givenName: "Juan Dela", familyName: "Cruz" });
  });
});

describe("Issue round-trip: a value-less airline design with 24h times and token labels", async () => {
  const { toPassView } = await import("../apps/designer/src/preview/wallet/model.js");
  const base = JSON.parse(await readFile("fixtures/fully-loaded.json", "utf8"));
  // What conversion produces: no sample passenger/schedule, a token label, a
  // 24h time field and a confirmed binding (discovery has no values to use).
  const airline = {
    ...base,
    semantics: { airlineCode: "RP" },
    displayFields: {
      header: [], secondary: [], back: [],
      primary: [{ key: "depart", label: "{departureCityName:upper}", value: "" }],
      auxiliary: [{ key: "boarding", label: "BOARDING", value: "", timeFormat: "24h" }]
    }
  };
  const surface = formStateToPassJson(airline, { resolveFields: false });
  const bindings = {
    currentBoardingDate: { fieldKey: "boarding", source: "manual", confidence: "high" },
    departureAirportCode: { fieldKey: "depart", source: "manual", confidence: "high" }
  };
  const tpl = { fields: templateFieldDescriptors(surface, bindings), bindings, semantics: airline.semantics, preview: surface };
  const all = templateSlots(tpl);
  const slots = issueSlots(all, defaultIndividual(all));
  const values = { ...FLIGHT, ...PAX, "sem:departureCityName": "San Francisco" };

  it("the boarding slot drives the 24h field: ISO stored, HH:mm built", () => {
    expect(slots.find(s => s.sem === "currentBoardingDate").fieldKeys).toEqual(["boarding"]);
    const body = buildStudioIssueBody({ design: airline, designName: "rp", groupId: "RP248@2026-11-02", serial: "RP248-001", slots, values });
    expect(body.displayFields.auxiliary[0]).toMatchObject({ value: "2026-11-02T07:30:00-08:00", timeFormat: "24h" });
    const built = formStateToPassJson(body).boardingPass;
    expect(built.auxiliaryFields[0].value).toBe("07:30");
    expect(built.primaryFields[0]).toMatchObject({ label: "SAN FRANCISCO", value: "SFO" });
  });

  it("the Issue preview renders the same", () => {
    const v = toPassView(previewFor(tpl.preview, slots, values, "RP248-001"));
    expect(v.auxiliary[0].value).toBe("07:30");
    expect(v.primary[0]).toMatchObject({ label: "SAN FRANCISCO", value: "SFO" });
  });
});

describe("routes ↔ the Flight step's shared values", async () => {
  const { routeToShared, routeFromShared, withRouteSemantics } = await import("../apps/designer/src/issue/model.js");
  const tpl = {
    fields: [
      { key: "depart", label: "FROM", kind: "iata", boundSemantic: "departureAirportCode" },
      { key: "boarding", label: "BOARDING", kind: "date", boundSemantic: "currentBoardingDate" },
      { key: "dep", label: "DEPART", kind: "date", boundSemantic: "currentDepartureDate" },
      { key: "arr", label: "ARRIVE", kind: "date", boundSemantic: "currentArrivalDate" },
      { key: "note", label: "NOTE", kind: "text", boundSemantic: null },
      { key: "seat", label: "SEAT", kind: "seat", boundSemantic: "seats" }
    ],
    bindings: {}, semantics: { airlineCode: "PR" },
    preview: { boardingPass: { primaryFields: [{ key: "depart", label: "FROM", value: "" }], backFields: [{ key: "note", label: "NOTE", value: "" }] } }
  };
  const route = {
    template: { kind: "studio", id: "pal" },
    values: { flightNumber: 2987, departureAirportCode: "MNL", departureAirportName: "Ninoy Aquino Intl", departureLocationTimeZone: "Asia/Manila" },
    schedule: { boarding: "16:05", departure: "16:35", arrival: "17:55" },
    fields: { note: "Terminal 3" }
  };

  it("route values without a slot get one (as template semantics), then seed typed values", () => {
    const t = withRouteSemantics(tpl, route);
    expect(t.semantics).toMatchObject({ airlineCode: "PR", departureAirportName: "Ninoy Aquino Intl" });
    const slots = templateSlots(t);
    const shared = routeToShared(route, slots);
    expect(shared).toMatchObject({
      "sem:flightNumber": 2987, "sem:departureAirportCode": "MNL", "sem:departureAirportName": "Ninoy Aquino Intl",
      "sem:departureAirportTimeZone": "Asia/Manila", "field:note": "Terminal 3"
    });
  });

  it("saves the shared flight as a route: effective route values, times of day, raw fields; no gate/passenger/date", () => {
    const slots = templateSlots(tpl);
    const individual = defaultIndividual(slots);
    const shared = {
      "sem:flightNumber": 2987, "sem:departureAirportCode": "MNL", "sem:departureGate": "12",
      "sem:currentBoardingDate": "2026-10-12T16:05:00+08:00", "sem:currentDepartureDate": "2026-10-12T23:35:00+08:00",
      "sem:currentArrivalDate": "2026-10-13T01:10:00+08:00", "field:note": "Terminal 3"
    };
    const r = routeFromShared(slots, shared, individual);
    expect(r.values).toMatchObject({ airlineCode: "PR", flightNumber: 2987, departureAirportCode: "MNL" });
    expect(r.values.departureGate).toBeUndefined();
    expect(Object.keys(r.values).some(k => /Date$/.test(k))).toBe(false);
    expect(r.schedule).toEqual({ boarding: "16:05", departure: "23:35", arrival: "01:10", arrivalDayOffset: 1 });
    expect(r.fields).toEqual({ note: "Terminal 3" });
  });
});
