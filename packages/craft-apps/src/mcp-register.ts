/**
 * `pi-craft <app> mcp --register` — opt-in write of a `craft-<app>` entry (for
 * PhotoCraft: `photocraft`) into the project's `.pi/mcp.json` (merge, never
 * clobber; malformed file aborts untouched). The entry uses absolute paths: pi
 * starts project stdio servers with the session directory (the project root) as
 * cwd, so no `--root`. Nothing is ever registered implicitly.
 *
 * See change: add-photocraft-plugin (design D6), add-craft-apps-core (design D4).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CraftApp } from "./registry.js";

export interface RegisterDeps {
  cwd: string;
  execPath: string;
  /** Absolute path of the launcher the entry runs (`pi-craft`, or `pi-photocraft` for the alias). */
  launcher: string;
  /** Arguments after the launcher; default `[<app>, "mcp"]` (`["mcp"]` for the `pi-photocraft` alias). */
  entryArgs?: string[];
  /** Command prefix in diagnostics. */
  prog: string;
  allowUnconfined: boolean;
  /** Persist `--compact` (apps with a compact MCP mode only). */
  compact?: boolean;
  stderr: (text: string) => void;
}

/** `<package root>/bin/<name>`, valid from `src/` and from the bundled `dist/`. */
export function defaultLauncherPath(name = "pi-craft"): string {
  return fileURLToPath(new URL(`../bin/${name}`, import.meta.url));
}

/** Entry name under `mcpServers`: `craft-<app>`, except PhotoCraft which keeps its historical `photocraft`. */
export function serverName(app: CraftApp): string {
  return app.id === "photocraft" ? "photocraft" : `craft-${app.id}`;
}

export function registerMcp(app: CraftApp, partial: Partial<RegisterDeps> = {}): number {
  const deps: RegisterDeps = {
    cwd: process.cwd(),
    execPath: process.execPath,
    launcher: defaultLauncherPath(),
    prog: "pi-craft",
    allowUnconfined: false,
    stderr: (t) => process.stderr.write(t),
    ...partial,
  };
  if (deps.compact && !app.mcp.compactFlag) {
    deps.stderr(`${deps.prog}: --compact is not supported by ${app.name}'s MCP server\n`);
    return 1;
  }
  if (app.mcp.confinement === false && !deps.allowUnconfined) {
    deps.stderr(
      `${deps.prog}: ${app.name}'s MCP server has no path confinement and can read and write any path the user can; refusing to register it. Pass --allow-unconfined to accept that.\n`,
    );
    return 1;
  }
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
      deps.stderr(`${deps.prog}: ${file} is not valid JSON (${(e as Error).message}); left untouched\n`);
      return 1;
    }
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  const name = serverName(app);
  const args = [deps.launcher, ...(deps.entryArgs ?? [app.id, "mcp"])];
  if (app.mcp.confinement === false) args.push("--allow-unconfined");
  if (deps.compact) args.push("--compact");
  servers[name] = { command: deps.execPath, args };
  config.mcpServers = servers;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);

  deps.stderr(`${deps.prog}: registered "${name}" in ${file}\n`);
  deps.stderr("  note: the entry holds absolute paths and is machine-specific (do not commit it for a team).\n");
  deps.stderr("  note: pi loads project MCP servers only after the project is trusted.\n");
  deps.stderr("  note: start pi in the project root — a session in a subdirectory does not load .pi/mcp.json.\n");
  if (app.mcp.confinement === false) {
    deps.stderr(`  warning: ${app.name}'s server is unconfined — it can read and write any path the user can (registered with --allow-unconfined).\n`);
  }
  if (app.mcp.toolClass === "large" && !deps.compact) {
    const hint = app.mcp.compactFlag ? ` or register with --compact (helper tools only; every command stays reachable)` : "";
    deps.stderr(
      `  warning: ${app.name}'s server exposes over ${Math.floor(app.mcp.tools / 100) * 100} tools (${app.mcp.tools}); that floods the model context — prefer the bash route (${deps.prog === "pi-photocraft" ? deps.prog : `${deps.prog} ${app.id}`} exec …)${hint}.\n`,
    );
  }
  if (!looksLikeRoot) {
    deps.stderr(`  warning: ${deps.cwd} does not look like a project root (no .git or .pi/); pi loads .pi/mcp.json only when started there.\n`);
  }
  return 0;
}
