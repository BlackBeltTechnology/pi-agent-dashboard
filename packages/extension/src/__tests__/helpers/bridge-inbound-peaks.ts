/**
 * Observed peak inbound load PER BRIDGE CONNECTION, recorded by the B21
 * measurement task (design.md "Measurement record"). The defaults in
 * `inbound-limits.ts` must stay >= 3x these; BP1 asserts it numerically.
 *
 * See change: harden-bridge-inbound-and-discovery (task 2.1).
 */
/** Sustained prompts/s: interactive typing + queued follow-up drain (human-bound). */
export const PEAK_PROMPTS_PER_SEC = 3;
/** Largest back-to-back prompt burst in one 10 s window (paste + queue drain). */
export const PEAK_PROMPT_BURST = 8;
/** Concurrent `!`/exec in one session (UI serialises; one running command at a time). */
export const PEAK_CONCURRENT_BASH = 1;
/** Sessions /reload fans out to; each session's bridge receives exactly one prompt. */
export const RELOAD_FANOUT_SESSIONS = 40;
