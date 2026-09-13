import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_SESSIONS_COUNT, STUB_SESSION_ID, seedSessionsWindow } from "../seed-sessions-window.mjs";

describe("seed-sessions-window", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "seed-win-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("seeds >120 ended sessions plus the stub dir", () => {
    seedSessionsWindow(tmp);

    // 125 seed dirs + 1 stub dir = 126 dirs.
    expect(readdirSync(tmp).length).toBe(SEED_SESSIONS_COUNT + 1);
    expect(SEED_SESSIONS_COUNT).toBeGreaterThan(120);

    const stubDir = join(tmp, "--fixtures-stub-dir--");
    expect(existsSync(stubDir)).toBe(true);
    const stubFiles = readdirSync(stubDir);
    expect(stubFiles.some((f) => f.includes(STUB_SESSION_ID) && f.endsWith(".jsonl"))).toBe(true);
    expect(stubFiles.some((f) => f.includes(STUB_SESSION_ID) && f.endsWith(".meta.json"))).toBe(true);

    // Idempotency: re-running does not throw or duplicate trees.
    seedSessionsWindow(tmp);
    expect(readdirSync(tmp).length).toBe(SEED_SESSIONS_COUNT + 1);
  });
});
