import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTemplateData, loadTemplate, mirrorTimeZoneAliases, stripInternalIds } from "../packages/pass-builder/template.js";

// End-to-end against the REAL Pass Designer export committed under
// templates/cebpac.pkpasstemplate: issuing a pass must leave NO Designer
// sample timestamp or sample semantic (passenger, seat) on the emitted pass,
// and the build-time hygiene (tooling.json excluded, _id stripped) must hold.
let issueTemplatePass, getPassRecord;

const SAMPLE_TIMESTAMP_PREFIX = "2026-06-12";   // every cebpac sample date is on this day
const SAMPLE_PASSENGER = ["Juan", "Dela Cruz", "DELA CRUZ/JUAN"];

beforeAll(async () => {
  process.env.TEMPLATES_DIR = "templates";      // the repo's own bundles
  process.env.STATE_PATH = join(await mkdtemp(join(tmpdir(), "wpd-state-ceb-")), "passes.json");
  ({ issueTemplatePass } = await import("../apps/server/src/routes/admin.js"));
  ({ getPassRecord } = await import("../apps/server/src/storage.js"));
});

describe("cebpac template — issued passes carry no Designer sample data", () => {
  it("replaces or clears every sample timestamp and sample semantic", async () => {
    await issueTemplatePass({
      template: "cebpac", serialNumber: "CEB-001", groupId: "5J5056@2026-08-01",
      data: {
        passenger: "SOLIVERES/ANGELO",
        seat: "23F",
        boardingTime: "2026-08-01T09:10:00+08:00",
        date: "2026-08-01T10:00:00+08:00",
        term: "1 DOM",
        sequence: "12"
      }
    });
    const rec = await getPassRecord("CEB-001");
    const passJson = JSON.parse(await readFile("templates/cebpac.pkpasstemplate/pass.json", "utf8"));
    const merged = mirrorTimeZoneAliases(stripInternalIds(applyTemplateData(passJson, rec.data)));

    const semanticsJson = JSON.stringify(merged.semantics);
    expect(semanticsJson).not.toContain(SAMPLE_TIMESTAMP_PREFIX);
    for (const sample of SAMPLE_PASSENGER) expect(semanticsJson).not.toContain(sample);

    expect(merged.semantics.passengerName).toEqual({ givenName: "ANGELO", familyName: "SOLIVERES" });
    expect(merged.semantics.seats).toEqual([{ seatRow: "23", seatNumber: "F" }]);
    expect(merged.semantics.currentBoardingDate).toBe("2026-08-01T09:10:00+08:00");
    expect(merged.semantics.originalBoardingDate).toBe("2026-08-01T09:10:00+08:00");
    expect(merged.semantics.currentDepartureDate).toBe("2026-08-01T10:00:00+08:00");
    expect(merged.semantics.originalDepartureDate).toBe("2026-08-01T10:00:00+08:00");
    // arrival had no bound field and no input → cleared, not the sample
    expect(merged.semantics.currentArrivalDate).toBeUndefined();
    expect(merged.semantics.originalArrivalDate).toBeUndefined();
    expect(merged.semantics.departureTerminal).toBe("1 DOM");
    expect(merged.semantics.boardingSequenceNumber).toBe("12");

    // build-time hygiene on the emitted pass.json
    expect(JSON.stringify(merged)).not.toContain("_id");

    // both time-zone key spellings, same IANA value (Designer carries one)
    expect(merged.semantics.departureAirportTimeZone).toBe("Asia/Manila");
    expect(merged.semantics.departureLocationTimeZone).toBe("Asia/Manila");
    expect(merged.semantics.destinationAirportTimeZone).toBe("Asia/Tokyo");
    expect(merged.semantics.destinationLocationTimeZone).toBe("Asia/Tokyo");
  });

  it("excludes Pass Designer's tooling.json from the built pass while keeping it on disk", async () => {
    const { assets } = await loadTemplate("templates/cebpac.pkpasstemplate");
    expect(Object.keys(assets)).not.toContain("tooling.json");
    expect(Object.keys(assets)).toContain("icon@2x.png");
    // on disk the bundle stays faithful to what Designer exported
    await expect(readFile("templates/cebpac.pkpasstemplate/tooling.json", "utf8")).resolves.toBeTruthy();
  });
});
