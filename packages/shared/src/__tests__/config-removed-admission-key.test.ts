/**
 * A leftover `maxConcurrentSubagents` key (and the old `subagentSaturation`
 * block) in `config.json` is ignored: it loads without error and is absent from
 * the result. The producer's `maxConcurrent` is the only subagent limit now.
 *
 * Covers test-plan #E18. This file is the ONE allowlisted hit of the removed-key
 * completeness gate (task 5.8 / #E21).
 * See change: subagent-queue-visibility (D6).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

let tmpHome: string;
let realHome: string | undefined;
let realUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "removed-admission-key-"));
  realHome = process.env.HOME;
  realUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  if (process.platform === "win32") process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("removed admission keys (#E18)", () => {
  it("a leftover maxConcurrentSubagents: 12 loads without error and is not on the result", () => {
    const file = path.join(tmpHome, ".pi", "dashboard", "config.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ port: 8123, maxConcurrentSubagents: 12, subagentSaturation: { loadAvg1m: 4 } }),
    );
    const cfg = loadConfig() as unknown as Record<string, unknown>;
    expect(cfg.port).toBe(8123); // the file WAS read (not the defaults fallback)
    expect("maxConcurrentSubagents" in cfg).toBe(false);
    expect("subagentSaturation" in cfg).toBe(false);
  });
});
