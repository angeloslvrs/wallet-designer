import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { accessGuard, isPrivateIp } from "../apps/server/src/middleware/guard.js";

function mkReq({ path = "/", ip = "8.8.8.8", auth } = {}) {
  return { path, ip, header: (n) => (n === "Authorization" ? auth : undefined) };
}
function mkRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b ?? ""; return this; }
  };
}
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

describe("isPrivateIp", () => {
  it("recognizes LAN + loopback ranges", () => {
    for (const ip of ["127.0.0.1", "::1", "10.1.2.5", "192.168.0.4", "172.16.0.1", "::ffff:10.1.2.5"])
      expect(isPrivateIp(ip)).toBe(true);
  });
  it("rejects public addresses", () => {
    for (const ip of ["8.8.8.8", "112.201.182.9", "172.32.0.1"])
      expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("accessGuard", () => {
  const ORIG = { u: process.env.ADMIN_USER, p: process.env.ADMIN_PASSWORD };
  beforeEach(() => { process.env.ADMIN_USER = "gelo"; process.env.ADMIN_PASSWORD = "s3cret"; });
  afterEach(() => { process.env.ADMIN_USER = ORIG.u; process.env.ADMIN_PASSWORD = ORIG.p; });

  it("always allows the PassKit web service, even from the public internet", () => {
    let called = false;
    accessGuard(mkReq({ path: "/api/wallet/v1/log", ip: "8.8.8.8" }), mkRes(), () => { called = true; });
    expect(called).toBe(true);
  });

  it("allows the control plane from the LAN with no auth", () => {
    let called = false;
    accessGuard(mkReq({ path: "/api/build", ip: "10.1.2.5" }), mkRes(), () => { called = true; });
    expect(called).toBe(true);
  });

  it("blocks the control plane from the public internet without auth", () => {
    const res = mkRes(); let called = false;
    accessGuard(mkReq({ path: "/api/build", ip: "8.8.8.8" }), res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toMatch(/Basic/);
  });

  it("allows the control plane from the public internet with valid Basic Auth", () => {
    let called = false;
    accessGuard(mkReq({ path: "/", ip: "8.8.8.8", auth: basic("gelo", "s3cret") }), mkRes(), () => { called = true; });
    expect(called).toBe(true);
  });

  it("rejects wrong credentials", () => {
    const res = mkRes(); let called = false;
    accessGuard(mkReq({ path: "/", ip: "8.8.8.8", auth: basic("gelo", "nope") }), res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
