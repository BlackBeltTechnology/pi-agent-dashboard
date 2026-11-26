/**
 * Teammate-mode registry (task 2.9, design D17): `mode → {driver, available?}`.
 * `session` is registered and always available; a later mode adds an entry,
 * never edits this file. An absent `mode` resolves from config `teammateMode`
 * (default `session`); an unknown or unavailable mode is `mode_unavailable`.
 * See change: add-agent-teams-core.
 */
import { type MemberDriver, SESSION_MODE } from "./driver.js";

type ModeAvailability = { ok: true } | { ok: false; reason: string };

interface ModeEntry {
  driver: MemberDriver;
  /** Per-caller availability (e.g. a mode that needs a capability the caller lacks). */
  available?: (callerSessionId?: string) => ModeAvailability;
}

type ModeResolution = { ok: true; mode: string; entry: ModeEntry } | { ok: false; reason: string };

export interface ModeRegistry {
  register(mode: string, entry: ModeEntry): void;
  get(mode: string): ModeEntry | undefined;
  /** `requested` wins, then `configDefault`, then `session`. */
  resolve(requested: string | undefined, configDefault: string | undefined, callerSessionId?: string): ModeResolution;
  readonly modes: readonly string[];
}

export function createModeRegistry(sessionDriver: MemberDriver): ModeRegistry {
  const entries = new Map<string, ModeEntry>([[SESSION_MODE, { driver: sessionDriver }]]);
  return {
    register(mode, entry) {
      if (entries.has(mode)) throw new Error(`mode already registered: ${mode}`);
      entries.set(mode, entry);
    },
    get: (mode) => entries.get(mode),
    resolve(requested, configDefault, callerSessionId) {
      const mode = requested ?? configDefault ?? SESSION_MODE;
      const entry = entries.get(mode);
      if (!entry) return { ok: false, reason: `unknown mode: ${mode}` };
      const avail = entry.available?.(callerSessionId) ?? { ok: true as const };
      if (!avail.ok) return { ok: false, reason: avail.reason };
      return { ok: true, mode, entry };
    },
    get modes() {
      return [...entries.keys()];
    },
  };
}
