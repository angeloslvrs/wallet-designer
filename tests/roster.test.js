import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRosterBody } from "../apps/server/src/routes/admin.js";
import { rosterEntryToRowValues, rowValuesToSemantics } from "../apps/designer/src/issue.js";

// Saved passengers ("roster"): a server-side store of semantic-keyed entries
// (spec: works across templates — semantics are Apple's fixed vocabulary, so
// the designer resolves them to a template's field keys through its bindings
// at load time, dropping values with no bound field like skippedFields does).

/** Fresh "boot": storage.js resolves STATE_PATH at import time. */
async function bootStorage() {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "wpd-roster-"));
  process.env.STATE_PATH = join(dir, "passes.json");
  return import("../apps/server/src/storage.js");
}

describe("roster storage — upsert / list / delete", () => {
  let store;
  beforeEach(async () => { store = await bootStorage(); });

  it("creates an entry with a generated id and round-trips label/semantics/prefs", async () => {
    const saved = await store.saveRosterEntry({
      label: "DAD",
      semantics: { passengerName: "DELACRUZ/ROBERTO", membershipProgramNumber: "5J-99120" },
      prefs: { seat: "window" }
    });
    expect(saved.id).toMatch(/^p_[0-9a-f]{12}$/);
    expect(saved.label).toBe("DAD");
    expect(saved.semantics).toEqual({ passengerName: "DELACRUZ/ROBERTO", membershipProgramNumber: "5J-99120" });
    expect(saved.prefs).toEqual({ seat: "window" });
    expect(new Date(saved.updatedAt).getTime()).not.toBeNaN();
    expect(await store.listRoster()).toEqual([saved]);
  });

  it("upserts by id — the same id replaces the entry instead of adding one", async () => {
    const first = await store.saveRosterEntry({ label: "MOM", semantics: { passengerName: "DELACRUZ/ELENA" } });
    const updated = await store.saveRosterEntry({
      id: first.id, label: "MOM", semantics: { passengerName: "DELACRUZ/ELENA", membershipProgramNumber: "5J-99121" }
    });
    expect(updated.id).toBe(first.id);
    const all = await store.listRoster();
    expect(all).toHaveLength(1);
    expect(all[0].semantics.membershipProgramNumber).toBe("5J-99121");
  });

  it("omits label/prefs when absent (keys stay absent, not null)", async () => {
    const saved = await store.saveRosterEntry({ semantics: { passengerName: "REYES/PEDRO" } });
    expect("label" in saved).toBe(false);
    expect("prefs" in saved).toBe(false);
  });

  it("reports created via a non-enumerable flag decided atomically with the write", async () => {
    // New id -> created:true; re-upserting the same id -> created:false. The flag
    // is the store's single source of truth (route reads it for 201-vs-200), and
    // it's non-enumerable so it never leaks into the serialized entry shape.
    const first = await store.saveRosterEntry({ id: "p_fixed", semantics: { passengerName: "A/ONE" } });
    expect(first.created).toBe(true);
    expect(Object.keys(first)).not.toContain("created");           // stays out of the JSON body
    expect(JSON.parse(JSON.stringify(first))).not.toHaveProperty("created");
    const again = await store.saveRosterEntry({ id: "p_fixed", semantics: { passengerName: "A/TWO" } });
    expect(again.created).toBe(false);
  });

  it("exactly one of two concurrent upserts of the same new id reports created", async () => {
    // The race the fix closes: with a read-before-write in the route, both could
    // see "absent" and both 201. Now the flag comes from the write helper, so a
    // pair of interleaved upserts yields exactly one created:true.
    const [a, b] = await Promise.all([
      store.saveRosterEntry({ id: "p_race", semantics: { passengerName: "R/ONE" } }),
      store.saveRosterEntry({ id: "p_race", semantics: { passengerName: "R/TWO" } })
    ]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect((await store.listRoster()).filter(e => e.id === "p_race")).toHaveLength(1);
  });

  it("lists entries in insertion order and deletes by id", async () => {
    const a = await store.saveRosterEntry({ semantics: { passengerName: "A/ONE" } });
    const b = await store.saveRosterEntry({ semantics: { passengerName: "B/TWO" } });
    expect((await store.listRoster()).map(e => e.id)).toEqual([a.id, b.id]);
    expect(await store.deleteRosterEntry(a.id)).toBe(true);
    expect(await store.deleteRosterEntry(a.id)).toBe(false);   // already gone
    expect((await store.listRoster()).map(e => e.id)).toEqual([b.id]);
  });
});

describe("POST /api/roster body validation", () => {
  it("accepts a minimal valid body and a full one", () => {
    expect(validateRosterBody({ semantics: { passengerName: "DOE/JANE" } })).toBeNull();
    expect(validateRosterBody({
      id: "p_01", label: "DAD",
      semantics: { passengerName: "DOE/JOHN", membershipProgramNumber: "XX-1" },
      prefs: { seat: "aisle" }
    })).toBeNull();
  });

  it("rejects missing/empty/non-string semantics and malformed extras", () => {
    expect(validateRosterBody({})).toMatch(/semantics/);
    expect(validateRosterBody({ semantics: {} })).toMatch(/empty/);
    expect(validateRosterBody({ semantics: { passengerName: 5 } })).toMatch(/passengerName/);
    expect(validateRosterBody({ semantics: { passengerName: " " } })).toMatch(/passengerName/);
    expect(validateRosterBody({ semantics: ["nope"] })).toMatch(/semantics/);
    expect(validateRosterBody({ id: "", semantics: { passengerName: "X/Y" } })).toMatch(/id/);
    expect(validateRosterBody({ label: 7, semantics: { passengerName: "X/Y" } })).toMatch(/label/);
    expect(validateRosterBody({ prefs: "window", semantics: { passengerName: "X/Y" } })).toMatch(/prefs/);
  });
});

describe("semantic ↔ field-key mapping through template bindings", () => {
  // A template's discovered bindings: semanticKey → {fieldKey} (polarity rule:
  // field keys are the template's arbitrary vocabulary, never guessed).
  const bindings = {
    passengerName: { fieldKey: "name", source: "label", confidence: "high" },
    seats: { fieldKey: "seat", source: "label", confidence: "high" },
    membershipProgramNumber: { fieldKey: "ff", source: "sample", confidence: "low" }
  };

  it("maps a roster entry's semantics onto the template's field keys on load", () => {
    const entry = { id: "p_01", semantics: { passengerName: "DELACRUZ/ROBERTO", membershipProgramNumber: "5J-99120" } };
    expect(rosterEntryToRowValues(entry, bindings)).toEqual({ name: "DELACRUZ/ROBERTO", ff: "5J-99120" });
  });

  it("drops semantics with no bound field (skippedFields polarity)", () => {
    const entry = { id: "p_02", semantics: { passengerName: "X/Y", boardingGroup: "A" } };
    expect(rosterEntryToRowValues(entry, bindings)).toEqual({ name: "X/Y" });
    expect(rosterEntryToRowValues(entry, {})).toEqual({});
    expect(rosterEntryToRowValues(entry, undefined)).toEqual({});
  });

  it("harvests a row's values back into semantics by inverting the bindings", () => {
    expect(rowValuesToSemantics({ name: "REYES/PEDRO", seat: "14C", seq: "003" }, bindings))
      .toEqual({ passengerName: "REYES/PEDRO", seats: "14C" });   // seq is unbound → dropped
  });

  it("drops empty values on save (a blank field is not a semantic)", () => {
    expect(rowValuesToSemantics({ name: "  ", seat: "12A" }, bindings)).toEqual({ seats: "12A" });
  });

  it("round-trips: save a row, load it on a template with the same bindings", () => {
    const semantics = rowValuesToSemantics({ name: "DELACRUZ/ELENA", ff: "5J-99121" }, bindings);
    expect(rosterEntryToRowValues({ semantics }, bindings)).toEqual({ name: "DELACRUZ/ELENA", ff: "5J-99121" });
  });
});
