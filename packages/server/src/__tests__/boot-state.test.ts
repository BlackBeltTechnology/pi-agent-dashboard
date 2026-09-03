/**
 * The boot record: atomic, write-once-per-boot, ring-bounded, never fatal.
 * See change: fix-recovery-exit-intent (tasks 2.5, 3.7).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BOOT_RING_SIZE, isRecoveryAllowed } from "@blackbelt-technology/pi-dashboard-shared/boot-state.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetBootStateForTests,
  readBootState,
  recordExitIntent,
  resolveExitIntent,
  stampBootStart,
} from "../persistence/boot-state.js";

const BOOT_STATE_PATH = path.join(os.homedir(), ".pi", "dashboard", "boot-state.json");

function readRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(BOOT_STATE_PATH, "utf-8"));
}

describe("boot record", () => {
  beforeEach(() => {
    mkdirSync(path.dirname(BOOT_STATE_PATH), { recursive: true });
    rmSync(BOOT_STATE_PATH, { force: true });
    _resetBootStateForTests();
  });
  afterEach(() => {
    rmSync(BOOT_STATE_PATH, { force: true });
    vi.restoreAllMocks();
  });

  it("startup stamps a fresh record and rolls the prior boot into the ring", () => {
    stampBootStart(100);
    recordExitIntent("idle");
    stampBootStart(200);

    const state = readRaw();
    expect(state.bootId).toBe(200);
    expect(state.exitIntent).toBeNull();
    expect(state.ring).toEqual([{ bootId: 100, exitIntent: "idle", at: expect.any(Number) }]);
  });

  it("writes atomically, leaving no temp file behind", () => {
    stampBootStart(1);
    expect(existsSync(BOOT_STATE_PATH)).toBe(true);
    expect(existsSync(`${BOOT_STATE_PATH}.tmp`)).toBe(false);
  });

  it("evicts the oldest boot once the ring is full", () => {
    for (let i = 1; i <= BOOT_RING_SIZE + 3; i++) {
      stampBootStart(i);
      recordExitIntent("idle");
    }
    const ring = readRaw().ring as { bootId: number }[];
    expect(ring).toHaveLength(BOOT_RING_SIZE);
    // Newest-first, and the earliest boots are gone.
    expect(ring[0].bootId).toBe(BOOT_RING_SIZE + 2);
    expect(ring.map((r) => r.bootId)).not.toContain(1);
  });

  // 3.7 — a signal arriving after a restart was announced must not rewrite the
  // reason the server is going away: `spawnRestart` SIGTERMs this process.
  it("is write-once per boot: the first writer wins", () => {
    stampBootStart(42);
    recordExitIntent("restart");
    recordExitIntent("signal");
    expect(readRaw().exitIntent).toBe("restart");
  });

  it("resolves an owning boot from the current record or the ring", () => {
    stampBootStart(10);
    recordExitIntent("restart");
    stampBootStart(20);
    recordExitIntent("idle");
    stampBootStart(30);

    expect(resolveExitIntent(10)).toBe("restart");
    expect(resolveExitIntent(20)).toBe("idle");
    expect(resolveExitIntent(30)).toBeNull(); // current boot, still running
    expect(resolveExitIntent(999)).toBeNull(); // older than the ring
    expect(resolveExitIntent(undefined)).toBeNull(); // pre-feature sidecar
  });

  it("treats an absent or corrupt record as no record at all", () => {
    expect(readBootState()).toBeUndefined();
    writeFileSync(BOOT_STATE_PATH, "{ not json");
    expect(readBootState()).toBeUndefined();
    writeFileSync(BOOT_STATE_PATH, JSON.stringify({ nonsense: true }));
    expect(readBootState()).toBeUndefined();
    _resetBootStateForTests();
    expect(resolveExitIntent(123)).toBeNull();
  });

  it("survives a write failure without throwing (recovery over-offers instead)", () => {
    stampBootStart(7);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Deterministic write failure: occupy the record path with a directory,
    // so the tmp+rename lands on EISDIR/ENOTEMPTY.
    rmSync(BOOT_STATE_PATH, { force: true });
    mkdirSync(BOOT_STATE_PATH, { recursive: true });
    expect(() => recordExitIntent("idle")).not.toThrow();
    expect(spy).toHaveBeenCalled();
    rmSync(BOOT_STATE_PATH, { recursive: true, force: true });
  });

  it("maps intents to recovery per the reattach rule", () => {
    // Suppressed: the sessions survive AND the same exit told bridges to stay
    // away longer than any grace window, so they reattach too late to retract.
    expect(isRecoveryAllowed("restart")).toBe(false);
    expect(isRecoveryAllowed("shutdown")).toBe(false);
    // Ephemeral (fix-autostart-discovery-precedence 5.5): a self-exiting
    // ephemeral server is a DELIBERATE exit, not a crash to recover from.
    expect(isRecoveryAllowed("ephemeral")).toBe(false);
    // Allowed: liveness decides. `idle` kills every spawned pi outright.
    expect(isRecoveryAllowed("idle")).toBe(true);
    expect(isRecoveryAllowed("signal")).toBe(true);
    expect(isRecoveryAllowed("user-quit")).toBe(true);
    expect(isRecoveryAllowed(null)).toBe(true);
    expect(isRecoveryAllowed(undefined)).toBe(true);
  });

  it("records the ephemeral exit intent (fix-autostart-discovery-precedence 5.5)", () => {
    stampBootStart(1);
    recordExitIntent("ephemeral");
    const raw = readRaw();
    expect(raw.exitIntent).toBe("ephemeral");
    expect(isRecoveryAllowed(resolveExitIntent(raw.bootId as number))).toBe(false);
  });
});
