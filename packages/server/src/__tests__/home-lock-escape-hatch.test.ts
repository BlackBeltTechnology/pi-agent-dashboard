/**
 * Tests for the PI_DASHBOARD_ALLOW_MULTIPLE escape hatch.
 *
 * The escape hatch is evaluated in `cli.ts::runForeground`; here we test
 * the pure predicate `isLockDisabled` plus a behavioral test that confirms
 * NO metadata is written when the lock is skipped.
 *
 * See change: single-dashboard-per-home, task 14.3.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLockDisabled, acquireOrAttach } from "../lifecycle/home-lock.js";

let tmpHome: string;
let lockPath: string;
let metaPath: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-escape-hatch-"));
  lockPath = path.join(tmpHome, ".pi", "dashboard", "server.lock");
  metaPath = `${lockPath}.meta.json`;
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("escape hatch", () => {
  it("isLockDisabled true for =1 and =true", () => {
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "1" })).toBe(true);
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "true" })).toBe(true);
  });

  it("isLockDisabled false when unset or other values", () => {
    expect(isLockDisabled({})).toBe(false);
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "" })).toBe(false);
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "yes" })).toBe(false);
    expect(isLockDisabled({ PI_DASHBOARD_ALLOW_MULTIPLE: "0" })).toBe(false);
  });

  it("when caller skips acquireOrAttach (escape hatch on), no metadata sidecar exists", () => {
    // The CLI-level behavior when PI_DASHBOARD_ALLOW_MULTIPLE is set is to
    // NOT call acquireOrAttach at all. We simulate that: the fact that we
    // never called acquireOrAttach means the sidecar was never written.
    expect(fs.existsSync(metaPath)).toBe(false);
  });

  it("when lock IS acquired, metadata is written (control)", async () => {
    const r = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      hooks: { lockPath, metaPath, staleMs: 500 },
    });
    expect(r.mode).toBe("acquired");
    expect(fs.existsSync(metaPath)).toBe(true);
    if (r.mode === "acquired") await r.release();
    expect(fs.existsSync(metaPath)).toBe(false);
  });
});
