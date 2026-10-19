/**
 * Filesystem locations: the plugin state dir (design D8) and OBS's own config
 * dir per OS (design D5). Pure over injected `home` / `platform` / `env`.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import path from "node:path";

export type Platform = "darwin" | "win32" | "linux";

export interface HostEnv {
  home: string;
  platform: Platform;
  env: Record<string, string | undefined>;
}

/** `~/.pi/dashboard/plugins/obs-studio` unless `--state-dir` overrides it. */
export function stateDir(host: HostEnv, override?: string): string {
  return override ?? path.join(host.home, ".pi", "dashboard", "plugins", "obs-studio");
}

/** Create the state dir 0700 (idempotent). */
export function ensureStateDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Windows portable install root under the state dir (design D9). */
export function portableRoot(state: string): string {
  return path.join(state, "apps", "obs");
}

/**
 * OBS's config dir. `portable` (win32) and `flatpak` (linux) select the variant
 * install's dir; otherwise the OS user's default.
 */
export function obsConfigDir(host: HostEnv, variant: { portable?: string; flatpak?: boolean } = {}): string {
  if (host.platform === "darwin") return path.join(host.home, "Library", "Application Support", "obs-studio");
  if (host.platform === "win32") {
    if (variant.portable) return path.join(variant.portable, "config", "obs-studio");
    return path.join(host.env.APPDATA ?? path.join(host.home, "AppData", "Roaming"), "obs-studio");
  }
  if (variant.flatpak) return path.join(host.home, ".var", "app", "com.obsproject.Studio", "config", "obs-studio");
  return path.join(host.home, ".config", "obs-studio");
}

export function websocketConfigFile(configDir: string): string {
  return path.join(configDir, "plugin_config", "obs-websocket", "config.json");
}

export function sentinelDir(configDir: string): string {
  return path.join(configDir, ".sentinel");
}

export function logsDir(configDir: string): string {
  return path.join(configDir, "logs");
}

/** The executable basename the managed-services matcher uses per OS (design D3). */
export function processName(platform: Platform): string {
  return platform === "darwin" ? "OBS" : platform === "win32" ? "obs64" : "obs";
}
