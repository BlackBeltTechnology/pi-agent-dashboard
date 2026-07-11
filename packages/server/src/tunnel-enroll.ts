/**
 * Whitelisted enroll-step executor — the security boundary for running a
 * provider's no-sudo auth/activate step server-side.
 *
 * THREAT MODEL (internet-exposable dashboard): the run surface must never
 * become a command-injection vector. Two hard rules enforce that:
 *   1. Only a FIXED recipe keyed by `(provider, step)` may run. An unknown
 *      pair is rejected without spawning anything — there is no free-form
 *      command path.
 *   2. The token/network-id is a VALIDATED PARAMETER passed as a single argv
 *      element, never string-interpolated. Each validator is a strict
 *      allow-list regex containing NO cmd.exe metacharacters (`& | ^ % < > "`),
 *      so a value that passes validation cannot break out even through the
 *      Windows `.cmd`-via-cmd.exe path (`buildSafeArgv`, CVE-2024-27980 class);
 *      a value that would need one is rejected before spawn.
 *
 * The secret is written to the provider's own config by the provider CLI and
 * is NEVER logged here; error output is redacted of the parameter before it
 * leaves this module.
 *
 * See change: add-tunnel-providers.
 */
import { type Result, runAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import type { TunnelProviderId } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

/** Steps that may run server-side (no elevation). `install` is NOT here — copy-paste only. */
export type EnrollStep = "auth-token" | "activate";

interface EnrollRecipe {
  binary: string;
  /** Build argv AFTER the binary. The param is one element, never interpolated. */
  args: (param: string) => string[];
  /** Strict allow-list validator. Must reject any cmd.exe metacharacter. */
  validate: (param: string) => boolean;
  timeoutMs: number;
}

const re = {
  ngrokToken: /^[A-Za-z0-9_]{20,60}$/,
  tailscaleAuthKey: /^tskey-auth-[A-Za-z0-9-]+$/,
  zerotierNetId: /^[0-9a-f]{16}$/,
  zrokToken: /^[A-Za-z0-9._-]{20,200}$/,
} as const;

/**
 * The ENTIRE set of commands the run endpoint may execute. Frozen; keyed by
 * `${provider}:${step}`. No entry ⇒ the request is refused.
 */
const RECIPES: Readonly<Record<string, EnrollRecipe>> = Object.freeze({
  "ngrok:auth-token": {
    binary: "ngrok",
    args: (tok) => ["config", "add-authtoken", tok],
    validate: (p) => re.ngrokToken.test(p),
    timeoutMs: 30_000,
  },
  "zrok:auth-token": {
    binary: "zrok",
    args: (tok) => ["enable", tok],
    validate: (p) => re.zrokToken.test(p),
    timeoutMs: 30_000,
  },
  "tailscale:auth-token": {
    binary: "tailscale",
    args: (key) => ["up", "--authkey", key],
    validate: (p) => re.tailscaleAuthKey.test(p),
    timeoutMs: 30_000,
  },
  "zerotier:activate": {
    binary: "zerotier-cli",
    args: (netid) => ["join", netid],
    validate: (p) => re.zerotierNetId.test(p),
    timeoutMs: 15_000,
  },
});

export type EnrollResult =
  | { ok: true }
  | { ok: false; reason: "unknown-step" | "invalid-param" | "exec-failed"; message: string };

/** Redact the secret param from any text before it can be surfaced/logged. */
function redact(text: string, param: string): string {
  if (!param) return text;
  return text.split(param).join("‹redacted›");
}

/** Injectable runner for tests (default drives runner.ts `runAsync`). */
export type EnrollRunner = (binary: string, args: string[], timeoutMs: number) => Promise<Result<true>>;

const defaultRunner: EnrollRunner = (binary, args, timeoutMs) =>
  runAsync<string[], true>(
    { argv: (a) => [binary, ...a], parse: () => true, timeout: timeoutMs },
    args,
  );

/**
 * Validate then run one enroll step. Returns before spawning for an unknown
 * `(provider, step)` or an invalid parameter — the two rejection paths the
 * security tests assert. Never logs `param`.
 */
export async function runEnrollStep(
  provider: TunnelProviderId,
  step: EnrollStep,
  param: string,
  run: EnrollRunner = defaultRunner,
): Promise<EnrollResult> {
  const recipe = RECIPES[`${provider}:${step}`];
  if (!recipe) {
    return { ok: false, reason: "unknown-step", message: `no whitelisted recipe for ${provider}:${step}` };
  }
  if (typeof param !== "string" || !recipe.validate(param)) {
    // No spawn. Do not echo the (possibly hostile) param back verbatim.
    return { ok: false, reason: "invalid-param", message: `parameter failed validation for ${provider}:${step}` };
  }
  const result = await run(recipe.binary, recipe.args(param), recipe.timeoutMs);
  if (result.ok) return { ok: true };
  const detail =
    result.error.kind === "exit"
      ? redact(result.error.stderr || result.error.stdout || `exit ${result.error.code}`, param)
      : result.error.kind;
  return { ok: false, reason: "exec-failed", message: redact(detail, param) };
}

/** The known enroll steps per provider — drives the setup-guide UI (D3 taxonomy). */
export const ENROLL_STEPS: Readonly<Record<TunnelProviderId, EnrollStep[]>> = Object.freeze({
  zrok: ["auth-token"],
  ngrok: ["auth-token"],
  tailscale: ["auth-token"],
  zerotier: ["activate"],
});

/** True when `(provider, step)` is a runnable server-side recipe. */
export function isEnrollStepWhitelisted(provider: TunnelProviderId, step: string): boolean {
  return Object.hasOwn(RECIPES, `${provider}:${step}`);
}
