/**
 * Pure presentation helpers for the `/pair?request` landing: the 8-digit
 * confirmation code is shown in two blocks of four (chunking), and times as
 * `m:ss`. No browser APIs — safe in a non-secure context.
 *
 * See change: add-lan-knock-pairing (ui-plan D7).
 */

/** `48217730` → `4821 7730` (blocks of four); any other shape is returned unchanged. */
export function groupConfirmCode(code: string): string {
  return /^\d{8}$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** Screen-reader reading of the grouped code: `48217730` → `4 8 2 1, 7 7 3 0`. */
export function confirmCodeAriaLabel(code: string): string {
  return groupConfirmCode(code)
    .split(" ")
    .map((block) => block.split("").join(" "))
    .join(", ");
}

/** Milliseconds → `m:ss` (rounded up to the next second, floored at `0:00`). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
