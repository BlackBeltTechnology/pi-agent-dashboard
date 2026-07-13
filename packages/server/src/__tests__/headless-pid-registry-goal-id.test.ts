/**
 * Unit tests for goal-driver correlation on the headless-pid registry.
 *
 * A goal-driver spawn (route or supervisor respawn) stamps `goalId` onto the
 * registry entry keyed to its spawn token; `session_register` resolves it via
 * `getGoalId(sessionId)` after `linkByToken` links the session. This is the
 * PRIMARY goal-link path that replaces the racy cwd-FIFO — an unrelated
 * same-cwd session carries no goalId and is never mis-linked. The goalId also
 * round-trips across a server restart (persisted entry).
 *
 * See change: add-goal-session-supervisor (Correlation / C2c).
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const killProcessMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, forced: false })));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", () => ({
  killProcess: killProcessMock,
  killPidWithGroup: vi.fn(),
  isProcessAlive: vi.fn(() => true),
}));

// eslint-disable-next-line import/first
import { createHeadlessPidRegistry } from "../headless-pid-registry.js";

function mockProcess(): ChildProcess {
  return new EventEmitter() as any;
}
function tempPidFile(): string {
  return join(mkdtempSync(join(tmpdir(), "pid-reg-goal-")), "pids.json");
}

describe("headlessPidRegistry goal-driver correlation", () => {
  it("resolves goalId for the session linked by token", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tempPidFile() });
    reg.register(1001, "/repo", mockProcess(), "goal-tok", undefined, "goal-A");
    expect(reg.linkByToken("goal-tok", "sess-1", undefined)).toBe(true);
    expect(reg.getGoalId("sess-1")).toBe("goal-A");
  });

  it("does NOT link a same-cwd non-goal session to the goal", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tempPidFile() });
    // Goal driver in /repo, waiting to register.
    reg.register(1001, "/repo", mockProcess(), "goal-tok", undefined, "goal-A");
    // An unrelated session registers first in the same cwd via its own token.
    reg.register(2002, "/repo", mockProcess(), "other-tok");
    expect(reg.linkByToken("other-tok", "other-sess", undefined)).toBe(true);
    // The unrelated session carries no goalId — never mis-linked to goal-A.
    expect(reg.getGoalId("other-sess")).toBeUndefined();
  });

  it("returns undefined for an unknown session", () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: tempPidFile() });
    expect(reg.getGoalId("nope")).toBeUndefined();
  });

  it("round-trips goalId across a restart (persist → reclaim)", async () => {
    const pidFile = tempPidFile();
    const reg1 = createHeadlessPidRegistry({ pidFilePath: pidFile });
    reg1.register(process.pid, "/repo", mockProcess(), "goal-tok", undefined, "goal-A");
    // New instance reads the persisted file; process.pid is alive → reclaimed.
    const reg2 = createHeadlessPidRegistry({ pidFilePath: pidFile });
    await reg2.cleanupOrphans();
    expect(reg2.linkByToken("goal-tok", "sess-after-restart", undefined)).toBe(true);
    expect(reg2.getGoalId("sess-after-restart")).toBe("goal-A");
  });
});
