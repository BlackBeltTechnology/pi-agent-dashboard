/**
 * Write side of the per-folder spawn-choice memory. Split from
 * `spawn-choice-memory.ts` so only the lazy `SpawnChoiceChip` chunk carries it.
 * Total over unavailable storage. See change: add-spawn-model-choice (design D6).
 */
import { getRememberedSpawnChoice, normalizeSpawnChoice, type SpawnChoice, spawnChoiceKey } from "./spawn-choice-memory.js";

/** Replace the remembered choice for `cwd`; an empty choice clears the key. */
export function setRememberedSpawnChoice(cwd: string, choice: SpawnChoice): void {
  const next = normalizeSpawnChoice(choice);
  try {
    if (next.model || next.thinkingLevel) window.localStorage.setItem(spawnChoiceKey(cwd), JSON.stringify(next));
    else window.localStorage.removeItem(spawnChoiceKey(cwd));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Clear one field (the chip's `default` entry). */
export function clearRememberedSpawnField(cwd: string, field: keyof SpawnChoice): void {
  const { [field]: _dropped, ...rest } = getRememberedSpawnChoice(cwd);
  setRememberedSpawnChoice(cwd, rest);
}
