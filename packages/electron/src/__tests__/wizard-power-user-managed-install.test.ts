/**
 * Pin Defect 1's "power-user mode still runs installStandalone()" rule.
 * The wizard's auto-skip optimisation removes the user-facing UI; it must
 * NOT skip the managed dependency install. See change:
 * fix-electron-windows-installer-and-server-bootstrap (D3 / Defect 1).
 */
import { describe, it, expect, vi } from "vitest";
import {
  decideStartupAction,
  isManagedDirPopulated,
  REQUIRED_MANAGED_PACKAGES,
  runPowerUserManagedInstall,
} from "../lib/power-user-install.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("decideStartupAction (pure)", () => {
  it("returns skip-everything when not first run", () => {
    expect(
      decideStartupAction({ firstRun: false, piFound: true, bridgeFound: true }),
    ).toEqual({ kind: "skip-everything", reason: "not-first-run" });
    expect(
      decideStartupAction({ firstRun: false, piFound: false, bridgeFound: false }),
    ).toEqual({ kind: "skip-everything", reason: "not-first-run" });
  });

  it("returns auto-skip-wizard-with-install when pi + bridge are both present on first run", () => {
    expect(
      decideStartupAction({ firstRun: true, piFound: true, bridgeFound: true }),
    ).toEqual({ kind: "auto-skip-wizard-with-install", reason: "power-user" });
  });

  it("returns wizard:bridge-install when pi is found but bridge is missing", () => {
    expect(
      decideStartupAction({ firstRun: true, piFound: true, bridgeFound: false }),
    ).toEqual({ kind: "wizard", step: "bridge-install" });
  });

  it("returns wizard:full when pi is missing", () => {
    expect(
      decideStartupAction({ firstRun: true, piFound: false, bridgeFound: false }),
    ).toEqual({ kind: "wizard", step: "full" });
    expect(
      decideStartupAction({ firstRun: true, piFound: false, bridgeFound: true }),
    ).toEqual({ kind: "wizard", step: "full" });
  });
});

describe("isManagedDirPopulated", () => {
  it("returns false when the dir does not exist", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      expect(isManagedDirPopulated(path.join(tmp, "absent"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns false when the dir exists but is missing one of the required packages", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      // Only put two of the three required packages in place.
      const partial = REQUIRED_MANAGED_PACKAGES.slice(0, 2);
      for (const pkg of partial) {
        const dir = path.join(tmp, "node_modules", ...pkg.split("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({ name: pkg, version: "1.0.0" }),
        );
      }
      expect(isManagedDirPopulated(tmp)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns true when every required package's package.json is present and parses", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      for (const pkg of REQUIRED_MANAGED_PACKAGES) {
        const dir = path.join(tmp, "node_modules", ...pkg.split("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({ name: pkg, version: "1.0.0" }),
        );
      }
      expect(isManagedDirPopulated(tmp)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns false when a present package.json has corrupt JSON", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      for (const pkg of REQUIRED_MANAGED_PACKAGES) {
        const dir = path.join(tmp, "node_modules", ...pkg.split("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "package.json"), "{ not valid json");
      }
      expect(isManagedDirPopulated(tmp)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("runPowerUserManagedInstall", () => {
  it("short-circuits when managed dir is already populated (idempotency)", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      // Populate.
      for (const pkg of REQUIRED_MANAGED_PACKAGES) {
        const dir = path.join(tmp, "node_modules", ...pkg.split("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({ name: pkg, version: "1.0.0" }),
        );
      }
      const installSpy = vi.fn().mockResolvedValue(undefined);
      const result = await runPowerUserManagedInstall({
        installStandaloneFn: installSpy,
        managedDir: tmp,
      });
      expect(result).toEqual({ ran: false, reason: "already-populated" });
      expect(installSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("invokes installStandaloneFn when the managed dir is empty", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      const installSpy = vi.fn().mockResolvedValue(undefined);
      const statusSpy = vi.fn();
      const result = await runPowerUserManagedInstall({
        installStandaloneFn: installSpy,
        onStatus: statusSpy,
        managedDir: tmp,
      });
      expect(result).toEqual({ ran: true, reason: "installed" });
      expect(installSpy).toHaveBeenCalledOnce();
      // Status callback fired at least once with the setup label.
      expect(statusSpy).toHaveBeenCalled();
      expect(statusSpy.mock.calls[0]![0]).toMatch(/Setting up dependencies/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns failed (non-throwing) when installStandaloneFn throws", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      const boom = new Error("npm install failed: network down");
      const installSpy = vi.fn().mockRejectedValue(boom);
      const result = await runPowerUserManagedInstall({
        installStandaloneFn: installSpy,
        managedDir: tmp,
      });
      expect(result.ran).toBe(true);
      expect(result.reason).toBe("failed");
      expect(result.error).toBe(boom);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("forwards installer progress messages through the status callback", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pmgd-"));
    try {
      const statusSpy = vi.fn();
      // installStandaloneFn calls onProgress with sample lines.
      const installSpy = vi.fn(async (onProgress?: any) => {
        onProgress?.({ step: "install", status: "running", output: "added 152 packages" });
      });
      await runPowerUserManagedInstall({
        installStandaloneFn: installSpy,
        onStatus: statusSpy,
        managedDir: tmp,
      });
      const messages = statusSpy.mock.calls.map((c) => c[0] as string);
      expect(messages.some((m) => m.includes("added 152 packages"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
