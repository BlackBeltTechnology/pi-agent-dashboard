export type FormatValidation = { ok: true } | { ok: false; reason: string };
/** Extension → check (worker-run format validators, design D7). */
export const ROUTES: Record<string, (bytes: Uint8Array, ext: string) => FormatValidation>;
/** Route on `ext`; an extension without a route is rejected. */
export function validate(bytes: Uint8Array, ext: string): FormatValidation;
