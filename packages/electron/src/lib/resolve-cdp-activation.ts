/**
 * resolve-cdp-activation.ts — parse argv + env to decide whether to enable
 * Chromium's Chrome DevTools Protocol (CDP) debug surface on the Electron
 * main process.
 *
 * Pure function (argv + env in, decision out) so the parse logic is testable
 * in isolation without spinning up Electron.
 *
 * Activation surfaces (both opt-in, default OFF):
 *   --debug-cdp                     → enabled on default port 9222
 *   --debug-cdp=<port>              → enabled on <port>
 *   PI_DEBUG_CDP=1|true             → enabled on default port 9222
 *   PI_DEBUG_CDP=<port>             → enabled on <port>
 *
 * Precedence: CLI flag wins if both flag and env are present.
 *
 * Port validation: must parse as integer in [1, 65535]. Garbage/zero/out-of-range
 * falls back to the default port 9222 (still enabled — the user clearly asked
 * for CDP, we just can't trust the port they gave us).
 *
 * See change: ship-browser-skill-and-electron-cdp.
 */

export interface CdpActivation {
  enabled: boolean;
  /** Present iff enabled. */
  port?: number;
}

const DEFAULT_PORT = 9222;
const FLAG = "--debug-cdp";
const ENV_KEY = "PI_DEBUG_CDP";

/** Truthy env values that don't carry a port: "1", "true" (case-insensitive). */
function envIsTruthyOnly(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Truthy-disabled env values: "", "0", "false" (case-insensitive). */
function envIsDisabled(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || v === "0" || v === "false";
}

/** Validate a port string. Returns the integer iff it's in [1, 65535], else null. */
function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 65535) return null;
  return n;
}

/**
 * Look up the --debug-cdp flag in argv. Returns:
 *   { present: false }                       — no flag
 *   { present: true, port: number | null }   — flag present, port is parsed value or null (default)
 */
function findCliFlag(argv: readonly string[]): { present: false } | { present: true; port: number | null } {
  for (const arg of argv) {
    if (arg === FLAG) return { present: true, port: null };
    if (arg.startsWith(`${FLAG}=`)) {
      const raw = arg.slice(FLAG.length + 1);
      return { present: true, port: parsePort(raw) };
    }
  }
  return { present: false };
}

/**
 * Resolve CDP activation from argv + env.
 *
 * @param argv  process argv (or any iterable of strings)
 * @param env   process env (or any record of string→string|undefined)
 */
export function resolveCdpActivation(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CdpActivation {
  // CLI flag takes precedence.
  const cli = findCliFlag(argv);
  if (cli.present) {
    return { enabled: true, port: cli.port ?? DEFAULT_PORT };
  }

  // Fall back to env var.
  const envValue = env[ENV_KEY];
  if (envValue === undefined) return { enabled: false };
  if (envIsDisabled(envValue)) return { enabled: false };
  if (envIsTruthyOnly(envValue)) return { enabled: true, port: DEFAULT_PORT };
  // Anything else: try to parse as port; on failure, fall back to default port (still enabled).
  return { enabled: true, port: parsePort(envValue.trim()) ?? DEFAULT_PORT };
}
