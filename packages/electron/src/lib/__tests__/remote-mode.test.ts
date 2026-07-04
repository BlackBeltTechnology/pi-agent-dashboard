/**
 * Remote wizard mode (docker-packaging, task 7.4).
 *
 * Covers the contract: wizard saves remote mode to mode.json, ensureServer()
 * returns the configured URL without discovery/spawn, and didWeStartServer()
 * stays false so quit never stops the remote server.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the health check so non-remote ensureServer() short-circuits on the
// already-running branch (no real spawn). Remote mode must NOT reach it — the
// tests below assert it is never called in remote mode.
vi.mock("../health-check.js", () => ({
  isDashboardRunning: vi.fn(async () => ({ running: true, pid: 1 })),
}));

import { isDashboardRunning } from "../health-check.js";
import { didWeStartServer, ensureServer } from "../server-lifecycle.js";
import { readModeFile, writeModeFile } from "../wizard-state.js";

const mockHealth = isDashboardRunning as unknown as ReturnType<typeof vi.fn>;
const modeFile = path.join(os.homedir(), ".pi-dashboard", "dashboard-settings.json");
const legacyModeFile = path.join(os.homedir(), ".pi-dashboard", "mode.json");

describe("remote wizard mode", () => {
  beforeEach(() => {
    mockHealth.mockClear();
    fs.rmSync(modeFile, { force: true });
    fs.rmSync(legacyModeFile, { force: true });
  });
  afterEach(() => {
    fs.rmSync(modeFile, { force: true });
    fs.rmSync(legacyModeFile, { force: true });
  });

  it("writeModeFile persists remote mode + url to dashboard-settings.json", () => {
    writeModeFile("remote", "http://docker-host:8000");
    const raw = JSON.parse(fs.readFileSync(modeFile, "utf-8"));
    expect(raw.mode).toBe("remote");
    expect(raw.remoteUrl).toBe("http://docker-host:8000");
  });

  it("readModeFile round-trips remote mode", () => {
    writeModeFile("remote", "http://docker-host:8000");
    expect(readModeFile()).toMatchObject({ mode: "remote", remoteUrl: "http://docker-host:8000" });
  });

  it("readModeFile rejects remote mode without a url", () => {
    fs.mkdirSync(path.dirname(modeFile), { recursive: true });
    fs.writeFileSync(modeFile, JSON.stringify({ mode: "remote", completedAt: "x" }));
    expect(readModeFile()).toBeNull();
  });

  it("ensureServer returns the remote url without health probe or spawn", async () => {
    writeModeFile("remote", "http://docker-host:8000");
    await expect(ensureServer()).resolves.toBe("http://docker-host:8000");
    expect(mockHealth).not.toHaveBeenCalled();
  });

  it("didWeStartServer stays false in remote mode", async () => {
    writeModeFile("remote", "http://docker-host:8000");
    await ensureServer();
    expect(didWeStartServer()).toBe(false);
  });

  it("non-remote modes do not short-circuit — ensureServer runs local discovery", async () => {
    writeModeFile("standalone");
    // Standalone must NOT return a remote url; it falls through to the health
    // probe (mocked running) and resolves to the local server url.
    await expect(ensureServer()).resolves.toBe("http://localhost:8000");
    expect(mockHealth).toHaveBeenCalledTimes(1);
    expect(readModeFile()).toMatchObject({ mode: "standalone" });
    expect((readModeFile() as { remoteUrl?: string }).remoteUrl).toBeUndefined();
  });
});
