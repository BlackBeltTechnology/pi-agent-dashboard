/**
 * One-shot boot migration of `subagentTickThrottleMs` 0 → 500.
 *
 * `ensureConfig()` materializes the default into every install's
 * `config.json`, so flipping `DEFAULT_CONFIG` alone reaches nobody. The
 * migration therefore rewrites a stored `0` ONCE, marked by
 * `subagentTickThrottleMigrated`; a `0` written after the marker exists is a
 * deliberate opt-out and is kept. It runs on the server boot path only — never
 * from `loadConfig()`, which every bridge process calls.
 *
 * Folded 1:1 from the change's test-plan manifest: E8, E9, E10, X8.
 * See change: heal-orphaned-tool-cards-on-session-end (design D5).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfig, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateSubagentTickThrottle } from "../config-api.js";

const realHome = process.env.HOME;
let home: string;
let configFile: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "throttle-migration-"));
  process.env.HOME = home;
  configFile = join(home, ".pi", "dashboard", "config.json");
});
afterEach(() => {
  process.env.HOME = realHome;
});

function writeConfig(content: Record<string, unknown>): void {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  writeFileSync(configFile, JSON.stringify(content, null, 2) + "\n");
}
const readConfig = () => JSON.parse(readFileSync(configFile, "utf-8"));

describe("subagentTickThrottleMs boot migration (#E8)", () => {
  it("rewrites an unmarked 0 to 500 and sets the marker", () => {
    writeConfig({ port: 8000, subagentTickThrottleMs: 0 });
    migrateSubagentTickThrottle();
    expect(readConfig().subagentTickThrottleMs).toBe(500);
    expect(readConfig().subagentTickThrottleMigrated).toBe(true);
    expect(loadConfig().subagentTickThrottleMs).toBe(500);
  });

  it("keeps a MARKED 0 and does not touch the file", () => {
    writeConfig({ port: 8000, subagentTickThrottleMs: 0, subagentTickThrottleMigrated: true });
    const before = readFileSync(configFile, "utf-8");
    const mtimeBefore = statSync(configFile).mtimeMs;
    migrateSubagentTickThrottle();
    expect(readFileSync(configFile, "utf-8")).toBe(before);
    expect(statSync(configFile).mtimeMs).toBe(mtimeBefore);
    expect(loadConfig().subagentTickThrottleMs).toBe(0);
  });

  it("never touches a deliberate non-zero value", () => {
    writeConfig({ port: 8000, subagentTickThrottleMs: 250 });
    migrateSubagentTickThrottle();
    expect(readConfig().subagentTickThrottleMs).toBe(250);
    expect(loadConfig().subagentTickThrottleMs).toBe(250);
  });

  it("stamps the marker on a markerless config so a LATER deliberate 0 survives", () => {
    // A config that never carried the key at all (hand-pruned, or seeded by
    // something other than `ensureConfig`).
    writeConfig({ port: 8000 });
    migrateSubagentTickThrottle();
    expect(readConfig().subagentTickThrottleMigrated).toBe(true);

    // The user turns the throttle off afterwards; the next boot must keep it.
    writeConfig({ ...readConfig(), subagentTickThrottleMs: 0 });
    migrateSubagentTickThrottle();
    expect(loadConfig().subagentTickThrottleMs).toBe(0);
  });

  it("resolves 500 from the default when the key is absent", () => {
    writeConfig({ port: 8000 });
    migrateSubagentTickThrottle();
    expect(loadConfig().subagentTickThrottleMs).toBe(500);
  });
});

describe("migration preserves unrelated keys (#E9)", () => {
  it("keeps every key outside the ensureConfig seed set", () => {
    writeConfig({
      port: 8000,
      subagentTickThrottleMs: 0,
      auth: { enabled: true, allowedUsers: ["a@b.c"] },
      customUnknownKey: { nested: [1, 2, 3] },
      theme: "earth",
    });
    migrateSubagentTickThrottle();
    const after = readConfig();
    expect(after.subagentTickThrottleMs).toBe(500);
    expect(after.customUnknownKey).toEqual({ nested: [1, 2, 3] });
    expect(after.theme).toBe("earth");
    expect(after.auth.allowedUsers).toEqual(["a@b.c"]);
  });
});

describe("fresh install (#E10)", () => {
  it("seeds the marker at creation, so a later deliberate 0 survives the next boot", () => {
    expect(existsSync(configFile)).toBe(false);
    ensureConfig();
    expect(readConfig().subagentTickThrottleMigrated).toBe(true);

    // The user turns the throttle off after the fact.
    writeConfig({ ...readConfig(), subagentTickThrottleMs: 0 });
    migrateSubagentTickThrottle();
    expect(loadConfig().subagentTickThrottleMs).toBe(0);
  });
});

describe("read paths never migrate (#X8)", () => {
  it("loadConfig() leaves the file bytes and mtime untouched", async () => {
    writeConfig({ port: 8000, subagentTickThrottleMs: 0 });
    const before = readFileSync(configFile, "utf-8");
    const mtimeBefore = statSync(configFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));

    expect(loadConfig().subagentTickThrottleMs).toBe(0);

    expect(readFileSync(configFile, "utf-8")).toBe(before);
    expect(statSync(configFile).mtimeMs).toBe(mtimeBefore);
  });
});
