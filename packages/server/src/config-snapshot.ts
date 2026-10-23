/**
 * mtime-gated snapshot of `~/.pi/dashboard/config.json` (D15/C6).
 *
 * Two authorization-adjacent reads used to close over a BOOT snapshot — the
 * CORS `origin` callback and `networkGuard`'s trusted networks — so a config
 * write persisted but did not apply until restart. Both now read through here.
 *
 * Why not `loadConfig()` per call: `networkGuard` is a `preHandler` on every
 * request, so the cost is per-request. Measured on the real 3.5 KB config,
 * `existsSync + readFileSync + JSON.parse` is 24.5 µs while `statSync().mtimeMs`
 * is 1.9 µs, so the snapshot `stat`s every call and reparses only when the file
 * actually moved (~13× cheaper in steady state).
 *
 * Why not invalidate-on-write: a hand-edited `config.json` never passes through
 * our writer. The gate MUST stay filesystem-derived — "optimising" this into a
 * boot-time snapshot silently reinstates the bug it exists to fix, which is why
 * P5 pins invalidation as its own scenario.
 *
 * See change: config-override-oauth-redirect-base.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type DashboardConfig, type HostGateMode, loadConfig, resolvePublicBaseUrls } from "@blackbelt-technology/pi-dashboard-shared/config.js";

let cached: DashboardConfig | null = null;
/** `${mtimeMs}:${size}` of the file behind `cached`; `""` = never loaded. */
let cachedStamp = "";
let parseCount = 0;
/** Raw `requireLocalProof` as found in the file behind `cached`; `undefined` = absent or a valid boolean. */
let cachedRlpInvalid: { raw: unknown } | undefined;
/** Last non-boolean value already warned about (JSON-keyed), so the log never repeats. */
let lastWarnedRlp: string | undefined;

/** Resolved per call — `os.homedir()` follows `$HOME`, which tests reassign. */
function configFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

function stamp(): string {
  try {
    const st = fs.statSync(configFile());
    // Size rides along with mtime: a same-millisecond rewrite of a different
    // length would otherwise slip past a coarse filesystem clock.
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "absent";
  }
}

/**
 * `true` when the file is absent, empty, or parses as JSON. A `config.json`
 * that exists but no longer parses must not silently flip every live gate back
 * to boot defaults mid-run, so the snapshot layer keeps the last GOOD parse
 * instead (X5 of add-host-allowlist-admission). An absent / unreadable / empty
 * file is NOT corruption — it falls through to `loadConfig()` (defaults), the
 * pre-existing behaviour.
 */
function parsesCleanly(): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(configFile(), "utf-8");
  } catch {
    return true; // absent / unreadable → not corruption
  }
  if (!raw.trim()) return true;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false; // present but malformed → preserve the last good snapshot
  }
}

/**
 * A PRESENT, non-boolean `requireLocalProof` in the file (e.g. a quoted
 * `"false"` rollback attempt). It parses as strict, so the operator must be told.
 * Read here, not in `loadConfig`, which every bridge process also runs.
 * See change: close-container-loopback-impersonation (D1).
 */
function readInvalidRequireLocalProof(): { raw: unknown } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf-8")) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object" && "requireLocalProof" in parsed && typeof parsed.requireLocalProof !== "boolean") {
      return { raw: parsed.requireLocalProof };
    }
  } catch {
    /* absent / unparseable → nothing to report */
  }
  return undefined;
}

/**
 * The current config, reparsed only when the file changed since the last call.
 * Callers MUST NOT mutate the returned object — it is shared. When the file
 * exists but no longer parses, the LAST GOOD snapshot stays in force (with a
 * one-line error) until the operator fixes it.
 */
