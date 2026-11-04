/**
 * Per-folder remembered spawn model · thinking choice, next to the agent memory
 * (`lib/acp/agent-memory.ts`). Stores `@role` refs verbatim: the server resolves
 * them once at spawn time. Total over unavailable / garbled storage.
 *
 * Effective choice = remembered field ?? Settings default field ?? none, per
 * field. The Settings defaults are mirrored into a tiny module store by App
 * (`setSpawnDefaults`) so quick-spawn paths need no prop drilling.
 *
 * Writes live in `spawn-choice-write.ts` (only the lazy chip writes), keeping
 * this eager module minimal. See change: add-spawn-model-choice (design D6).
 */
export interface SpawnChoice {
  model?: string;
  thinkingLevel?: string;
}

const KEY_PREFIX = "pi-dashboard:spawn-choice:";

export const spawnChoiceKey = (cwd: string): string => `${KEY_PREFIX}${cwd}`;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function normalizeSpawnChoice(raw: unknown): SpawnChoice {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const model = str(obj.model);
  const thinkingLevel = str(obj.thinkingLevel);
  return { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
}

/** The remembered choice for `cwd` (fields absent when not remembered). */
export function getRememberedSpawnChoice(cwd: string): SpawnChoice {
  try {
    const raw = window.localStorage.getItem(spawnChoiceKey(cwd));
    return raw ? normalizeSpawnChoice(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

// ── Settings defaults mirror ──────────────────────────────────────────────

let defaults: SpawnChoice = {};
const listeners = new Set<() => void>();

/** App mirrors Settings `defaultModel` / `defaultThinkingLevel` here. */
export function setSpawnDefaults(next: { defaultModel?: string; defaultThinkingLevel?: string }): void {
  const model = str(next.defaultModel);
  const thinkingLevel = str(next.defaultThinkingLevel);
  if (model === defaults.model && thinkingLevel === defaults.thinkingLevel) return;
  defaults = { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
  for (const l of listeners) l();
}

export function getSpawnDefaults(): SpawnChoice {
  return defaults;
}

/** Subscribe to Settings-default changes (the chip's `useSyncExternalStore`). */
export function subscribeSpawnDefaults(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Remembered ?? Settings default, per field. */
export function getEffectiveSpawnChoice(cwd: string, fallback: SpawnChoice = getSpawnDefaults()): SpawnChoice {
  const remembered = getRememberedSpawnChoice(cwd);
  const model = remembered.model ?? str(fallback.model);
  const thinkingLevel = remembered.thinkingLevel ?? str(fallback.thinkingLevel);
  return { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
}
