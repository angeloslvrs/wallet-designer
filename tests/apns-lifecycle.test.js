import { describe, it, expect, afterEach } from "vitest";
import {
  getClient, forceNewClient, deliver,
  _setTestHooks, _resetTestHooks
} from "../apps/server/src/apns.js";

// A fake HTTP/2 client stream (response -> data -> end | error), same protocol
// as node:http2 and the sibling apns-deliver.test.js fake.
function fakeStream(outcome) {
  const h = {};
  return {
    setEncoding() {},
    on(ev, cb) { h[ev] = cb; return this; },
    close() {}, destroy() {},
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

// A stream that never emits response/data/end/error — models a stalled push.
const stalledStream = () => ({ setEncoding() {}, on() { return this; }, close() {}, destroy() {}, end() {} });

// A fake session mimicking the bits apns.js touches: on()/ping()/request()/destroy().
// destroy() flips `destroyed` and fires the registered close handler (as node does).
function makeSession(opts = {}) {
  const handlers = {};
  return {
    destroyed: false,
    closed: false,
    on(ev, cb) { handlers[ev] = cb; return this; },
    emit(ev, ...a) { handlers[ev]?.(...a); },
    ping(cb) { opts.pingOk === false ? cb(new Error("dead")) : cb(); },
    request() { return opts.stalled ? stalledStream() : fakeStream(opts.outcome ?? { status: 200 }); },
    destroy() { if (this.destroyed) return; this.destroyed = true; handlers.close?.(); }
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const devs = (...tokens) => tokens.map(t => ({ deviceLibraryIdentifier: "dev-" + t, pushToken: t }));

afterEach(() => _resetTestHooks());

describe("apns connection lifecycle", () => {
  it("T6: a failed connect() is not cached — the next getClient() retries fresh and can succeed", async () => {
    let reads = 0;
    _setTestHooks({
      profile: "prod",
      // Both reads for the first connect (cert + key) throw; later reads succeed.
      readFile: async () => { reads++; if (reads <= 2) throw new Error("cert missing"); return Buffer.from("pem"); },
      http2: { connect: () => makeSession() }
    });

    await expect(getClient()).rejects.toThrow("cert missing");

    // If the rejected promise were cached, this would reject again forever.
    const session = await getClient();
    expect(session).toBeTruthy();
    expect(session.destroyed).toBe(false);
  });

  it("T7: forceNewClient() destroys the old session and its late close does NOT clobber the live client", async () => {
    const first = makeSession();
    const second = makeSession();
    let n = 0;
    _setTestHooks({
      profile: "prod",
      readFile: async () => Buffer.from("pem"),
      http2: { connect: () => (n++ === 0 ? first : second) }
    });

    const s1 = await getClient();
    expect(s1).toBe(first);

    const s2 = await forceNewClient();
    expect(s2).toBe(second);
    await flush(); // let the deferred destroy(old) run

    // Old session was destroyed (no socket leak) and firing that destroy already
    // exercised its close handler against the guard.
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(false);

    // A further late close from the orphan must still not touch the live cache.
    first.emit("close");
    first.emit("error", new Error("late orphan error"));

    const s3 = await getClient();
    expect(s3).toBe(second); // live connection still cached and reused
  });

  it("T7: a legitimate close on the live session DOES clear the cache (guard allows it)", async () => {
    const first = makeSession();
    const second = makeSession();
    let n = 0;
    _setTestHooks({
      profile: "prod",
      readFile: async () => Buffer.from("pem"),
      http2: { connect: () => (n++ === 0 ? first : second) }
    });

    const s1 = await getClient();
    expect(s1).toBe(first);

    first.emit("close"); // the cached session really went away
    const s2 = await getClient();
    expect(s2).toBe(second); // a fresh connect happened
  });

  it("T8: a stream that never responds settles as a transport error within the timeout (no hang)", async () => {
    _setTestHooks({ streamTimeoutMs: 20 });
    const session = makeSession({ stalled: true });

    const started = Date.now();
    const r = await deliver({
      getSession: async () => session,
      reconnect: async () => session, // retry also stalls
      passTypeId: "pass.test",
      devices: devs("a")
    });

    expect(Date.now() - started).toBeLessThan(2000); // did not hang
    expect(r.sent).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].token).toBe("a");
    expect(r.failures[0].reason).toMatch(/timeout/i);
    expect(r.unregistered).toEqual([]);
  });

  it("T8: the watchdog is cleared on a normal response (no double-settle)", async () => {
    _setTestHooks({ streamTimeoutMs: 20 });
    const session = makeSession({ outcome: { status: 200 } });

    const r = await deliver({
      getSession: async () => session,
      reconnect: async () => session,
      passTypeId: "pass.test",
      devices: devs("a")
    });
    expect(r.sent).toBe(1);

    // Wait past the timeout window; a stray timer must not have re-settled or thrown.
    await flush();
    await new Promise(res => setTimeout(res, 40));
    expect(r.failures).toEqual([]);
  });
});
