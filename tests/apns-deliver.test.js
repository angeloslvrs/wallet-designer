import { describe, it, expect } from "vitest";
import { deliver } from "../apps/server/src/apns.js";

// A fake HTTP/2 stream that scripts the APNs response for one request, mimicking
// the node:http2 client-stream event protocol (response -> data -> end | error).
function fakeStream(outcome) {
  const h = {};
  return {
    setEncoding() {},
    on(ev, cb) { h[ev] = cb; return this; },
    end() {
      queueMicrotask(() => {
        if (outcome.error) { h.error?.(new Error(outcome.error)); return; }
        h.response?.({ ":status": outcome.status });
        if (outcome.body) h.data?.(outcome.body);
        h.end?.();
      });
    }
  };
}

// A fake session: maps each device token to a scripted outcome. `throwOnRequest`
// simulates a dead/half-open session whose .request() throws synchronously
// (what a GOAWAY'd session does on the next push).
function fakeSession(outcomes, { throwOnRequest = false } = {}) {
  return {
    destroyed: false, closed: false,
    request(headers) {
      if (throwOnRequest) throw new Error("ERR_HTTP2_GOAWAY_SESSION");
      const token = headers[":path"].split("/").pop();
      return fakeStream(outcomes[token] ?? { status: 200 });
    },
    destroy() {}, ping(cb) { cb(); }
  };
}

const devs = (...tokens) => tokens.map(t => ({ deviceLibraryIdentifier: "dev-" + t, pushToken: t }));
const factory = (s) => async () => s;

describe("apns deliver()", () => {
  it("counts 2xx as sent, no failures or pruning", async () => {
    const s = fakeSession({ a: { status: 200 }, b: { status: 200 } });
    const r = await deliver({ getSession: factory(s), reconnect: factory(s), passTypeId: "pass.test", devices: devs("a", "b") });
    expect(r.sent).toBe(2);
    expect(r.failures).toEqual([]);
    expect(r.unregistered).toEqual([]);
  });

  it("reports 410 'Unregistered' tokens to prune, not as failures", async () => {
    const s = fakeSession({ a: { status: 200 }, dead: { status: 410, body: '{"reason":"Unregistered"}' } });
    const r = await deliver({ getSession: factory(s), reconnect: factory(s), passTypeId: "pass.test", devices: devs("a", "dead") });
    expect(r.sent).toBe(1);
    expect(r.failures).toEqual([]);
    expect(r.unregistered.map(d => d.pushToken)).toEqual(["dead"]);
  });

  it("records non-2xx, non-410 responses as failures with their status", async () => {
    const s = fakeSession({ bad: { status: 400, body: '{"reason":"BadDeviceToken"}' } });
    const r = await deliver({ getSession: factory(s), reconnect: factory(s), passTypeId: "pass.test", devices: devs("bad") });
    expect(r.sent).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ token: "bad", status: 400 });
  });

  it("retries a transport failure once on a freshly-reconnected session", async () => {
    const dead = fakeSession({}, { throwOnRequest: true });
    const live = fakeSession({ a: { status: 200 } });
    let reconnects = 0;
    const r = await deliver({
      getSession: factory(dead),
      reconnect: async () => { reconnects++; return live; },
      passTypeId: "pass.test", devices: devs("a")
    });
    expect(reconnects).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("still fails (once) if the reconnect session is also dead", async () => {
    const dead = fakeSession({}, { throwOnRequest: true });
    const r = await deliver({
      getSession: factory(dead), reconnect: factory(dead),
      passTypeId: "pass.test", devices: devs("a")
    });
    expect(r.sent).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.unregistered).toEqual([]);
  });
});
