/**
 * Board-filter visibility for automation runs.
 *
 * `kind==="automation"` runs are excluded from the board unless their
 * effective `automationRun.visibility` is `"shown"`. Hidden runs can still
 * be revealed via the "show hidden" toggle (same affordance as user-hidden
 * sessions). See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { filterSessions } from "../session/session-grouping.js";
// Deliberate cross-package import: E5 is an integration property — the SERVER
// round-trip (project → restore) feeding the CLIENT board filter. Both halves
// must be real code, or the guard cannot see a restore that drops the identity
// and over-hides a run the user chose to show. The server projection/restore
// are pure w.r.t. this path (no bridge, no I/O beyond a stat that tolerates a
// missing file). See change: fix-automation-identity-persistence.
import { sessionToMeta } from "../../../../server/src/session/session-to-meta.js";
import { sessionFromMeta } from "../../../../server/src/session/session-scanner.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function mk(partial: Partial<DashboardSession>): DashboardSession {
  return {
    id: partial.id ?? "s1",
    cwd: "/repo",
    source: "dashboard",
    status: "running",
    startedAt: 0,
    ...partial,
  } as DashboardSession;
}

describe("filterSessions — automation visibility", () => {
  const plain = mk({ id: "plain" });
  const hiddenRun = mk({
    id: "hiddenRun",
    kind: "automation",
    automationRun: { name: "nightly", runId: "r1", visibility: "hidden" },
  });
  const defaultRun = mk({
    id: "defaultRun",
    kind: "automation",
    automationRun: { name: "nightly", runId: "r2" }, // no visibility → treated as hidden
  });
  const shownRun = mk({
    id: "shownRun",
    kind: "automation",
    automationRun: { name: "brief", runId: "r3", visibility: "shown" },
  });

  it("excludes hidden automation runs from the board", () => {
    const out = filterSessions([plain, hiddenRun, defaultRun, shownRun], false, false);
    const ids = out.map((s) => s.id);
    expect(ids).toContain("plain");
    expect(ids).toContain("shownRun");
    expect(ids).not.toContain("hiddenRun");
    expect(ids).not.toContain("defaultRun");
  });

  it("reveals hidden automation runs when showHidden is true", () => {
    const out = filterSessions([hiddenRun, defaultRun], false, true);
    expect(out.map((s) => s.id).sort()).toEqual(["defaultRun", "hiddenRun"]);
  });

  it("always keeps shown automation runs on the board", () => {
    const out = filterSessions([shownRun], false, false);
    expect(out.map((s) => s.id)).toEqual(["shownRun"]);
  });

  it("#E5 the visibility partition survives the persistence round-trip", () => {
    // Each run is saved and rebuilt exactly as a restart does it — the fix must
    // neither over-hide a shown run (identity lost) nor over-reveal a hidden one.
    const rebuild = (s: DashboardSession): DashboardSession =>
      sessionFromMeta(s.id, "/nonexistent/r.jsonl", s.cwd, sessionToMeta(s), s.startedAt);

    const out = filterSessions([rebuild(hiddenRun), rebuild(shownRun)], false, false);
    const ids = out.map((s) => s.id);
    expect(ids).not.toContain("hiddenRun");
    expect(ids).toContain("shownRun");
  });
});
