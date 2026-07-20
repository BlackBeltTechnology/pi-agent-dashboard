/**
 * L1 unit coverage for the openspec CLI shim (provision-openspec-cli-in-sessions).
 *
 *   T-E1  bare `openspec` resolves in-session on a CLI-less PATH
 *   T-E2  idempotent prepend (simulated `/reload`)
 *   T-E3  re-point on init (upgrade), temp+rename atomic write
 *   T-E4  non-destructive (prepend-only, existing entries preserved)
 *   T-X1  fail-soft + surface (resolve throws → log AND missingTool emit)
 *   T-X2  stripped PATH (no `node`) → shim resolves node via absolute execPath
 *
 * Env-object seams keep every case hermetic: provision mutates an INJECTED env
 * and writes under an INJECTED tmp baseDir, never `process.env` / real `~/.pi`.
 * The spawn cases (E1, X2) exec the real pinned bin offline and are POSIX-only
 * (Windows Git-Bash resolution is T-C1, a qa smoke).
 *
 * See change: provision-openspec-cli-in-sessions.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionOpenspecCli } from "../openspec-cli-shim.js";

const POSIX = process.platform !== "win32";
const tmpDirs: string[] = [];

function mkBase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opsx-shim-"));
  tmpDirs.push(dir);
  return dir;
}

function shimDirOf(base: string): string {
  return fs.realpathSync(path.join(base, "openspec-shim"));
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("provisionOpenspecCli", () => {
  it.runIf(POSIX)("T-E1: bare `openspec` resolves after provision on a CLI-less PATH", () => {
    const base = mkBase();
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const res = provisionOpenspecCli({ baseDir: base, env });
    expect(res.ok).toBe(true);

    const out = spawnSync("/bin/sh", ["-c", "command -v openspec >/dev/null && openspec --version"], {
      env,
      encoding: "utf8",
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("1.6.0");
  });

  it("T-E2: re-provision (simulated /reload) does not duplicate the PATH entry", () => {
    const base = mkBase();
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    provisionOpenspecCli({ baseDir: base, env });
    provisionOpenspecCli({ baseDir: base, env });

    const shimDir = shimDirOf(base);
    const occurrences = (env.PATH ?? "")
      .split(path.delimiter)
      .filter((e) => e.length > 0 && fs.realpathSync(e) === shimDir);
    expect(occurrences).toHaveLength(1);
  });

  it("T-E3: re-init re-points the shim to the new bin, written temp+rename", () => {
    const base = mkBase();
    const shimPath = path.join(base, "openspec-shim", "openspec");

    provisionOpenspecCli({ baseDir: base, env: { PATH: "" }, resolveBin: () => "/old/place/bin/openspec.js" });
    expect(fs.readFileSync(shimPath, "utf8")).toContain("/old/place/bin/openspec.js");

    provisionOpenspecCli({ baseDir: base, env: { PATH: "" }, resolveBin: () => "/new/place/bin/openspec.js" });
    const content = fs.readFileSync(shimPath, "utf8");
    expect(content).toContain("/new/place/bin/openspec.js");
    expect(content).not.toContain("/old/place/bin/openspec.js");

    // temp+rename leaves no partial `.tmp` artifact behind.
    const leftovers = fs.readdirSync(path.join(base, "openspec-shim")).filter((f) => f.includes(".tmp"));
    expect(leftovers).toHaveLength(0);
  });

  it("T-E4: prepend is non-destructive (existing entries + order preserved)", () => {
    const base = mkBase();
    const before = ["/opt/globalbin", "/usr/bin", "/bin"];
    const env: NodeJS.ProcessEnv = { PATH: before.join(path.delimiter) };

    provisionOpenspecCli({ baseDir: base, env, resolveBin: () => "/x/bin/openspec.js" });

    const entries = (env.PATH ?? "").split(path.delimiter);
    // every original entry still present, in the same relative order.
    for (const e of before) expect(entries).toContain(e);
    expect(entries.indexOf("/opt/globalbin")).toBeLessThan(entries.indexOf("/usr/bin"));
    expect(entries.indexOf("/usr/bin")).toBeLessThan(entries.indexOf("/bin"));
    // and the shim dir was prepended (index 0), not appended.
    expect(fs.realpathSync(entries[0])).toBe(shimDirOf(base));
  });

  it("T-X1: resolve failure fails soft — no throw, PATH unchanged, logs AND surfaces", () => {
    const base = mkBase();
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const logs: string[] = [];
    const misses: string[] = [];

    const res = provisionOpenspecCli({
      baseDir: base,
      env,
      resolveBin: () => {
        throw new Error("ERR_PACKAGE_PATH_NOT_EXPORTED (simulated)");
      },
      log: (m) => logs.push(m),
      onMissingTool: (r) => misses.push(r),
    });

    expect(res.ok).toBe(false);
    expect(env.PATH).toBe("/usr/bin"); // untouched
    expect(logs.length).toBeGreaterThan(0);
    expect(misses).toHaveLength(1);
  });

  it.runIf(POSIX)("T-X2: shim resolves `node` via absolute execPath under a stripped PATH", () => {
    const base = mkBase();
    // PATH empty → after provision it is ONLY the shim dir (no `node` on PATH).
    const env: NodeJS.ProcessEnv = { PATH: "" };

    const res = provisionOpenspecCli({ baseDir: base, env, execPath: process.execPath });
    expect(res.ok).toBe(true);
    expect((env.PATH ?? "").split(path.delimiter)).toHaveLength(1); // shim dir only

    // Absolute /bin/sh so we don't depend on PATH to find the shell; the child's
    // PATH has no `node`, so exit 0 proves the shim used process.execPath.
    const out = spawnSync("/bin/sh", ["-c", "openspec --version"], { env, encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("1.6.0");
  });
});
