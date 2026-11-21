/**
 * Sudo credential prompt: constants, limits and config clamping shared by the
 * bridge, the server relay and the browser dialog.
 *
 * The password itself only ever travels in `sudo_credential_response`; nothing
 * in this module (or any log line built from it) carries a value.
 *
 * See change: add-sudo-credential-prompt.
 */

/** Advertised in `dashboard_identity.features`; the bridge installs its askpass wrapper only when present. */
export const SUDO_CREDENTIAL_FEATURE = "sudo-credential";

/** A browser must ack (`sudo_credential_shown`) within this window or the request is refused (G2). */
export const SUDO_CREDENTIAL_ACK_DEADLINE_MS = 2000;

/** Longest accepted password (G5); empty is rejected as well. */
export const SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH = 1024;

/** Displayed prompt text cap, after escaping (G1). Middle-truncated: first 250 + last 250. */
export const SUDO_CREDENTIAL_PROMPT_TEXT_MAX = 500;

export const SUDO_CREDENTIAL_DEFAULT_TIMEOUT_MS = 120_000;
export const SUDO_CREDENTIAL_MIN_TIMEOUT_MS = 5_000;
export const SUDO_CREDENTIAL_MAX_TIMEOUT_MS = 600_000;
export const SUDO_CREDENTIAL_DEFAULT_CACHE_MINUTES = 5;
export const SUDO_CREDENTIAL_MAX_CACHE_MINUTES = 60;

/** Reason carried by a non-sticky `sudo_credential_cancel` (no browser could answer / answer timed out). */
export type SudoCredentialCancelReason = "unanswerable" | "timeout";

export interface SudoCredentialPromptConfig {
  /** Default on; the Security-tab toggle exists only to disable it. */
  enabled: boolean;
  /** Per-prompt timeout (ms), clamped to [5 000, 600 000]. */
  timeoutMs: number;
  /** In-memory cache window (minutes), clamped to [0, 60]; 0 disables caching. */
  cacheMinutes: number;
}

export const DEFAULT_SUDO_CREDENTIAL_PROMPT: SudoCredentialPromptConfig = {
  enabled: true,
  timeoutMs: SUDO_CREDENTIAL_DEFAULT_TIMEOUT_MS,
  cacheMinutes: SUDO_CREDENTIAL_DEFAULT_CACHE_MINUTES,
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Floor to an integer, clamp to [0, 60]; non-numeric takes the default (5). */
export function clampSudoCacheMinutes(raw: unknown): number {
  if (!finite(raw)) return SUDO_CREDENTIAL_DEFAULT_CACHE_MINUTES;
  return Math.min(SUDO_CREDENTIAL_MAX_CACHE_MINUTES, Math.max(0, Math.floor(raw)));
}

/** Clamp to [5 000, 600 000] ms; non-numeric takes the default (120 000). */
export function clampSudoTimeoutMs(raw: unknown): number {
  if (!finite(raw)) return SUDO_CREDENTIAL_DEFAULT_TIMEOUT_MS;
  return Math.min(SUDO_CREDENTIAL_MAX_TIMEOUT_MS, Math.max(SUDO_CREDENTIAL_MIN_TIMEOUT_MS, raw));
}

/** Clamp-and-default parse; never rejects, so a config write always succeeds (D2, D3, G9). */
export function parseSudoCredentialPrompt(raw: unknown): SudoCredentialPromptConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SUDO_CREDENTIAL_PROMPT.enabled,
    timeoutMs: clampSudoTimeoutMs(r.timeoutMs),
    cacheMinutes: clampSudoCacheMinutes(r.cacheMinutes),
  };
}
