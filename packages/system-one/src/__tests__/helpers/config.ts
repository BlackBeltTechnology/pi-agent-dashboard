/** Test helper: write the user config under the per-file HOME. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { _resetForTests, userConfigPath } from "../../config.js";
import { stateDir } from "../../paths.js";

/**
 * HOME is per test FILE, not per test: remove the user config and the
 * system-one state dir, and reset process caches, before each test.
 */
export function freshState(): void {
  rmSync(userConfigPath(), { force: true });
  rmSync(stateDir(), { recursive: true, force: true });
  _resetForTests();
}

export function writeUserConfig(cfg: Record<string, unknown>): void {
  mkdirSync(dirname(userConfigPath()), { recursive: true });
  writeFileSync(userConfigPath(), JSON.stringify({ version: 1, activePreset: "p", ...cfg }));
}

/** Chain `ids` of loopback http backends `{ id: url }` in preset `p`. */
export function chainConfig(backends: Record<string, string | Record<string, unknown>>, extra: Record<string, unknown> = {}): void {
  const b: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(backends)) b[id] = typeof v === "string" ? { kind: "http", url: v, model: `${id}-model` } : v;
  writeUserConfig({ backends: b, presets: { p: { chain: Object.keys(backends) } }, ...extra });
}
