/**
 * ArtCraft Craft Launcher source: resolve a Crafting App's CLI from a launcher
 * installation. Never downloads (the explicit installer lives in
 * `launcher-install.ts`).
 *
 * Probe result (change add-craft-apps-core, task 0.3, macOS, launcher 0.4.1):
 * the launcher installs the *desktop* app bundle (`/Applications/<Name>.app`
 * from the release `.dmg`) and that bundle ships only the GUI executable — there
 * is no `<app>-cli` inside, and the GUI binary opens a window for any argument.
 * So on macOS the launcher source reports "installed, no CLI" and callers fall
 * back to `managed`. Windows/Linux roots below are best-effort (not probed);
 * `CRAFT_LAUNCHER_HOME` points at any apps root explicitly.
 *
 * See change: add-craft-apps-core (design D3).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { binName, type CraftApp } from "./registry.js";

export interface LauncherDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homedir: () => string;
}

/** Directories that hold launcher-installed apps. */
export function launcherRoots(deps: LauncherDeps): string[] {
  if (deps.env.CRAFT_LAUNCHER_HOME) return [path.resolve(deps.env.CRAFT_LAUNCHER_HOME)];
  const home = deps.homedir();
  switch (deps.platform) {
    case "darwin":
      return ["/Applications", path.join(home, "Applications")];
    case "win32": {
      const local = deps.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      const pf = deps.env.ProgramFiles ?? "C:\\Program Files";
      return [path.join(local, "Programs"), pf];
    }
    default:
      return ["/opt", path.join(home, ".local", "share")];
  }
}

/** Candidate install directories of `app` under `root` (bundle on macOS). */
function appDirs(app: CraftApp, root: string, platform: string): string[] {
  const names = platform === "darwin" ? [`${app.name}.app`] : [app.name, app.id];
  return [...new Set(names)].map((n) => path.join(root, n));
}

/** Where a CLI may sit inside an app install directory. */
function cliCandidates(app: CraftApp, dir: string, platform: string): string[] {
  const cli = binName(app, platform);
  return [
    path.join(dir, cli),
    path.join(dir, "bin", cli),
    path.join(dir, "Contents", "MacOS", cli),
    path.join(dir, "Contents", "Resources", cli),
  ];
}

function isExecutable(file: string, platform: string): boolean {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > 0 && (platform === "win32" || (st.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

export interface LauncherAppState {
  app: CraftApp["id"];
  /** The launcher installed the desktop app. */
  installed: boolean;
  appDir?: string;
  /** Absolute path of a runnable CLI inside the install, when there is one. */
  cli?: string;
}

export function launcherAppState(app: CraftApp, deps: LauncherDeps): LauncherAppState {
  for (const root of launcherRoots(deps)) {
    for (const dir of appDirs(app, root, deps.platform)) {
      if (!fs.existsSync(dir)) continue;
      const cli = cliCandidates(app, dir, deps.platform).find((c) => isExecutable(c, deps.platform));
      return { app: app.id, installed: true, appDir: dir, cli };
    }
  }
  return { app: app.id, installed: false };
}

export type LauncherLookup = { binary: string; reason?: undefined } | { binary?: undefined; reason: string };

/** CLI of `app` from a launcher install, or the reason there is none. Never downloads. */
export function launcherBinary(app: CraftApp, deps: LauncherDeps): LauncherLookup {
  const state = launcherAppState(app, deps);
  if (!state.installed) return { reason: `the Craft Launcher has not installed ${app.name}` };
  if (!state.cli) {
    return { reason: `${app.name} is installed by the Craft Launcher at ${state.appDir} but ships no ${app.cli} (desktop app only)` };
  }
  return { binary: state.cli };
}
