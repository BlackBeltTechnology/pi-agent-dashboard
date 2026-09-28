/**
 * normalizeEnvPathKey — collapse every case-variant of the PATH key into a
 * single `PATH` key on win32.
 *
 * Windows stores the variable as `Path`. The live `process.env` is
 * case-insensitive, but a plain-object copy (`{ ...process.env }`,
 * `Object.entries`) keeps the literal key, so code that reads `env.PATH`
 * sees `undefined` and writing `env.PATH` yields BOTH `Path` and `PATH`.
 * Node's win32 spawn then keeps only the first key in sort order — and
 * `"PATH" < "Path"` — silently dropping the inherited PATH (#720).
 *
 * Contract:
 *   - Non-win32, no variant, or a lone string-valued `PATH` → returns the
 *     SAME object (identity fast path; idempotent).
 *   - Otherwise returns a clone: variants merged `PATH` first then the rest
 *     sorted; entries split on `;`, empties dropped, de-duped
 *     case-insensitively (first seen wins); every variant key deleted;
 *     `PATH` written only when at least one variant held a string.
 *   - Never mutates the input.
 *
 * See change: fix-windows-path-env-key-casing.
 */
export function normalizeEnvPathKey(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== "win32") return env;
  const variants = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  if (variants.length === 0) return env;
  if (variants.length === 1 && variants[0] === "PATH" && typeof env.PATH === "string") return env;

  const ordered = [
    ...variants.filter((k) => k === "PATH"),
    ...variants.filter((k) => k !== "PATH").sort(),
  ];
  const values = ordered.map((k) => env[k]).filter((v): v is string => typeof v === "string");

  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of variants) delete out[key];
  if (values.length > 0) out.PATH = mergePathEntries(values);
  return out;
}

/** Join `;`-lists in order: empties dropped, case-insensitive de-dup (first wins). */
function mergePathEntries(values: string[]): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of values.flatMap((v) => v.split(";"))) {
    const lower = entry.toLowerCase();
    if (entry === "" || seen.has(lower)) continue;
    seen.add(lower);
    entries.push(entry);
  }
  return entries.join(";");
}
