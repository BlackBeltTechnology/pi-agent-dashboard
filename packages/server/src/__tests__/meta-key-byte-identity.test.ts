/**
 * E5: emitted `.meta.json` keys are byte-identical to the pre-change baseline.
 *
 * The generic seam merges an owned ref verbatim (no transform), so an
 * automation session still persists `kind`/`automationRun` and a goal session
 * still persists `goalId` with identical field names + values. The ONLY new
 * byte is an additive `recover:false` on an opted-out owned session; a plain
 * user session's `.meta.json` carries NO `recover` key (undefined ⇒ dropped by
 * JSON serialization / the full-overwrite projection).
 * See change: detach-automation-goal-from-core.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  mergeSessionMeta,
  readSessionMeta,
  writeSessionMeta,
  type SessionMeta,
} from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { sessionToMeta } from "../session/session-to-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function tmpMeta(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "pi-meta-")), "s.meta.json");
}

const baseSession = (over: Partial<DashboardSession>): DashboardSession =>
  ({
    id: "s1",
    cwd: "/w",
    status: "ended",
    source: "dashboard",
    startedAt: 1,
    ...over,
  }) as DashboardSession;

describe("meta key byte-identity (E5)", () => {
  it("the seam merges an automation ref verbatim: kind + automationRun byte-match", () => {
    const file = tmpMeta();
    writeSessionMeta(file, { cwd: "/w", status: "ended" } as SessionMeta);
    const ref = { kind: "automation" as const, automationRun: { name: "nightly", runId: "r1", visibility: "hidden" as const } };
    mergeSessionMeta(file, ref);
    const meta = readSessionMeta(file);
    expect(meta?.kind).toBe("automation");
    expect(meta?.automationRun).toEqual({ name: "nightly", runId: "r1", visibility: "hidden" });
  });

  it("the seam merges a goal ref verbatim: goalId byte-match", () => {
    const file = tmpMeta();
    writeSessionMeta(file, { cwd: "/w", status: "ended" } as SessionMeta);
    mergeSessionMeta(file, { goalId: "goal-42" });
    expect(readSessionMeta(file)?.goalId).toBe("goal-42");
  });

  it("an opted-out owned session gains recover:false; a user session carries no recover key", () => {
    // Opted-out (automation/goal) session → additive recover:false byte.
    const optedOut = sessionToMeta(baseSession({ recover: false, kind: "automation" }));
    expect(optedOut.recover).toBe(false);
    expect(JSON.stringify(optedOut)).toContain('"recover":false');

    // Plain user session → recover undefined → NO key after serialization.
    const user = sessionToMeta(baseSession({}));
    expect(user.recover).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain("recover");
  });
});
