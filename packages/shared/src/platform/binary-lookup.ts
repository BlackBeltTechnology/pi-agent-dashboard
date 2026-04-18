/**
 * Unified binary resolution for all dashboard components.
 * Replaces scattered whichSync/resolvePiCommand/resolveTsxCommand implementations
 * with a single configurable resolver.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MANAGED_BIN, MANAGED_DIR } from "../managed-paths.js";

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
   * Resolve pi as [cmd, ...prefixArgs].
   * On Windows, avoids .cmd by returning [node.exe, cli.js].
   */
  resolvePi(): string[] | null {
    if (process.platform === "win32") {
      // Avoid .cmd — resolve pi's JS entry point directly
      const piCli = path.join(MANAGED_BIN, "..", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
      if (existsSync(piCli)) {
        const node = this.resolveNode();
        if (node) return [node, piCli];
      }
      // Fallback to .cmd
      const cmd = path.join(MANAGED_BIN, "pi.cmd");
      if (existsSync(cmd)) return [cmd];
    }

    const piPath = this.which("pi");
    if (piPath) return [piPath];
    return null;
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

/** Resolve a command on the current process PATH via which/where. */
function whichSync(cmd: string): string | null {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    // Coerce to string — execSync returns Buffer without encoding, string with
    // it, and test mocks vary between the two. String() handles both safely.
    const raw = execSync(`${whichCmd} ${cmd}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const text = typeof raw === "string" ? raw : String(raw);
    return text.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/** Resolve a command via login shell (picks up nvm/volta/homebrew paths). */
function whichViaLoginShell(cmd: string): string | null {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const raw = execSync(`${shell} -ilc "which ${cmd}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
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
