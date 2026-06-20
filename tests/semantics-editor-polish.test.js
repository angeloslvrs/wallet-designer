// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderSemanticsEditor } from "../apps/designer/src/semantics-editor.js";

const render = (values = {}) => {
  let out;
  const el = renderSemanticsEditor({ values, onChange: (v) => { out = v; } });
  document.body.appendChild(el);
  return { el, last: () => out };
};

describe("semantics editor — polish", () => {
  it("groups fields under labeled section headers", () => {
    const { el } = render();
    const sched = el.querySelector('.sem-section[data-group="schedule"]');
    expect(sched).toBeTruthy();
    expect(sched.querySelector(".sem-head").textContent).toMatch(/schedule/i);
    expect(sched.querySelector('[data-sem="originalBoardingDate"]')).toBeTruthy();
  });

  it("marks required fields with * and recommended ones", () => {
    const { el } = render();
    expect(el.querySelector('[data-sem="airlineCode"] label').textContent).toMatch(/\*/);
    expect(el.querySelector('[data-sem="seats"] label').textContent).toMatch(/recommended/i);
  });

  it("shows a format hint per field", () => {
    const { el } = render();
    expect(el.querySelector('[data-sem="departureAirportCode"] .sem-hint').textContent).toMatch(/IATA/);
  });

  it("edits only the airport time zone and mirrors it to the hidden location twin", () => {
    const { el, last } = render();
    expect(el.querySelector('[data-sem="departureAirportTimeZone"]')).toBeTruthy();
    expect(el.querySelector('[data-sem="departureLocationTimeZone"]')).toBeNull();
    const inp = el.querySelector('[data-sem="departureAirportTimeZone"] input');
    inp.value = "Asia/Manila"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(last().departureAirportTimeZone).toBe("Asia/Manila");
    expect(last().departureLocationTimeZone).toBe("Asia/Manila");
  });

  it("shows an inline error for a malformed airport code on blur", () => {
    const { el } = render();
    const row = el.querySelector('[data-sem="departureAirportCode"]');
    const inp = row.querySelector("input");
    inp.value = "XX"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("focusout", { bubbles: true }));
    const err = row.querySelector(".field-err");
    expect(err.classList.contains("show")).toBe(true);
    expect(err.textContent).toMatch(/3 letters/i);
  });

  it("does not show errors before the field is touched", () => {
    const { el } = render();
    const err = el.querySelector('[data-sem="departureAirportCode"] .field-err');
    expect(err.classList.contains("show")).toBe(false);
  });
});
