import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

/**
 * `piTrustMirror` loader defaults (test-plan #E21).
 * See change: mirror-dashboard-trust-to-pi.
 */
let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-trust-mirror-"));
  origHome = process.env.HOME!;
  process.env.HOME = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("piTrustMirror loader (#E21)", () => {
  it("absent group → defaults (enabled, no interactive, accessGrants off, rest on)", () => {
    write({});
    expect(loadConfig().piTrustMirror).toEqual({
      enabled: true,
      coverInteractive: false,
      sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false },
    });
  });

  it("partial { enabled:false } merges over defaults", () => {
    write({ piTrustMirror: { enabled: false } });
    const cfg = loadConfig().piTrustMirror;
    expect(cfg.enabled).toBe(false);
    expect(cfg.coverInteractive).toBe(false);
    expect(cfg.sources.pinned).toBe(true);
    expect(cfg.sources.accessGrants).toBe(false);
  });

  it("partial sources merge; non-boolean values fall back to defaults", () => {
    write({ piTrustMirror: { coverInteractive: "yes", sources: { pinned: false, accessGrants: true, workflow: 1 } } });
    const cfg = loadConfig().piTrustMirror;
    expect(cfg.coverInteractive).toBe(false);
    expect(cfg.sources).toMatchObject({ pinned: false, accessGrants: true, workflow: true, worktreeInit: true });
  });
});
