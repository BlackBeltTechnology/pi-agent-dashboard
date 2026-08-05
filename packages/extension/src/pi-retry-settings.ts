/**
 * pi-retry-settings — READ-ONLY reader for pi's own agent-level retry policy.
 *
 * The bridge needs `retry.maxRetries` and `retry.baseDelayMs` purely to render
 * the retry surface (attempt count + computed countdown). It NEVER writes these
 * — only the dashboard's Retry settings surface does (capability
 * `pi-retry-settings`). This module is the read half.
 *
 * Precedence mirrors pi's own settings merge: project `<cwd>/.pi/settings.json`
 * overrides global `~/.pi/agent/settings.json`. Absent files / absent `retry`
 * block → pi's defaults (`maxRetries: 3`, `baseDelayMs: 2000`). A file that
 * exists but cannot be parsed → `baseDelayMs: 0`, which the surface renders as
 * an elapsed-only waiting state rather than a bogus countdown.
 *
 * See change: retry-forever-with-stop-control (design D5, spec
 * `bridge-retry-observability`).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PiRetrySettings {
  /** pi's `retry.enabled`; default true. When false pi never retries at all. */
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

/** pi's own defaults, applied when no `retry` block is present. */
export const PI_RETRY_DEFAULTS: PiRetrySettings = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
};

interface ReadDeps {
  /** Override for tests. Defaults to `os.homedir()`. */
  home?: string;
  /** Session cwd for the project-scoped override. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override file reader for tests. */
  readFile?: (path: string) => string;
  /** Override existence check for tests. */
  fileExists?: (path: string) => boolean;
}

/** Pull `retry.{enabled,maxRetries,baseDelayMs}` from one parsed settings blob. */
function extract(raw: unknown): Partial<PiRetrySettings> {
  if (!raw || typeof raw !== "object") return {};
  const retry = (raw as { retry?: unknown }).retry;
  if (!retry || typeof retry !== "object") return {};
  const out: Partial<PiRetrySettings> = {};
  const en = (retry as { enabled?: unknown }).enabled;
  const mr = (retry as { maxRetries?: unknown }).maxRetries;
  const bd = (retry as { baseDelayMs?: unknown }).baseDelayMs;
  if (typeof en === "boolean") out.enabled = en;
  if (typeof mr === "number" && Number.isFinite(mr)) out.maxRetries = mr;
  if (typeof bd === "number" && Number.isFinite(bd)) out.baseDelayMs = bd;
  return out;
}

/**
 * Read pi's effective retry policy. Never throws — a parse failure degrades to
 * `baseDelayMs: 0` (elapsed-only) rather than surfacing an error.
 */
export function readPiRetrySettings(deps: ReadDeps = {}): PiRetrySettings {
  const home = deps.home ?? homedir();
  const cwd = deps.cwd ?? process.cwd();
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const exists = deps.fileExists ?? existsSync;

  const globalPath = join(home, ".pi", "agent", "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");

  let merged: PiRetrySettings = { ...PI_RETRY_DEFAULTS };
  let parseFailed = false;

  for (const path of [globalPath, projectPath]) {
    if (!exists(path)) continue;
    try {
      merged = { ...merged, ...extract(JSON.parse(read(path))) };
    } catch {
      parseFailed = true;
    }
  }

  // A file existed but could not be parsed → we cannot trust the delay math;
  // render elapsed-only instead of a fabricated countdown.
  if (parseFailed) return { enabled: merged.enabled, maxRetries: merged.maxRetries, baseDelayMs: 0 };
  return merged;
}
