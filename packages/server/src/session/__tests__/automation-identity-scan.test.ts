/**
 * Cold-start scan tolerance for a malformed automation identity (#X1) and the
 * restoration of a well-formed one.
 *
 * `.meta.json` is a cache: every field is optional and a structurally wrong
 * value must degrade, never throw. A `automationRun` missing its `runId` is
 * exactly that case — the scan must still yield the session and must not skip
 * the whole cwd directory (which would drop its siblings too).
 *
 * See change: fix-automation-identity-persistence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type SessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAllSessions } from "../session-scanner.js";

let tmpDir: string;

/** Seed `<ts>_<id>.jsonl` + `.meta.json` under a cwd bucket, as the dashboard does. */
function seed(sessionId: string, meta: SessionMeta): void {
  const dir = path.join(tmpDir, "--test-cwd--");
  fs.mkdirSync(dir, { recursive: true });
  const sessionFile = path.join(dir, `2026-03-30T21-39-43-034Z_${sessionId}.jsonl`);
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify({ type: "session", id: sessionId, cwd: "/test/cwd", timestamp: "2026-03-30T21:39:43.034Z" })}\n`,
  );
  writeSessionMeta(sessionFile, meta);
}

describe("automation identity cold-start scan", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automation-identity-scan-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("#X1 a malformed automationRun does not break the scan or skip the directory", () => {
    // Structurally wrong: `runId` is required by the type but absent here.
    seed("malformed", {
      cwd: "/test/cwd",
      status: "ended",
      startedAt: 1,
      kind: "automation",
      automationRun: { name: "nightly" } as SessionMeta["automationRun"],
    });
    // A well-formed sibling in the SAME cwd bucket proves the directory is not skipped.
    seed("valid", {
      cwd: "/test/cwd",
      status: "ended",
      startedAt: 1,
      kind: "automation",
      automationRun: { name: "weekly", runId: "r2", visibility: "shown" },
    });

    let result: ReturnType<typeof scanAllSessions>;
    expect(() => {
      result = scanAllSessions(tmpDir);
    }).not.toThrow();

    const ids = result!.sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["malformed", "valid"]);

    const valid = result!.sessions.find((s) => s.id === "valid");
    expect(valid?.kind).toBe("automation");
    expect(valid?.automationRun).toEqual({ name: "weekly", runId: "r2", visibility: "shown" });
  });
});
