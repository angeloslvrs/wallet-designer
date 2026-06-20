// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderTypedInput, widgetFor, fieldHint } from "../apps/designer/src/inputs.js";

describe("widgetFor", () => {
  it("routes *TimeZone keys to the timezone picker", () => {
    expect(widgetFor("departureAirportTimeZone", "text")).toBe("timezone");
    expect(widgetFor("destinationLocationTimeZone", "text")).toBe("timezone");
  });
  it("passes every other key through to its catalog type", () => {
    expect(widgetFor("airlineCode", "text")).toBe("text");
    expect(widgetFor("originalBoardingDate", "date")).toBe("date");
    expect(widgetFor("flightNumber", "number")).toBe("number");
  });
});

describe("fieldHint", () => {
  it("describes the expected value per widget", () => {
    expect(fieldHint("departureAirportTimeZone", "timezone")).toMatch(/IANA/);
    expect(fieldHint("originalBoardingDate", "date")).toMatch(/offset/i);
    expect(fieldHint("seats", "seats")).toMatch(/14A/);
  });
  it("falls back to the validation kind for text fields", () => {
    expect(fieldHint("departureAirportCode", "text")).toMatch(/IATA/);
    expect(fieldHint("boardingSequenceNumber", "text")).toMatch(/number/i);
  });
  it("gives no hint for self-explanatory controls", () => {
    expect(fieldHint("airlineCode", "text")).toBe("");
    expect(fieldHint("silenceRequested", "boolean")).toBe("");
  });
});

function mount(opts) {
  let last;
  const el = renderTypedInput({ ...opts, onChange: (v) => { last = v; } });
  document.body.appendChild(el);
  return { el, get: () => last };
}

describe("renderTypedInput — timezone + attrs", () => {
  it("timezone: renders a datalist-backed input and emits the string", () => {
    const { el, get } = mount({ type: "timezone", value: "Asia/Manila" });
    const inp = el.querySelector("input[list]");
    expect(inp).toBeTruthy();
    expect(el.querySelector("datalist")).toBeTruthy();
    expect(inp.value).toBe("Asia/Manila");
    inp.value = "America/Los_Angeles"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("America/Los_Angeles");
  });
  it("text: applies kindAttrs affordances (maxLength, pattern)", () => {
    const { el } = mount({ type: "text", value: "", attrs: { maxLength: 3, pattern: "[A-Z]{3}" } });
    const inp = el.querySelector("input");
    expect(inp.maxLength).toBe(3);
    expect(inp.getAttribute("pattern")).toBe("[A-Z]{3}");
  });
});
