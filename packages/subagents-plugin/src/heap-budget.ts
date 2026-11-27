/**
 * Per-child heap budget of the subagents plugin (moved out of shared `heap-limits.ts`).
 * See change: move-subagents-to-plugin (9.3).
 */
/**
 * Per-child heap guidance figure (MB) below which the session ceiling and the
 * subagent concurrency limit are a risky pairing.
 */
export const SUBAGENT_HEAP_GUIDANCE_MB = 100;

/**
 * Subagents run IN-PROCESS and share the parent's single V8 heap, so the
 * subagents producer's `maxConcurrent` is a memory-safety knob once a ceiling
 * is enforced. `+ 1` accounts for the parent itself. `0` = unlimited → always
 * warns (no per-child figure, `perChildMb: 0`).
 *
 * One formula, used by the subagents plugin's "Max parallel subagents" field
 * and its tests, so the warning the operator sees and the number the test
 * asserts cannot drift.
 * See change: bound-session-heap-and-gc-telemetry (task 10.8); subagent-queue-visibility (D5, D6).
 */
export function subagentHeapBudget(
  maxOldSpaceMb: number,
  maxConcurrent: number,
): { perChildMb: number; warn: boolean } {
  if (
    !Number.isFinite(maxOldSpaceMb) ||
    !Number.isFinite(maxConcurrent) ||
    maxConcurrent < 0
  ) {
    return { perChildMb: 0, warn: false };
  }
  if (maxConcurrent === 0) return { perChildMb: 0, warn: maxOldSpaceMb > 0 };
  const perChildMb = Math.floor(maxOldSpaceMb / (maxConcurrent + 1));
  return { perChildMb, warn: perChildMb < SUBAGENT_HEAP_GUIDANCE_MB };
}
