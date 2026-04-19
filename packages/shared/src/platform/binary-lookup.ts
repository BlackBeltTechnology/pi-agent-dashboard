/**
 * Unified binary resolution for all dashboard components.
 * Replaces scattered whichSync/resolvePiCommand/resolveTsxCommand implementations
 * with a single configurable resolver.
 */
import { execSync, spawnSync, buildSafeArgv } from "./exec.js";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MANAGED_BIN, MANAGED_DIR } from "../managed-paths.js";

/**
 * Well-known globalThis symbol for the default `ToolRegistry`.
 *
 * The registry publishes itself here when first constructed (see
 * `tool-registry/index.ts::getDefaultRegistry`). Delegation avoids a
 * static import cycle (tool-registry strategies already import from
 * this file).
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
const GLOBAL_REGISTRY_KEY = Symbol.for("pi-dashboard.tool-registry");
interface LazyRegistry {
  has(n: string): boolean;
  resolveExecutor(n: string): { ok: boolean; argv: string[] };
}
function tryGetRegistry(): LazyRegistry | null {
  const reg = (globalThis as unknown as { [k: symbol]: LazyRegistry | undefined })[GLOBAL_REGISTRY_KEY];
  return reg ?? null;
}

export interface ResolverContext {
  /** Extra bin dirs to search before system PATH (e.g., bundled Node dir). */
  extraBinDirs?: string[];
  /** Current process.execPath — used for Node resolution in server/extension. */
  processExecPath?: string;
  /** Use login shell fallback for GUI apps on macOS/Linux. */
  useLoginShell?: boolean;
}

/**
 * Unified tool resolver. All binary lookups follow:
 * managed bin → extraBinDirs → system PATH → login shell (if enabled)
 */
export class ToolResolver {
  private ctx: ResolverContext;

  constructor(ctx: ResolverContext = {}) {
    this.ctx = ctx;
  }

  /**
   * Resolve a binary by name. Returns absolute path or null.
   * Search order: managed bin → extra dirs → system PATH → login shell.
   */
  which(name: string): string | null {
    const ext = process.platform === "win32" ? ".cmd" : "";

    // 1. Managed install
    const managed = path.join(MANAGED_BIN, name + ext);
    if (existsSync(managed)) return managed;

    // 2. Extra bin dirs
    for (const dir of this.ctx.extraBinDirs ?? []) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }

    // 3. System PATH
    const systemPath = whichSync(name);
    if (systemPath) return systemPath;

    // 4. Login shell fallback (macOS/Linux GUI apps)
    if (this.ctx.useLoginShell && process.platform !== "win32") {
      return whichViaLoginShell(name);
    }

