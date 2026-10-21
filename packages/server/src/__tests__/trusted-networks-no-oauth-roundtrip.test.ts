/**
 * End-to-end regression test for fix-trusted-networks-no-oauth.
 *
 * Round-trips a bypassHosts-only auth config through the full
 * write → disk → loadConfig → resolvedTrustedNetworks path.
 *
 * This is the test that would have caught the bug activated by
 * eb24780 (consolidate-trusted-networks). The archived tasks.md
 * section 5.4 claimed this case was "covered by unit test" — but
 * the cited unit test only checked the React onChange handler's
 * return value in memory, never writing to disk or reloading.
 *
 * This test asserts the end state: after the UI's PUT /api/config
 * equivalent fires, a subsequent loadConfig() sees the entry in
 * resolvedTrustedNetworks.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigPartial } from "../config-api.js";

describe("fix-trusted-networks-no-oauth: round-trip", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-no-oauth-rt-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("UI add → save → reload → resolvedTrustedNetworks contains entry", () => {
    // Simulate fresh config (no auth section).
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));

    // Simulate the UI PUT /api/config from Settings → Security → Add
    // with no OAuth configured (the case that broke users).
    const writeResult = writeConfigPartial({
      auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
    });
    expect(writeResult.success).toBe(true);

    // Disk assertion — the bypassHosts must actually land on disk.
    const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(written.auth).toBeDefined();
    expect(written.auth.bypassHosts).toEqual(["192.168.1.0/24"]);

    // Reload assertion — loadConfig must surface the entry in
    // resolvedTrustedNetworks, which is what the network guard
    // and the WS upgrade handler consult.
    const loaded = loadConfig();
    expect(loaded.auth).toBeDefined();
    expect(loaded.auth!.bypassHosts).toEqual(["192.168.1.0/24"]);
    expect(loaded.resolvedTrustedNetworks).toContain("192.168.1.0/24");
  });

  it("UI add with existing OAuth → round-trip preserves both", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        port: 8000,
        auth: {
          secret: "s",
          providers: { github: { clientId: "abc", clientSecret: "xyz" } },
        },
      }),
    );

    const writeResult = writeConfigPartial({
      auth: { bypassHosts: ["10.0.0.0/8"] },
    });
    expect(writeResult.success).toBe(true);

    const loaded = loadConfig();
    expect(loaded.auth).toBeDefined();
    expect(loaded.auth!.providers.github).toBeDefined();
    expect(loaded.auth!.bypassHosts).toEqual(["10.0.0.0/8"]);
    expect(loaded.resolvedTrustedNetworks).toContain("10.0.0.0/8");
  });

  it("UI clear → save → reload → entry gone from resolvedTrustedNetworks", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
      }),
    );

    const writeResult = writeConfigPartial({
      auth: { bypassHosts: [] },
    });
    expect(writeResult.success).toBe(true);

    const loaded = loadConfig();
    // Loader returns auth === undefined when nothing auth-relevant remains.
    // Either way, the trusted entry must not survive.
    expect(loaded.resolvedTrustedNetworks).not.toContain("192.168.1.0/24");
    expect(loaded.resolvedTrustedNetworks).toEqual([]);
  });

  it("hand-edited config (no UI write) with bypassHosts only → loads correctly", () => {
    // This path simulates a user who edited config.json by hand
    // rather than through the UI. The fix must make loadConfig
    // honor this shape.
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        auth: { providers: {}, bypassHosts: ["192.168.0.0/24"] },
      }),
    );

    const loaded = loadConfig();
    expect(loaded.auth).toBeDefined();
    expect(loaded.resolvedTrustedNetworks).toContain("192.168.0.0/24");
  });
});
