// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { localUtcOffset, renderTypedInput, zoneOffset } from "../apps/designer/src/inputs.js";

function mount(opts) {
  let last;
  const el = renderTypedInput({ ...opts, onChange: (v) => { last = v; } });
  document.body.appendChild(el);
  return { el, get: () => last };
}

describe("renderTypedInput", () => {
  it("date: edits wall-clock + offset, emits ISO with offset preserved", () => {
    const { el, get } = mount({ type: "date", value: "2026-06-13T07:30:00-07:00" });
    const [dateInp, timeInp, off] = el.querySelectorAll("input");
    expect(dateInp.value).toBe("2026-06-13");
    expect(timeInp.value).toBe("07:30");
    expect(off.value).toBe("-07:00");
    timeInp.value = "09:45"; timeInp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("2026-06-13T09:45:00-07:00");
  });
  it("date: blank widget hints the offset, then autofills the edited date's offset on input", () => {
    const { el, get } = mount({ type: "date", value: "" });
    const [dateInp, timeInp, off] = el.querySelectorAll("input");
    expect(dateInp.value).toBe("");
    expect(timeInp.value).toBe("");
    expect(off.value).toBe("");
    expect(off.placeholder).toBe(localUtcOffset());
    expect(off.title).toBe("UTC offset");
    dateInp.value = "2026-06-13"; dateInp.dispatchEvent(new Event("input", { bubbles: true }));
    timeInp.value = "09:45"; timeInp.dispatchEvent(new Event("input", { bubbles: true }));
    const expected = localUtcOffset(new Date("2026-06-13T09:45"));
    expect(off.value).toBe(expected);
    expect(get()).toBe(`2026-06-13T09:45:00${expected}`);
  });
  it("number: emits a Number", () => {
    const { el, get } = mount({ type: "number", value: 5 });
    const inp = el.querySelector("input");
    inp.value = "5057"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe(5057);
  });
  it("boolean: emits true/false from a select", () => {
    const { el, get } = mount({ type: "boolean", value: false });
    const sel = el.querySelector("select");
    sel.value = "true"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(get()).toBe(true);
  });
  it("personName: emits {givenName, familyName}", () => {
    const { el, get } = mount({ type: "personName", value: { givenName: "Juan", familyName: "Cruz" } });
    const [g, f] = el.querySelectorAll("input");
    expect(g.value).toBe("Juan"); expect(f.value).toBe("Cruz");
    f.value = "Dela Cruz"; f.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toEqual({ givenName: "Juan", familyName: "Dela Cruz" });
  });
  it("stringArray: emits an array from a comma list", () => {
    const { el, get } = mount({ type: "stringArray", value: ["A"] });
    const inp = el.querySelector("input");
    inp.value = "A, B , C"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toEqual(["A", "B", "C"]);
  });
  it("enum: emits the chosen option", () => {
    const { el, get } = mount({ type: "enum", value: "PKEventTypeGeneric", enumOptions: ["PKEventTypeGeneric", "PKEventTypeBoarding"] });
    const sel = el.querySelector("select");
    sel.value = "PKEventTypeBoarding"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(get()).toBe("PKEventTypeBoarding");
  });
  it("text: emits the string", () => {
    const { el, get } = mount({ type: "text", value: "MNL" });
    const inp = el.querySelector("input");
    inp.value = "NRT"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("NRT");
  });
});

describe("airport-zone offsets", () => {
  it("computes a zone's offset at a wall-clock time, DST included; unknown zones are null", () => {
    expect(zoneOffset("2026-11-02T07:30", "America/Los_Angeles")).toBe("-08:00");
    expect(zoneOffset("2026-07-02T07:30", "America/Los_Angeles")).toBe("-07:00");
    expect(zoneOffset("2026-07-02T07:30", "UTC")).toBe("+00:00");
    expect(zoneOffset("2026-07-02T07:30", "Not/AZone")).toBeNull();
  });

  it("an auto offset re-mounted from a value keeps tracking the date (not frozen as typed)", () => {
    let v;
    const w = renderTypedInput({ type: "date", value: "2026-11-02T08:00:00-08:00", zone: "America/Los_Angeles", onChange: (x) => { v = x; } });
    const date = w.querySelector('input[type="date"]');
    date.value = "2026-07-02";
    date.dispatchEvent(new Event("input"));
    expect(v).toBe("2026-07-02T08:00:00-07:00");
  });

  it("a hand-typed offset is kept", () => {
    let v;
    const w = renderTypedInput({ type: "date", value: "2026-11-02T08:00:00+05:30", zone: "America/Los_Angeles", onChange: (x) => { v = x; } });
    const date = w.querySelector('input[type="date"]');
    date.value = "2026-07-02";
    date.dispatchEvent(new Event("input"));
    expect(v).toBe("2026-07-02T08:00:00+05:30");
  });
});

describe("pattern attributes", () => {
  // Browsers compile `pattern` as ^(?:…)$ with the `v` flag, where an unescaped
  // "-" inside a character class is a syntax error: the browser logs it and
  // silently skips validation.
  const compiles = (p) => { new RegExp(`^(?:${p})$`, "v"); return true; };

  it("the date picker's UTC offset pattern is valid under the v flag and matches offsets", () => {
    const { el } = mount({ type: "date", value: "2026-10-12T16:05:00+08:00", label: "Boarding" });
    const off = el.querySelector('input[title="UTC offset"]');
    expect(compiles(off.pattern)).toBe(true);
    const re = new RegExp(`^(?:${off.pattern})$`, "v");
    for (const ok of ["Z", "+08:00", "-05:00"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["08:00", "+8:00", "+08", "z"]) expect(re.test(bad)).toBe(false);
  });

  it("every field-kind pattern is valid under the v flag", async () => {
    const { kindAttrs } = await import("../packages/pass-builder/field-kinds.js");
    for (const kind of ["text", "iata", "number", "date", "seat", "timezone"]) {
      const p = kindAttrs(kind)?.pattern;
      if (p) expect(compiles(p), `${kind}: ${p}`).toBe(true);
    }
  });
});
