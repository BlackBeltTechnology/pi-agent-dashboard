/**
 * Repo-level invariant: no file outside `packages/shared/src/platform/` may spawn
 * `powershell.exe` or `wsl.exe` to PROBE or SIGNAL a process. Windows / WSL
 * identity checks and kills go through `probeProcessStart`, `verifyAndKillWindows`,
 * `wslLiveness` and `verifyAndKillWsl` so the absolute-path, validated-input,
 * 2-slot-limited, one-invocation rules apply uniformly.
 *
 * A file is flagged when its CODE (comments stripped) names `powershell.exe` or
 * `wsl.exe` together with a process probe/signal token: `Get-Process`,
 * `StartTime`, `taskkill`, `Stop-Process`, or `kill`.
 *
 * Fix a failure by routing through the platform helpers, never by extending the
 * allowlist. See change: add-windows-process-identity (W9).
 */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

/** Exact-path allowlist (repo-relative). Each entry must still exist. */
const ALLOWLIST: readonly string[] = [
  "packages/extension/src/process-scanner.ts", // process enumeration (CIM), not identity/kill
  "packages/browser-plugin/src/server/dedicated/process-identity.ts", // browser-plugin's own identity probe
  "packages/server/src/spawn-process/process-manager.ts", // the tmux spawn via `wsl.exe --exec`
];

const SHELL_EXE_RE = /\b(?:powershell|wsl)\.exe\b/i;
const PROBE_OR_SIGNAL_RE = /Get-Process|StartTime|taskkill|Stop-Process|\bkill\b/;

/** Drop `//` line comments and block comments so prose mentions never count. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** True when `src` (comments stripped) spawns a shell exe next to a probe/signal token. */
function isDirectProcessControl(src: string): boolean {
  const code = stripComments(src);
  return SHELL_EXE_RE.test(code) && PROBE_OR_SIGNAL_RE.test(code);
}

/** Repo-relative paths whose code spawns a shell exe next to a probe/signal token, minus the exact-path allowlist. */
function findViolations(files: Record<string, string>, allowlist: readonly string[]): string[] {
  return Object.entries(files)
    .filter(([file, src]) => !allowlist.includes(file) && isDirectProcessControl(src))
    .map(([file]) => file);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

describe("no direct powershell.exe / wsl.exe process control outside platform/", () => {
  it("rule detector: flags a probe, ignores comments and unrelated tokens", () => {
    expect(isDirectProcessControl(`run("powershell.exe", ["-Command", "Get-Process -Id 1"])`)).toBe(true);
    expect(isDirectProcessControl(`run("wsl.exe", ["-d", d, "--exec", "kill", "-TERM", "1"])`)).toBe(true);
    expect(isDirectProcessControl(`exec("powershell.exe Stop-Process -Id 1")`)).toBe(true);
    expect(isDirectProcessControl(`// powershell.exe Get-Process\nconst x = 1;`)).toBe(false);
    expect(isDirectProcessControl(`/* wsl.exe taskkill */ const x = 1;`)).toBe(false);
    expect(isDirectProcessControl(`spawn("wsl.exe", ["--exec", "tmux", "new-session"])`)).toBe(false);
    expect(isDirectProcessControl(`binaryDef("taskkill", deps)`)).toBe(false);
  });

  it("E44: fixtures outside platform/ for every probe/signal token are flagged", () => {
    const files = {
      "a.ts": `spawn("powershell.exe",["-Command","Get-Process -Id 1"])`,
      "b.ts": `execFile("wsl.exe",["--exec","kill","-9","1"])`,
      "c.ts": "exec(`wsl.exe -d x kill 1`)",
      "d.ts": `"C:\\Windows\\System32\\wsl.exe"; run("taskkill")`,
      "e.ts": `run("powershell.exe", "(Get-Process x).StartTime")`,
      "f.ts": `run("powershell.exe", "Stop-Process -Id 1")`,
    };
    expect(findViolations(files, [])).toEqual(Object.keys(files));
  });

  it("E45b: the allowlist is exact by path — exempt there, not for a renamed copy; a stale entry is detectable", () => {
    const code = `execFile("wsl.exe", ["--exec", "kill", "1"])`;
    expect(findViolations({ "packages/server/src/spawn-process/process-manager.ts": code }, ALLOWLIST)).toEqual([]);
    expect(findViolations({ "packages/server/src/spawn-process/process-manager-copy.ts": code }, ALLOWLIST)).toHaveLength(1);
    const existing = new Set(ALLOWLIST);
    expect([...ALLOWLIST, "packages/nope/src/gone.ts"].filter((e) => !existing.has(e))).toEqual(["packages/nope/src/gone.ts"]);
  });

  it("every allowlist entry exists (a stale entry fails)", async () => {
    for (const rel of ALLOWLIST) {
      await expect(fs.access(path.join(repoRoot, rel)), `${rel} no longer exists: drop it from the allowlist`).resolves.toBeUndefined();
    }
  });

  it("no non-allowlisted file spawns powershell.exe / wsl.exe to probe or signal a process", async () => {
    const platformDir = path.resolve(repoRoot, "packages/shared/src/platform").replace(/\\/g, "/") + "/";
    const allow = new Set(ALLOWLIST.map((p) => path.resolve(repoRoot, p).replace(/\\/g, "/")));
    const violations: string[] = [];
    const packagesDir = path.resolve(repoRoot, "packages");
    for (const pkg of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = path.join(packagesDir, pkg.name, "src");
      try {
        await fs.access(srcDir);
      } catch {
        continue;
      }
      for await (const file of walk(srcDir)) {
        const normalized = file.replace(/\\/g, "/");
        if (normalized.startsWith(platformDir) || allow.has(normalized)) continue;
        if (isDirectProcessControl(await fs.readFile(file, "utf-8"))) {
          violations.push(path.relative(repoRoot, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(
      violations,
      `Use probeProcessStart / verifyAndKillWindows / wslLiveness / verifyAndKillWsl from the platform module:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
