import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { readTemplateZip } from "../packages/pass-builder/template-zip.js";

const PASS_JSON = JSON.stringify({ formatVersion: 1, boardingPass: { headerFields: [{ key: "gate", value: "—" }] } });

function zipOf(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe("readTemplateZip", () => {
  it("extracts pass.json and assets from a flat zip", () => {
    const files = readTemplateZip(zipOf({ "pass.json": PASS_JSON, "icon.png": "png-bytes" }));
    expect(Object.keys(files).sort()).toEqual(["icon.png", "pass.json"]);
    expect(files["icon.png"].toString()).toBe("png-bytes");
  });

  it("strips the bundle-folder wrapper macOS zips add (Foo.pkpasstemplate/…)", () => {
    const files = readTemplateZip(zipOf({
      "Flight.pkpasstemplate/pass.json": PASS_JSON,
      "Flight.pkpasstemplate/icon.png": "png-bytes",
      "Flight.pkpasstemplate/en.lproj/pass.strings": '"GATE" = "GATE";'
    }));
    expect(Object.keys(files).sort()).toEqual(["en.lproj/pass.strings", "icon.png", "pass.json"]);
  });

  it("drops __MACOSX, .DS_Store, tooling.json, and stale manifest/signature entries", () => {
    const files = readTemplateZip(zipOf({
      "pass.json": PASS_JSON,
      "icon.png": "png-bytes",
      ".DS_Store": "junk",
      "manifest.json": "{}",
      "signature": "stale",
      "tooling.json": '{"designer":"1.0"}',
      "__MACOSX/pass.json": "resource-fork",
      "__MACOSX/._icon.png": "resource-fork"
    }));
    expect(Object.keys(files).sort()).toEqual(["icon.png", "pass.json"]);
  });

  it("never returns a path that could escape the template directory", () => {
    // adm-zip canonicalizes hostile names on read ("../evil.png" → "evil.png");
    // readTemplateZip additionally throws if a raw name ever surfaces. Either
    // way the post-condition is: every returned key is a clean relative path.
    const files = readTemplateZip(zipOf({
      "pass.json": PASS_JSON,
      "../evil.png": "x",
      "/abs.png": "x",
      "a/../../evil2.png": "x"
    }));
    for (const name of Object.keys(files)) {
      expect(name.startsWith("/")).toBe(false);
      expect(name.split("/")).not.toContain("..");
      expect(name).not.toMatch(/^[a-zA-Z]:/);
    }
  });

  it("throws when no pass.json is present", () => {
    expect(() => readTemplateZip(zipOf({ "icon.png": "png-bytes" })))
      .toThrow(/pass\.json/);
  });

  it("throws when pass.json is not valid JSON", () => {
    expect(() => readTemplateZip(zipOf({ "pass.json": "{nope" })))
      .toThrow(/parse/);
  });

  it("throws on a buffer that is not a zip", () => {
    expect(() => readTemplateZip(Buffer.from("not a zip"))).toThrow(/zip/i);
  });
});
