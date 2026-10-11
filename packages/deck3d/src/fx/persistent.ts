/**
 * Ids of corpus cards declaring `persistent: true`. A static list so the IR
 * layer (`applyOverrides`, `validate`) can apply the deck-scope-only rule
 * without importing every effect module; `persistent.test.ts` fails when it
 * drifts from the cards.
 */
export const PERSISTENT_FX: ReadonlySet<string> = new Set(["frame-chrome"]);

export function isPersistentFx(id: string): boolean {
  return PERSISTENT_FX.has(id);
}
