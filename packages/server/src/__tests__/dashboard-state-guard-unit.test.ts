/**
 * The dashboard-state guard's primitives: tiers on REAL paths, the request-scoped caller, and the
 * post-open handle check.
 * See change: close-container-loopback-impersonation (D8).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentStateCaller,
  DashboardStateRefused,
  dashboardStateRefuses,
  handleIsAlwaysRefused,
  isDashboardStatePath,
  openStateChecked,
  readFileStateChecked,
  runWithStateCaller,
} from "../lib/dashboard-state-guard.js";

let home: string;
let orig: string | undefined;
const dash = () => path.join(home, ".pi", "dashboard");

beforeEach(() => {
  orig = process.env.HOME;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-unit-")));
  process.env.HOME = home;
  fs.mkdirSync(path.join(dash(), "local"), { recursive: true });
  fs.writeFileSync(path.join(dash(), "local", "token"), "T");
  fs.writeFileSync(path.join(dash(), "identity.key"), "K");
  fs.writeFileSync(path.join(dash(), "config.json"), "{}");
  fs.writeFileSync(path.join(home, "notes.txt"), "n");
});
afterEach(() => {
  process.env.HOME = orig;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("isDashboardStatePath", () => {
  it("always: local/** and identity.key; gated: the rest of the dir (incl. the dir itself); null outside", async () => {
    expect(await isDashboardStatePath(path.join(dash(), "local", "token"))).toBe("always");
    expect(await isDashboardStatePath(path.join(dash(), "local", "sub", "deep", "x"))).toBe("always"); // not-yet-existing path
    expect(await isDashboardStatePath(path.join(dash(), "identity.key"))).toBe("always");
    expect(await isDashboardStatePath(path.join(dash(), "config.json"))).toBe("gated");
    expect(await isDashboardStatePath(path.join(dash(), "paired-devices.json"))).toBe("gated");
    expect(await isDashboardStatePath(dash())).toBe("gated");
    expect(await isDashboardStatePath(path.join(home, ".pi", "agent", "x.md"))).toBeNull();
    expect(await isDashboardStatePath(path.join(home, "notes.txt"))).toBeNull();
    // A sibling whose name merely STARTS with the dir name is outside it.
    expect(await isDashboardStatePath(path.join(home, ".pi", "dashboard-other", "local", "token"))).toBeNull();
  });

  it("sees through a symlink into the dir and a `..` spelling", async () => {
    fs.symlinkSync(path.join(dash(), "local"), path.join(home, "alias"));
    expect(await isDashboardStatePath(path.join(home, "alias", "token"))).toBe("always");
    expect(await isDashboardStatePath(path.join(home, "x", "..", ".pi", "dashboard", "local", "token"))).toBe("always");
  });
});

describe("dashboardStateRefuses + the request-scoped caller", () => {
  it("the always tier refuses with NO caller in scope; the gated tier is admitted with none (internal code) and follows the caller when present", async () => {
    expect(currentStateCaller()).toBeUndefined();
    expect(await dashboardStateRefuses(path.join(dash(), "local", "token"))).toBe(true);
    expect(await dashboardStateRefuses(path.join(dash(), "config.json"))).toBe(false);
    expect(await dashboardStateRefuses(path.join(home, "notes.txt"))).toBe(false);

    const denied = { gatedAdmitted: () => false, unproven: () => true };
    const admitted = { gatedAdmitted: () => true, unproven: () => false };
    await runWithStateCaller(denied, async () => {
      expect(currentStateCaller()).toBe(denied);
      expect(await dashboardStateRefuses(path.join(dash(), "config.json"))).toBe(true);
      expect(await dashboardStateRefuses(path.join(dash(), "local", "token"))).toBe(true);
    });
    await runWithStateCaller(admitted, async () => {
      expect(await dashboardStateRefuses(path.join(dash(), "config.json"))).toBe(false);
      expect(await dashboardStateRefuses(path.join(dash(), "local", "token"))).toBe(true); // never admitted
    });
    expect(currentStateCaller()).toBeUndefined();
  });

  it("the caller survives awaits inside the scope and does not leak to a concurrent one", async () => {
    const a = { gatedAdmitted: () => true, unproven: () => false };
    const b = { gatedAdmitted: () => false, unproven: () => true };
    const seen: string[] = [];
    await Promise.all([
      runWithStateCaller(a, async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(currentStateCaller() === a ? "a-ok" : "a-wrong");
      }),
      runWithStateCaller(b, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentStateCaller() === b ? "b-ok" : "b-wrong");
      }),
    ]);
    expect(seen.sort()).toEqual(["a-ok", "b-ok"]);
  });
});

describe("handleIsAlwaysRefused / openStateChecked", () => {
  it("a handle on the token (opened through a symlink, or a hard link) is refused; an ordinary file is not", async () => {
    fs.symlinkSync(path.join(dash(), "local"), path.join(home, "alias"));
    fs.linkSync(path.join(dash(), "identity.key"), path.join(home, "hardlink"));
    for (const p of [path.join(home, "alias", "token"), path.join(home, "hardlink")]) {
      const fh = await fsp.open(p, "r");
      try {
        expect(await handleIsAlwaysRefused(fh), p).toBe(true);
      } finally {
        await fh.close();
      }
    }
    const ok = await fsp.open(path.join(home, "notes.txt"), "r");
    try {
      expect(await handleIsAlwaysRefused(ok)).toBe(false);
    } finally {
      await ok.close();
    }
    await expect(openStateChecked(path.join(home, "alias", "token"))).rejects.toBeInstanceOf(DashboardStateRefused);
    await expect(readFileStateChecked(path.join(home, "alias", "token"), "utf-8")).rejects.toBeInstanceOf(DashboardStateRefused);
    expect(await readFileStateChecked(path.join(home, "notes.txt"), "utf-8")).toBe("n");
    expect((await readFileStateChecked(path.join(home, "notes.txt"))).toString()).toBe("n");
  });

  it("config.json (gated tier) is NOT refused at the handle: only the always tier has the post-open check", async () => {
    const fh = await fsp.open(path.join(dash(), "config.json"), "r");
    try {
      expect(await handleIsAlwaysRefused(fh)).toBe(false);
    } finally {
      await fh.close();
    }
  });
});