export function getConfigSnapshot(): DashboardConfig {
  const current = stamp();
  if (cached && current === cachedStamp) return cached;
  if (cached && !parsesCleanly()) {
    console.error(
      "[config-snapshot] config.json is unparseable — keeping the last-good snapshot",
    );
    cachedStamp = current;
    return cached;
  }
  // First read of a corrupt file: `loadConfig()` swallows the parse error and
  // returns defaults. Log it so the fallback is visible, not silent.
  if (!cached && !parsesCleanly()) {
    console.error("[config-snapshot] config.json is unparseable — using defaults");
  }
  cached = loadConfig();
  cachedStamp = current;
  cachedRlpInvalid = readInvalidRequireLocalProof();
  parseCount++;
  return cached;
}

/**
 * CORS allow-list as of this request. Exported (rather than inlined at the
 * `server.ts` call site) so the live-read contract is testable against the REAL
 * expression the server uses instead of a hand-mirrored copy.
 */
export function liveCorsAllowedOrigins(fallback: string[] = []): string[] {
  return getConfigSnapshot().cors?.allowedOrigins ?? fallback;
}

/** `cors.allowZrokWildcard` as of this request (live; boolean `true` only). */
export function liveCorsAllowZrokWildcard(): boolean {
  return getConfigSnapshot().cors?.allowZrokWildcard === true;
}

/** Trusted networks as of this request (top-level ∪ `auth.bypassHosts`). */
export function liveTrustedNetworks(fallback: string[] = []): string[] {
  return getConfigSnapshot().resolvedTrustedNetworks ?? fallback;
}

/** `requireLocalProof` as of this request (live, no restart). */
export function liveRequireLocalProof(): boolean {
  const effective = getConfigSnapshot().requireLocalProof !== false;
  if (cachedRlpInvalid) {
    const key = JSON.stringify(cachedRlpInvalid.raw) ?? "undefined";
    if (key !== lastWarnedRlp) {
      lastWarnedRlp = key;
      console.warn(
        `[config] requireLocalProof=${key} is not a boolean; treating it as true (strict). Use an explicit \`false\` to opt out.`,
      );
    }
  } else {
    lastWarnedRlp = undefined;
  }
  return effective;
}

/** `liveServer.previewExposure` as of this request (`"exposed"` forces exposed; otherwise `undefined`). See change: improve-canvas-html-and-url-ux. */
export function livePreviewExposureOverride(): string | undefined {
  return getConfigSnapshot().liveServer?.previewExposure;
}

/** `pairing.acceptLanRequests` as of this request (live, no restart). See change: add-lan-knock-pairing. */
export function liveAcceptLanRequests(): boolean {
  return getConfigSnapshot().pairing?.acceptLanRequests === true;
}

/** Top-level `allowedHosts` as of this request (bind-time field, live list). */
export function liveAllowedHosts(fallback: string[] = []): string[] {
  return getConfigSnapshot().allowedHosts ?? fallback;
}

/**
 * Public base URLs as of this request, through `resolvePublicBaseUrls` so the
 * legacy `pairing.publicBaseUrls` key is honoured (D2).
 */
export function livePublicBaseUrls(fallback: string[] = []): string[] {
  return resolvePublicBaseUrls(getConfigSnapshot()) ?? fallback;
}

/** Resolved `hostGate.mode` from config alone (env override is applied by the gate). */
export function liveHostGateMode(fallback: HostGateMode = "enforce"): HostGateMode {
  return getConfigSnapshot().hostGate?.mode ?? fallback;
}

/** True when the RAW config file carries a `hostGate.mode` key (boot-line source). */
export function rawConfigHasHostGateMode(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf-8")) as { hostGate?: { mode?: unknown } };
    return parsed?.hostGate?.mode !== undefined;
  } catch {
    return false;
  }
}

/** Drop the cache (tests, and any explicit re-read after a known write). */
export function resetConfigSnapshot(): void {
  cached = null;
  cachedStamp = "";
  parseCount = 0;
  cachedRlpInvalid = undefined;
  lastWarnedRlp = undefined;
}

/** How many full read+parse cycles happened. Test-only observability (P3/P4). */
export function configSnapshotParseCount(): number {
  return parseCount;
}
