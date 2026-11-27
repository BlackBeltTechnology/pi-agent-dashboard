/**
 * #E42 (subagent-live-cadence removal): a config file that still carries
 * `subagentTickThrottleMs` loads fine, and the next settings save drops it.
 * See change: move-subagents-to-plugin (10.2).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigPartial } from "../config-api.js";

const realHome = process.env.HOME;
let configFile: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "removed-throttle-"));
  process.env.HOME = home;
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  configFile = join(home, ".pi", "dashboard", "config.json");
});
afterEach(() => {
  process.env.HOME = realHome;
});

describe("removed subagentTickThrottleMs (#E42)", () => {
  it("loads a file carrying the key, then a settings save drops it", () => {
    writeFileSync(
      configFile,
      JSON.stringify({ port: 8123, subagentTickThrottleMs: 500, subagentTickThrottleMigrated: true }),
    );
    expect(loadConfig().port).toBe(8123);

    writeConfigPartial({ autoShutdown: false });

    const saved = JSON.parse(readFileSync(configFile, "utf-8"));
    expect(saved.port).toBe(8123);
    expect(saved.autoShutdown).toBe(false);
    expect(saved).not.toHaveProperty("subagentTickThrottleMs");
    expect(saved).not.toHaveProperty("subagentTickThrottleMigrated");
  });
});
