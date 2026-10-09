// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderForm, DESIGN_SECTIONS } from "../apps/designer/src/form.js";
import { state, resetState, setPath } from "../apps/designer/src/state.js";

const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

let root;
beforeEach(() => {
  resetState();
  root = document.createElement("section");
  root.id = "form-pane";
  document.body.appendChild(root);
});

describe("Design editor — one section at a time", () => {
  it("renders each workspace section with its own headed groups", () => {
    const heads = (section) => { renderForm(root, { section }); return [...root.querySelectorAll(".dw-h")].map(e => e.textContent); };
    expect(heads("look")).toEqual(["Brand", "Images"]);
    expect(heads("fields")).toEqual(["Fields on the pass"]);
    expect(heads("flight")).toEqual(["Flight data"]);
    expect(root.querySelector(".sem-editor")).toBeTruthy();
    expect(heads("barcode")).toEqual(["Barcode"]);
    expect(heads("advanced")).toEqual(["Pass metadata"]);
    expect(DESIGN_SECTIONS.map(([k]) => k)).toEqual(["look", "fields", "flight", "barcode", "advanced"]);
  });

  it("drives barcode.format from the format buttons", () => {
    renderForm(root, { section: "barcode" });
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
    renderForm(root, { section: "fields" });
    const input = root.querySelector('.wpd-df-value[data-fieldkey="depart"]');
    expect(input).toBeTruthy();
    expect(input.value).toBe("SFO");
  });
});