    return null;
  }

  /**
   * Resolve pi as spawn-ready argv `[cmd, ...prefixArgs]`.
   *
   * Fully delegates to `ToolRegistry.resolveExecutor("pi")`, which
   * owns per-OS discovery + interpreter assembly (on Windows: find
   * `pi-coding-agent/dist/cli.js` via managed/bare-import/npm-global
   * and prepend `node.exe`; on Unix: find `pi` binary on PATH).
   *
   * Returns null when the registry is not yet constructed AND pi is
   * not on PATH (very early boot / standalone tests). Production code
   * always has the registry available before spawn.
   */
  resolvePi(): string[] | null {
    const registry = tryGetRegistry();
    if (registry?.has("pi")) {
      const exec = registry.resolveExecutor("pi");
      if (exec.ok && exec.argv.length > 0) return exec.argv;
    }
    // No registry in this process (e.g. legacy bootstrap) — fall back
    // to PATH lookup so the method still works for non-server callers.
    const piPath = this.which("pi");
    return piPath ? [piPath] : null;
  }

  /**
   * Resolve tsx as [cmd, ...prefixArgs].
   * On Windows, avoids .cmd by returning [node.exe, tsx/dist/cli.mjs].
   */
  resolveTsx(): string[] | null {
    if (process.platform === "win32") {
      const tsxCli = path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "cli.mjs");
      if (existsSync(tsxCli)) {
        const node = this.resolveNode();
        if (node) return [node, tsxCli];
      }
    }

    const tsxPath = this.which("tsx");
    if (tsxPath) return [tsxPath];
    return null;
  }

  /**
   * Resolve Node.js binary path.
   * Checks processExecPath, extra dirs, managed, system PATH, login shell.
   */
  resolveNode(): string | null {
    // If running inside a Node process, use its own binary
    if (this.ctx.processExecPath) {
      return this.ctx.processExecPath;
    }

    // Extra dirs (e.g., bundled Node)
    for (const dir of this.ctx.extraBinDirs ?? []) {
      const nodeName = process.platform === "win32" ? "node.exe" : "node";
      const candidate = path.join(dir, nodeName);
      if (existsSync(candidate)) return candidate;
    }

    return this.which("node");
  }

  /**
   * Build a spawn environment with managed bin, node bin, extra dirs,
   * and common user bin dirs prepended to PATH.
   */
  buildSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const currentPath = base.PATH || "";
    const parts: string[] = [];

    // Managed bin
    if (!currentPath.includes(MANAGED_BIN)) {
      parts.push(MANAGED_BIN);
    }

    // Current node binary dir
    const nodeBin = this.ctx.processExecPath
      ? path.dirname(this.ctx.processExecPath)
      : null;
    if (nodeBin && !currentPath.includes(nodeBin)) {
      parts.push(nodeBin);
    }

    // Extra bin dirs
    for (const dir of this.ctx.extraBinDirs ?? []) {
      if (!currentPath.includes(dir)) {
        parts.push(dir);
      }
    }

    // Common user bin directories (desktop launchers miss these)
    for (const dir of getUserBinDirs()) {
      if (!currentPath.includes(dir)) {
        parts.push(dir);
      }
    }

    if (parts.length === 0) return base;
    return { ...base, PATH: `${parts.join(path.delimiter)}${path.delimiter}${currentPath}` };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Run `where|which <target>` and return ALL stdout lines (trimmed,
 * non-empty), or `[]`.
 *
 * Uses `spawnSync` via `buildSafeArgv` — no shell interpretation at
 * all. `execSync("where tmux")` used to route through cmd.exe (because
 * execSync takes a shell command string); spawnSync with argv bypasses
 * that entirely. Guaranteed no cmd.exe console flash.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function whereAllLines(whichCmd: string, target: string): string[] {
  try {
    const { argv, spawnOptions } = buildSafeArgv(whichCmd, [target]);
    const result = spawnSync<string>(argv[0], argv.slice(1), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...spawnOptions,
    });
    if (result.status !== 0) return [];
    const text = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Extract the file extension (lower-cased, including the dot) from a path, or "". */
function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  const dot = p.lastIndexOf(".");
  return dot > slash ? p.slice(dot).toLowerCase() : "";
}

/**
 * Resolve a command on PATH.
 *
 * Unix: the first `which <name>` hit is authoritative.
 *
 * Windows: `where <name>` lists ALL PATH matches — a directory may contain
 * both a bash shim (extensionless, e.g. `pi`) and a Windows-native form
 * (`pi.cmd`). Node's `spawn()` cannot execute extensionless shims on
 * Windows without `shell: true`, so we pick the first line whose extension
 * is in PATHEXT. Falls back to the first line if none match (preserves
 * whatever the user set up).
 *
 * Single `where` invocation — no per-extension probe loop — to keep
 * resolution fast (especially when the command is missing entirely).
 */
function whichSync(cmd: string): string | null {
  const isWin = process.platform === "win32";
  if (!isWin) {
    const lines = whereAllLines("which", cmd);
    return lines[0] ?? null;
  }

  const lines = whereAllLines("where", cmd);
  if (lines.length === 0) return null;

  // If the caller already specified an extension, trust their pick.
  const callerHasExt = /\.[A-Za-z0-9]+$/.test(cmd);
  if (callerHasExt) return lines[0];

  // Preference order: PATHEXT (user's actual Windows search path) or a
  // standard default. Lower-cased for case-insensitive matching.
  const pathextRaw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1";
  const pathext = pathextRaw.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Pick the first line whose extension matches PATHEXT, scanning by
  // preference order (lower index = more preferred).
  let best: string | null = null;
  let bestRank = Infinity;
  for (const line of lines) {
    const rank = pathext.indexOf(extOf(line));
    if (rank === -1) continue;
    if (rank < bestRank) {
      best = line;
      bestRank = rank;
    }
  }
  if (best) return best;

  // No PATHEXT-matching entry — fall back to first line (could be a bash
  // shim). The runner layer handles the `.cmd` / `.bat` spawn-via-shell
  // case separately; extensionless shims will still ENOENT but that's
  // the right signal to the caller.
  return lines[0];
}

/** Resolve a command via login shell (picks up nvm/volta/homebrew paths). */
function whichViaLoginShell(cmd: string): string | null {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const raw = execSync(`${shell} -ilc "which ${cmd}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
      windowsHide: true,
    });
    const output = (typeof raw === "string" ? raw : String(raw)).trim();
    // Extract absolute path from potentially noisy login shell output
    const pathLine = output.split("\n").find(l => l.trim().startsWith("/"));
    return pathLine?.trim() || null;
  } catch {
    return null;
  }
}

/** Common user bin directories not on PATH for desktop launchers. */
function getUserBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/usr/local/bin",
  ].filter(d => existsSync(d));
}
