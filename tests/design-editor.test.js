// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderForm } from "../apps/designer/src/form.js";
import { state, resetState, setPath } from "../apps/designer/src/state.js";

const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root;
beforeEach(() => {
  resetState();
  root = document.createElement("section");
  root.id = "form-pane";
  document.body.appendChild(root);
});

describe("Design editor — card layout", () => {
  it("renders Brand / Assets / Barcode / Fields cards + Meta & Semantics drawers", () => {
    renderForm(root);
    const eyebrows = [...root.querySelectorAll(".wpd-eyebrow")].map(e => e.textContent);
    expect(eyebrows).toEqual(["Brand", "Assets", "Barcode", "Fields"]);
    const summaries = [...root.querySelectorAll(".wpd-design-drawer > summary")].map(s => s.textContent);
    expect(summaries.some(s => /metadata/i.test(s))).toBe(true);
    expect(summaries.some(s => /semantics/i.test(s))).toBe(true);
  });

  it("drives barcode.format from the format buttons", () => {
    renderForm(root);
    const pdf = root.querySelector('.wpd-fmt-btn[data-fmt="PKBarcodeFormatPDF417"]');
    expect(pdf).toBeTruthy();
    pdf.click();
    expect(state.barcode.format).toBe("PKBarcodeFormatPDF417");
    expect(pdf.classList.contains("is-active")).toBe(true);
    // only one active at a time
    expect(root.querySelectorAll(".wpd-fmt-btn.is-active")).toHaveLength(1);
  });

  it("wires the Organization input to meta.organizationName", () => {
    renderForm(root);
    const org = root.querySelector('input[data-path="meta.organizationName"]');
    org.value = "Acme Air"; ev(org, "input");
    expect(state.meta.organizationName).toBe("Acme Air");
  });

  it("tags display-field value inputs with data-fieldkey for click-to-edit", () => {
    setPath("displayFields", { primary: [{ key: "depart", label: "FROM", value: "SFO" }], header: [], secondary: [], auxiliary: [], back: [] });
    renderForm(root);
    const input = root.querySelector('.wpd-df-value[data-fieldkey="depart"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe("SFO");
  });
});
