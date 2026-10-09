// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderForm, DESIGN_SECTIONS, applySuggestions } from "../apps/designer/src/form.js";
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

describe("Design editor — date fields", () => {
  it("gives a date-styled field the typed picker, keeps ISO, and stays click-to-edit", () => {
    setPath("displayFields", { header: [], primary: [], secondary: [], back: [],
      auxiliary: [{ key: "boarding", label: "BOARDING", value: "2026-06-01T07:30:00-07:00", timeStyle: "PKDateStyleShort" }] });
    renderForm(root, { section: "fields" });
    const date = root.querySelector('.wpd-df-date input[type="date"]');
    expect(date.value).toBe("2026-06-01");
    expect(date.dataset.fieldkey).toBe("boarding");
    const time = root.querySelector('.wpd-df-date input[type="time"]');
    time.value = "08:05"; ev(time, "input");
    expect(state.displayFields.auxiliary[0].value).toBe("2026-06-01T08:05:00-07:00");
  });

  it("suggesting from semantics keeps a date field's style and puts the raw ISO in", () => {
    const df = applySuggestions(
      { header: [{ key: "gate", label: "GATE", value: "" }], auxiliary: [{ key: "boarding", label: "BOARDING", value: "", timeStyle: "PKDateStyleShort" }] },
      { departureGate: "C9", currentBoardingDate: "2026-11-02T07:30:00-08:00" });
    expect(df.header[0].value).toBe("C9");
    expect(df.auxiliary[0]).toMatchObject({ value: "2026-11-02T07:30:00-08:00", timeStyle: "PKDateStyleShort" });
  });
});

describe("Design editor — 24-hour time fields and label tokens", () => {
  const iso = "2026-10-12T16:05:00+08:00";
  const withField = (f) => setPath("displayFields", { header: [], primary: [], secondary: [], back: [], auxiliary: [f] });

  it("a timeFormat field gets the date picker and the toggle with 24-hour active", () => {
    withField({ key: "boarding", label: "BOARDING", value: iso, timeFormat: "24h" });
    renderForm(root, { section: "fields" });
    expect(root.querySelector('.wpd-df-date input[type="date"]')).toBeTruthy();
    const active = root.querySelector('.wpd-tfmt [aria-pressed="true"]');
    expect(active.dataset.tfmt).toBe("24h");
  });

  it("toggles between phone format and 24-hour, keeping the ISO value", () => {
    withField({ key: "boarding", label: "BOARDING", value: iso, dateStyle: "PKDateStyleNone", timeStyle: "PKDateStyleShort" });
    renderForm(root, { section: "fields" });
    root.querySelector('.wpd-tfmt [data-tfmt="24h"]').click();
    expect(state.displayFields.auxiliary[0]).toEqual({ key: "boarding", label: "BOARDING", value: iso, timeFormat: "24h" });
    root.querySelector('.wpd-tfmt [data-tfmt="device"]').click();
    expect(state.displayFields.auxiliary[0]).toEqual({ key: "boarding", label: "BOARDING", value: iso, timeStyle: "PKDateStyleShort" });
  });

  it("a plain text field has no time toggle", () => {
    withField({ key: "gate", label: "GATE", value: "12" });
    renderForm(root, { section: "fields" });
    expect(root.querySelector(".wpd-tfmt")).toBeNull();
  });

  it("explains label tokens in the Fields section", () => {
    renderForm(root, { section: "fields" });
    expect(root.textContent).toContain("{departureCityName:upper}");
    expect(root.querySelector(".wpd-df-label").title).toContain("{semanticKey}");
  });

  it("applySuggestions keeps a timeFormat field's ISO value and format", () => {
    const df = applySuggestions({ auxiliary: [{ key: "boarding", label: "BOARDING", value: "", timeFormat: "24h" }] }, { currentBoardingDate: iso });
    expect(df.auxiliary[0]).toEqual({ key: "boarding", label: "BOARDING", value: iso, timeFormat: "24h" });
  });
});
