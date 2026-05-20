import { describe, it, expect } from "vitest";
import { computeManifest } from "../packages/pass-builder/manifest.js";

describe("computeManifest", () => {
  it("SHA1-hashes each named file", () => {
    const files = {
      "pass.json": Buffer.from('{"a":1}'),
      "icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47])
    };
    const m = computeManifest(files);
    expect(m["pass.json"]).toMatch(/^[a-f0-9]{40}$/);
    expect(m["icon.png"]).toMatch(/^[a-f0-9]{40}$/);
    expect(m["pass.json"]).not.toBe(m["icon.png"]);
  });

  it("produces stable SHA1 for known bytes", () => {
    const files = { "pass.json": Buffer.from("hello") };
    // sha1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
    expect(computeManifest(files)["pass.json"]).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });
});
