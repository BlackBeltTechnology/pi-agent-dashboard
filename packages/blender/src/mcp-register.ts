/**
 * `pi-blender mcp --register [--root <dir>]` — opt-in write of one `blender-wasm` entry into the
 * project's `.pi/mcp.json`. Follows `craft-apps/src/mcp-register.ts` (symlink refusal, malformed file
 * left untouched, atomic temp + rename, notes, project-root warning) with one deliberate difference:
 * an existing `blender-wasm` entry is MERGED — only `command` and `args` are replaced, every other key
 * (`enabled`, `env`, `cwd`, exposure settings) is kept, so pi's "a disabled server stays disabled" rule
 * holds. Nothing is ever registered implicitly.
 *
 * See change: add-blender-wasm-mcp (design D7, task 5.2).
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_NAME = "blender-wasm";

export interface RegisterDeps {
  cwd: string;
  execPath: string;
  /** Absolute path of the `pi-blender` launcher the entry runs. */
  launcher: string;
  /** `--root` as typed by the user; stored as an absolute real path. */
  root?: string;
  stderr: (text: string) => void;
}

/** `<package root>/bin/pi-blender`, valid from `src/` and from the bundled `dist/`. */
export function defaultLauncherPath(): string {
  return fileURLToPath(new URL("../bin/pi-blender", import.meta.url));
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Returns the process exit code. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear register pipeline (symlink/JSON/shape guards, merge, write, notes); mirrors craft-apps registerMcp.
export function registerMcp(partial: Partial<RegisterDeps> = {}): number {
  const deps: RegisterDeps = {
    cwd: process.cwd(),
    execPath: process.execPath,
    launcher: defaultLauncherPath(),
    stderr: (t) => process.stderr.write(t),
    ...partial,
  };
  const prog = "pi-blender";
  const file = path.join(deps.cwd, ".pi", "mcp.json");
  for (const p of [path.dirname(file), file]) {
    if (isSymlink(p)) {
      deps.stderr(`${prog}: ${p} is a symbolic link; refusing to write through it\n`);
      return 1;
    }
  }
  let root: string | undefined;
  if (deps.root !== undefined) {
    try {
      root = fs.realpathSync(path.resolve(deps.cwd, deps.root));
      if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
    } catch (e) {
      deps.stderr(`${prog}: --root ${deps.root}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such directory" : (e as Error).message}\n`);
      return 1;
    }
  }
  // Checked before the write: registering creates `.pi/` itself.
  const looksLikeRoot = fs.existsSync(path.join(deps.cwd, ".git")) || fs.existsSync(path.join(deps.cwd, ".pi"));

  let config: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
      config = parsed as Record<string, unknown>;
    } catch (e) {
      deps.stderr(`${prog}: ${file} is not valid JSON (${(e as Error).message}); left untouched\n`);
      return 1;
    }
  }
  if (config.mcpServers !== undefined && (config.mcpServers === null || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    deps.stderr(`${prog}: "mcpServers" in ${file} is not an object; left untouched\n`);
    return 1;
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const existing = servers[SERVER_NAME];
  const kept = existing !== null && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const args = [deps.launcher, "mcp", ...(root ? ["--root", root] : [])];
  servers[SERVER_NAME] = { ...kept, command: deps.execPath, args };
  config.mcpServers = servers;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write beside the target and rename: a crash never leaves a truncated mcp.json.
  // Unpredictable name + `wx`: the open fails if anything (including a planted symlink) already sits there.
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }

  deps.stderr(`${prog}: registered "${SERVER_NAME}" in ${file}\n`);
  deps.stderr("  note: the entry holds absolute paths and is machine-specific (do not commit it for a team).\n");
  deps.stderr("  note: pi loads project MCP servers only after the project is trusted.\n");
  deps.stderr("  note: start pi in the project root — a session in a subdirectory does not load .pi/mcp.json.\n");
  deps.stderr("  note: run `pi-blender ensure` first: the first tool call otherwise downloads ~175 MB and is slow.\n");
  if (!looksLikeRoot) {
    deps.stderr(`  warning: ${deps.cwd} does not look like a project root (no .git or .pi/); pi loads .pi/mcp.json only when started there.\n`);
  }
  return 0;
}
