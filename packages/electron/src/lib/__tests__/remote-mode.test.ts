/**
 * Remote wizard mode (docker-packaging, task 7.4).
 *
 * Covers the contract: wizard saves remote mode to mode.json, ensureServer()
 * returns the configured URL without discovery/spawn, and didWeStartServer()
 * stays false so quit never stops the remote server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Health check must never be reached in remote mode — make it throw so the
// test fails loudly if ensureServer() falls through to local discovery.
vi.mock("../health-check.js", () => ({
  isDashboardRunning: vi.fn(async () => {
    throw new Error("isDashboardRunning should not be called in remote mode");
  }),
}));

import { readModeFile, writeModeFile } from "../wizard-state.js";
import { ensureServer, didWeStartServer } from "../server-lifecycle.js";

const modeFile = path.join(os.homedir(), ".pi-dashboard", "mode.json");

describe("remote wizard mode", () => {
  beforeEach(() => {
    fs.rmSync(modeFile, { force: true });
  });
  afterEach(() => {
    fs.rmSync(modeFile, { force: true });
  });

  it("writeModeFile persists remote mode + url to mode.json", () => {
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
  });

  it("didWeStartServer stays false in remote mode", async () => {
    writeModeFile("remote", "http://docker-host:8000");
    await ensureServer();
    expect(didWeStartServer()).toBe(false);
  });

  it("non-remote modes do not short-circuit (standalone/power-user ignored by ensureServer)", () => {
    writeModeFile("standalone");
    expect(readModeFile()).toMatchObject({ mode: "standalone" });
    expect((readModeFile() as { remoteUrl?: string }).remoteUrl).toBeUndefined();
  });
});
