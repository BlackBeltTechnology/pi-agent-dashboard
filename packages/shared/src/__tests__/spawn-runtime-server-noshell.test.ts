/**
 * Server-mode resolution never spawns a shell (test-plan #E11, change
 * raise-node-floor-to-26 design D5). Uses the DEFAULT version probe against
 * real fake-node executables and records every child_process call.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ fn: string; file: string; args: unknown; shell: unknown }>);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrap =
    (fn: string) =>
    (file: string, ...rest: unknown[]) => {
      const args = Array.isArray(rest[0]) ? rest[0] : undefined;
      const opts = (rest.find((r) => r && typeof r === "object" && !Array.isArray(r)) ?? {}) as { shell?: unknown };
      calls.push({ fn, file, args, shell: opts.shell });
      return (actual as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](file, ...rest);
    };
  const wrapped = {
    ...actual,
    spawn: wrap("spawn"),
    spawnSync: wrap("spawnSync"),
    exec: wrap("exec"),
    execSync: wrap("execSync"),
    execFile: wrap("execFile"),
    execFileSync: wrap("execFileSync"),
  };
  return { ...wrapped, default: wrapped };
});

const { resolveServerRuntime } = await import("../platform/spawn-runtime.js");

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "srv-noshell-"));
  calls.length = 0;
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function fakeNode(rel: string, version: string): string {
  const p = path.join(tmp, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `#!/bin/sh\necho ${version}\n`);
  chmodSync(p, 0o755);
  return p;
}

const SHELLS = /(^|[\\/])(sh|bash|zsh|dash|fish|cmd(\.exe)?|powershell(\.exe)?|pwsh(\.exe)?)$/i;

describe.skipIf(process.platform === "win32")("resolveServerRuntime spawns no shell (#E11)", () => {
  it("probes every failing candidate with `<node> --version`, never via a shell", async () => {
    const home = path.join(tmp, "home");
    mkdirSync(path.join(home, ".nvm", "alias"), { recursive: true });
    writeFileSync(path.join(home, ".nvm", "alias", "default"), "24.15.0");
    const nvm = fakeNode("home/.nvm/versions/node/v24.15.0/bin/node", "v24.15.0");
    const volta = fakeNode("home/.volta/bin/node", "v25.9.0");
    const override = fakeNode("override/node", "v22.19.0");
    const onPath = fakeNode("path/node", "v24.15.0");
    const managed = fakeNode("managed/node/bin/node", "v24.0.0");

    const r = await resolveServerRuntime({
      overrideBinary: override,
      homedir: home,
      managedDir: path.join(tmp, "managed"),
      pathWhich: () => onPath,
      ownRuntime: { binary: process.execPath, version: "v24.18.1" },
    });

    expect(r.resolved).toBe(false);
    const probed = calls.map((c) => c.file);
    expect(new Set(probed)).toEqual(new Set([override, onPath, nvm, volta, managed]));
    expect(probed.length).toBe(5);
    expect(probed).not.toContain(process.execPath);
    for (const c of calls) {
      expect(c.fn).toBe("execFile");
      expect(c.args).toEqual(["--version"]);
      expect(c.shell).toBeFalsy();
      expect(c.file).not.toMatch(SHELLS);
    }
  });
});
