// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderTypedInput } from "../apps/designer/src/inputs.js";

function mount(opts) {
  let last;
  const el = renderTypedInput({ ...opts, onChange: (v) => { last = v; } });
  document.body.appendChild(el);
  return { el, get: () => last };
}

describe("renderTypedInput", () => {
  it("date: edits wall-clock + offset, emits ISO with offset preserved", () => {
    const { el, get } = mount({ type: "date", value: "2026-06-13T07:30:00-07:00" });
    const [dt, off] = el.querySelectorAll("input");
    expect(dt.value).toBe("2026-06-13T07:30");
    expect(off.value).toBe("-07:00");
    dt.value = "2026-06-13T09:45"; dt.dispatchEvent(new Event("input", { bubbles: true }));
    expect(get()).toBe("2026-06-13T09:45:00-07:00");
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
