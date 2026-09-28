/**
 * `git_info_update` PR-tuple pass-through in `event-wiring.ts`.
 *
 * test-plan #E18: new fields value → stored, `null` → cleared, absent →
 * untouched; `gitPrNumber` null → cleared.
 * test-plan #X3a: an old bridge (number only, no new fields) leaves the new
 * fields absent.
 *
 * See change: redesign-composer-session-strip (D5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rig {
  stop: () => Promise<void>;
  get: (id: string) => DashboardSession | undefined;
  piPort: number;
  tmpDir: string;
}

async function startServer(): Promise<Rig> {
  const { createServer } = await import("../server.js");
  const server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  return {
    stop: () => server.stop(),
    get: (id) => server.sessionManager.get(id) as DashboardSession | undefined,
    piPort: server.piPort()!,
    tmpDir: mkdtempSync(path.join(os.tmpdir(), "pi-prstatus-")),
  };
}

async function connect(rig: Rig, sid: string): Promise<(msg: Record<string, unknown>) => Promise<void>> {
  const sessionFile = path.join(rig.tmpDir, `${sid}.jsonl`);
  writeFileSync(sessionFile, "");
  const ws = new WebSocket(`ws://127.0.0.1:${rig.piPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () => resolve());
  });
  ws.send(JSON.stringify({ type: "session_register", sessionId: sid, cwd: rig.tmpDir, source: "tui", sessionFile }));
  await wait(80);
  return async (msg) => {
    ws.send(JSON.stringify({ type: "git_info_update", sessionId: sid, gitBranch: "os/x", ...msg }));
    await wait(80);
  };
}

const FULL = {
  gitPrNumber: 747,
  gitPrUrl: "https://github.com/o/r/pull/747",
  gitPrState: "open",
  gitPrDraft: false,
  gitPrChecks: "passing",
  gitPrCheckedAt: 1234,
};

describe("event-wiring: git_info_update PR tuple", () => {
  let rig: Rig | undefined;
  afterEach(async () => {
    await rig?.stop();
    rig = undefined;
  });

  it("#E18: value → stored; absent → untouched; null → cleared", async () => {
    rig = await startServer();
    const send = await connect(rig, "pr-e18");

    await send(FULL);
    expect(rig.get("pr-e18")).toMatchObject(FULL);

    // Partially absent new fields → the absent ones stay untouched.
    await send({ gitPrNumber: 747, gitPrUrl: FULL.gitPrUrl, gitPrChecks: "failing" });
    expect(rig.get("pr-e18")).toMatchObject({ ...FULL, gitPrChecks: "failing" });

    // Known-absent → every field cleared.
    await send({ gitPrNumber: null, gitPrUrl: null, gitPrState: null, gitPrDraft: null, gitPrChecks: null, gitPrCheckedAt: null });
    const s = rig.get("pr-e18")!;
    expect(s.gitPrNumber ?? null).toBeNull();
    expect(s.gitPrState ?? null).toBeNull();
    expect(s.gitPrDraft ?? null).toBeNull();
    expect(s.gitPrChecks ?? null).toBeNull();
    expect(s.gitPrCheckedAt ?? null).toBeNull();
  }, 15000);

  it("doubt-review #1: an unknown PR number (fields omitted after a fork) clears the status fields too — no stale open/passing", async () => {
    rig = await startServer();
    const send = await connect(rig, "pr-unknown");
    await send(FULL);
    await send({}); // new bridge, unknown tuple: every PR field omitted
    const s = rig.get("pr-unknown")!;
    expect(s.gitPrNumber ?? null).toBeNull();
    expect(s.gitPrState ?? null).toBeNull();
    expect(s.gitPrChecks ?? null).toBeNull();
    expect(s.gitPrCheckedAt ?? null).toBeNull();
  }, 15000);

  it("review r1: full tuple → number-only (older bridge) clears the stale status fields", async () => {
    rig = await startServer();
    const send = await connect(rig, "pr-downgrade");
    await send(FULL);
    await send({ gitPrNumber: 748, gitPrUrl: "https://github.com/o/r/pull/748" });
    const s = rig.get("pr-downgrade")!;
    expect(s.gitPrNumber).toBe(748);
    expect(s.gitPrState ?? null).toBeNull();
    expect(s.gitPrChecks ?? null).toBeNull();
    expect(s.gitPrCheckedAt ?? null).toBeNull();
  }, 15000);

  it("#X3a: an old bridge (number only) leaves the new fields absent", async () => {
    rig = await startServer();
    const send = await connect(rig, "pr-x3");
    await send({ gitPrNumber: 747, gitPrUrl: FULL.gitPrUrl });
    const s = rig.get("pr-x3")!;
    expect(s.gitPrNumber).toBe(747);
    expect(s.gitPrState).toBeUndefined();
    expect(s.gitPrDraft).toBeUndefined();
    expect(s.gitPrChecks).toBeUndefined();
    expect(s.gitPrCheckedAt).toBeUndefined();
  }, 15000);
});
