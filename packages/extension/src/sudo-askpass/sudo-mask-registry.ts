/**
 * Append-only registry of operator-entered sudo passwords, fed to the vault
 * masker so every exact occurrence becomes `[REDACTED:SUDO_PASSWORD]` in
 * tool_result / message_end / user_bash output / event_forward frames.
 *
 * `vault-masker.ts` is pull-based (`getState()` + a version that rebuilds it) and
 * has no `add`, so this registry is only a value store with a monotonic
 * version; `bridge.ts` composes it with the vault state. State lives on
 * `process` (like the vault registry) so a bridge reload keeps masking a
 * password that sudo may still echo. Values are never removed: expiry, Forget,
 * shutdown and disabling the setting do not unmask.
 *
 * See change: add-sudo-credential-prompt (D7 C).
 */

import type { MaskerState } from "../vault-masker.js";

export const SUDO_MASK_REGISTRY_KEY = Symbol.for("__piDashboardSudoMaskRegistry");
/** Label used in the replacement token. */
export const SUDO_MASK_NAME = "SUDO_PASSWORD";

interface SudoMaskRegistry {
  values: Set<string>;
  /** Replaced (never mutated) on register, so a returned state is a stable snapshot. */
  entries: Array<{ name: string; value: string }>;
  version: number;
}

function registry(): SudoMaskRegistry {
  const holder = process as unknown as Record<symbol, SudoMaskRegistry | undefined>;
  return (holder[SUDO_MASK_REGISTRY_KEY] ??= { values: new Set(), entries: [], version: 0 });
}

/**
 * Register `value` for masking. Idempotent: a repeated value does not bump the
 * version. Empty / non-string input is ignored (the masker drops it anyway);
 * no minimum length applies, so a 1-char password masks every occurrence.
 */
export function registerSudoPassword(value: string): void {
  if (typeof value !== "string" || value.length === 0) return;
  const r = registry();
  if (r.values.has(value)) return;
  r.values.add(value);
  r.entries = [...r.entries, { name: SUDO_MASK_NAME, value }];
  r.version++;
}

/** Masker state of the registered passwords; `version` only ever increases. */
export function sudoMaskState(): MaskerState {
  const r = registry();
  return { version: r.version, entries: r.entries };
}
