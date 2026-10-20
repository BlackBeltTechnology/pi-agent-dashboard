/**
 * Shared test fixtures for the resync-hermes-memory-config-0-9 suites.
 * See change: resync-hermes-memory-config-0-9.
 */
import { buildResolvedConfig } from "../client/settings-model.js";
import type { EffectiveConfig } from "../server/config-io.js";
import { DEFAULTS, KNOWN_KEYS, LEGACY_0_8_1_DEFAULTED_KEYS } from "../shared/hermes-config.js";

/**
 * A file as the 0.8.1-era write-all plugin saved it: all 23 legacy keys at
 * their 0.8.1 defaults (`consolidationTimeoutMs` 60000).
 */
export function legacyFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = Object.fromEntries(
    LEGACY_0_8_1_DEFAULTED_KEYS.map((k) => [k, (DEFAULTS as Record<string, unknown>)[k]]),
  );
  return { ...base, consolidationTimeoutMs: 60000, ...overrides };
}

/**
 * The PUT body the form sends for an untouched GET (mirrors
 * HermesMemorySettings `load` → `buildResolvedConfig`): non-default fields are
 * "overridden" and sent with their value; the rest send DEFAULTS.
 */
export function noTouchBody(eff: EffectiveConfig): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const overridden = new Set<string>();
  for (const key of KNOWN_KEYS) {
    const fv = eff.fields[key];
    values[key] = fv?.value;
    if (fv && !fv.isDefault) overridden.add(key);
  }
  return buildResolvedConfig(values, overridden);
}
