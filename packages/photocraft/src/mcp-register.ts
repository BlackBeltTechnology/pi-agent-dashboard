/**
 * `pi-photocraft mcp --register` — opt-in write of a `photocraft` entry into
 * the project's `.pi/mcp.json` (merge, never clobber; malformed file aborts
 * untouched). The entry uses absolute paths: pi starts project stdio servers
 * with the session directory (the project root) as cwd, so no `--root`.
 *
 * See change: add-photocraft-plugin (design D6).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface RegisterDeps {
  cwd: string;
  execPath: string;
  /** Absolute path of the `pi-photocraft` launcher. */
  launcher: string;
  stderr: (text: string) => void;
}

/** `<package root>/bin/pi-photocraft`, valid from `src/` and from the bundled `dist/`. */
export function defaultLauncherPath(): string {
  return fileURLToPath(new URL("../bin/pi-photocraft", import.meta.url));
}

export function registerMcp(partial: Partial<RegisterDeps> = {}): number {
  const deps: RegisterDeps = {
    cwd: process.cwd(),
    execPath: process.execPath,
    launcher: defaultLauncherPath(),
    stderr: (t) => process.stderr.write(t),
    ...partial,
  };
  const file = path.join(deps.cwd, ".pi", "mcp.json");
  // Checked before the write: registering creates `.pi/` itself.
  const looksLikeRoot = fs.existsSync(path.join(deps.cwd, ".git")) || fs.existsSync(path.join(deps.cwd, ".pi"));

  let config: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
      config = parsed as Record<string, unknown>;
    } catch (e) {
      deps.stderr(`pi-photocraft: ${file} is not valid JSON (${(e as Error).message}); left untouched\n`);
      return 1;
    }
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  servers.photocraft = { command: deps.execPath, args: [deps.launcher, "mcp"] };
  config.mcpServers = servers;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);

  deps.stderr(`pi-photocraft: registered "photocraft" in ${file}\n`);
  deps.stderr("  note: the entry holds absolute paths and is machine-specific (do not commit it for a team).\n");
  deps.stderr("  note: pi loads project MCP servers only after the project is trusted.\n");
  deps.stderr("  note: start pi in the project root — a session in a subdirectory does not load .pi/mcp.json.\n");
  if (!looksLikeRoot) {
    deps.stderr(`  warning: ${deps.cwd} does not look like a project root (no .git or .pi/); pi loads .pi/mcp.json only when started there.\n`);
  }
  return 0;
}
