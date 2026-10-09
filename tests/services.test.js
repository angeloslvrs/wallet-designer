import { describe, it, expect } from "vitest";
import { SERVICE_LINKS, serviceLinkError } from "../packages/pass-builder/services.js";
import { formStateToPassJson } from "../packages/pass-builder/form-to-pass.js";
import { validate } from "../packages/pass-builder/validate.js";
import { readFileSync } from "node:fs";

// The boarding-pass services page: airline-level top-level pass.json keys.
const base = () => JSON.parse(readFileSync("fixtures/minimal.json", "utf8"));

describe("services links", () => {
  it("covers Apple's boarding-pass services keys", () => {
    expect(SERVICE_LINKS.map(l => l.key)).toEqual(expect.arrayContaining(["managementURL", "changeSeatURL", "purchaseWifiURL", "transitProviderPhoneNumber"]));
  });
  it("validates links, emails and phone numbers", () => {
    expect(serviceLinkError("url", "https://www.philippineairlines.com/manage")).toBeNull();
    expect(serviceLinkError("url", "http://x.com")).toMatch(/https/);
    expect(serviceLinkError("url", "pal.com")).toMatch(/full link/);
    expect(serviceLinkError("email", "help@pal.com")).toBeNull();
    expect(serviceLinkError("email", "nope")).toMatch(/email/);
    expect(serviceLinkError("phone", "+63 2 8855 8888")).toBeNull();
    expect(serviceLinkError("phone", "call us")).toMatch(/phone/);
    expect(serviceLinkError("url", "")).toBeNull();
  });
  it("a design's services ship as top-level pass.json keys and validate", () => {
    const s = base();
    s.services = { managementURL: "https://pal.example/manage", transitProviderPhoneNumber: "+63 2 8855 8888", upgradeURL: "" };
    expect(validate(s).ok).toBe(true);
    const p = formStateToPassJson(s);
    expect(p.managementURL).toBe("https://pal.example/manage");
    expect(p.transitProviderPhoneNumber).toBe("+63 2 8855 8888");
    expect("upgradeURL" in p).toBe(false);
    s.services = { notAKey: "x" };
    expect(validate(s).ok).toBe(false);
  });
});
