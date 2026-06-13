// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountIssue } from "../apps/designer/src/issue.js";

// One template with a text field (gate) and a date field (boardingTime, carrying
// timeStyle → kind "date"). The server sends these descriptors in `fields`.
const TEMPLATE = {
  id: "t1",
  fieldKeys: ["gate", "boardingTime"],
  fields: [
    { key: "gate", label: "Gate", kind: "text" },
    { key: "boardingTime", label: "Boarding", kind: "date" }
  ],
  bindings: {},
  semantics: {},
  assets: []
};

const flush = () => new Promise(r => setTimeout(r, 0));

let root;
beforeEach(() => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/templates")) return { json: async () => [TEMPLATE] };
    throw new Error(`unexpected fetch: ${url}`);
  };
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); delete globalThis.fetch; });

describe("Issue tab — fields render in their expected input type", () => {
  it("renders an ISO-8601 datetime picker for a date field, a text box for a text field", async () => {
    mountIssue(root, () => {});
    await flush();

    // text field → plain text input
    expect(root.querySelector('input[data-shared-key="gate"]')).toBeTruthy();
    // date field → datetime-local picker (not a text box)
    const dateInput = root.querySelector('[data-typed-shared="boardingTime"] input[type="datetime-local"]');
    expect(dateInput).toBeTruthy();
    expect(root.querySelector('input[data-shared-key="boardingTime"]')).toBeNull();
  });

  it("keeps the date picker when the field is individualized per passenger", async () => {
    mountIssue(root, () => {});
    await flush();

    root.querySelector('button[data-act="to-individual"][data-key="boardingTime"]').click();
    await flush();

    const rowPicker = root.querySelector('.iss-row [data-typed-key="boardingTime"] input[type="datetime-local"]');
    expect(rowPicker).toBeTruthy();
  });
});
