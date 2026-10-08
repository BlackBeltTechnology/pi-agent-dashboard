/**
 * Shared environment-variable parsing. Lives apart from `policy.ts` so the
 * diagnostics sink (`log.ts`) can use it without an import cycle
 * (`policy.ts` itself logs through `log.ts`).
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Boolean env var: `1` / `true` / `yes` / `on`, any case, surrounding space ignored. */
export function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
