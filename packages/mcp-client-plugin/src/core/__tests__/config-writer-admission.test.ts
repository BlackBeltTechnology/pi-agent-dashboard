/**
 * Project-scope admission at the WRITER entry points (task 2.4): the guard is
 * the shared `isAllowedCwd` module, and a worktree of a known main checkout is
 * admitted while a traversal alias is not.
 * See change: extract-mcp-client-plugin.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createConfigWriter } from "../config-writer.js";
import type { AdapterPort, ConfigIO } from "../types.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const p of cleanup) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function makeIO(): ConfigIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readFile: (p) => (files.has(p) ? (files.get(p) as string) : null),
    writeFileAtomic: (p, content) => void files.set(p, content),
  };
}

function makePort(): AdapterPort {
  return {
    loadMcpConfig: () => Promise.resolve({ mcpServers: {} }),
    getServerProvenance: () => Promise.resolve(new Map()),
    getConfigDiscoveryPaths: () => [],
    getPiGlobalConfigPath: () => "/agent/mcp.json",
    getProjectPiConfigPath: (cwd) => `${cwd}/.pi/mcp.json`,
  };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeRepoWithWorktree(): { main: string; worktree: string } {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "mcp-admit-main-")));
  cleanup.push(main);
  git(main, ["-c", "init.defaultBranch=main", "init"]);
  git(main, ["commit", "--allow-empty", "-m", "init"]);
  const worktree = join(realpathSync(tmpdir()), `mcp-admit-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  cleanup.push(worktree);
  git(main, ["worktree", "add", "-b", "wt", worktree]);
  return { main, worktree };
}

describe("config writer — project admission", () => {
  it("refuses a traversal alias escaping a known folder, writing nothing", () => {
    const known = realpathSync(mkdtempSync(join(tmpdir(), "mcp-admit-known-")));
    cleanup.push(known);
    const io = makeIO();
    const w = createConfigWriter({ configIO: io, adapter: makePort(), knownCwds: () => [known], scratchCwd: "/tmp/s" });
    const r = w.ensureServerEntry("a", { command: "a" }, { kind: "project", cwd: `${known}/../elsewhere` });
    expect(r.ok === false && r.refusal.code).toBe("not-allowed");
    expect(io.files.size).toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "admits a worktree whose main checkout is a known folder",
    () => {
      const { main, worktree } = makeRepoWithWorktree();
      const io = makeIO();
      const w = createConfigWriter({ configIO: io, adapter: makePort(), knownCwds: () => [main], scratchCwd: "/tmp/s" });
      const r = w.ensureServerEntry("a", { command: "a" }, { kind: "project", cwd: worktree });
      expect(r.ok).toBe(true);
      expect(io.files.has(`${worktree}/.pi/mcp.json`)).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a worktree whose main checkout is not known, writing nothing",
    () => {
      const { worktree } = makeRepoWithWorktree();
      const io = makeIO();
      const w = createConfigWriter({ configIO: io, adapter: makePort(), knownCwds: () => [], scratchCwd: "/tmp/s" });
      const r = w.ensureServerEntry("a", { command: "a" }, { kind: "project", cwd: worktree });
      expect(r.ok === false && r.refusal.code).toBe("not-allowed");
      expect(io.files.size).toBe(0);
    },
  );
});
