/**
 * `enabledModels` matching, shared by the bridge extension (filters the
 * dashboard `models_list`) and the pi settings scope editor (in-scope count),
 * so both agree on what a pattern covers.
 *
 * Mirrors pi core's `resolveModelScope`: each pattern is tested with minimatch
 * (case-insensitive) against the canonical `provider/id` and the bare `id`; a
 * trailing `:<thinkingLevel>` is stripped first.
 *
 * See change: pi-settings-full-coverage (design D7).
 */
import * as minimatchNS from "minimatch";

// minimatch's entry shape varies by version/runtime (v10 exposes a named
// `minimatch`; v3/CJS-interop exposes it as the default). A namespace import
// normalises across both.
type MinimatchFn = (target: string, pattern: string, opts?: { nocase?: boolean }) => boolean;
const minimatch: MinimatchFn =
  (minimatchNS as { minimatch?: MinimatchFn }).minimatch ??
  (minimatchNS as unknown as { default?: MinimatchFn }).default ??
  (minimatchNS as unknown as MinimatchFn);

// pi core (core/model-resolver.ts): a trailing `:<thinkingLevel>` on a
// pattern selects a thinking level and is not part of the model match.
const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Drop a trailing `:<thinkingLevel>` (only a valid level counts). */
export function stripThinkingLevel(pattern: string): string {
  const colonIdx = pattern.lastIndexOf(":");
  if (colonIdx !== -1 && VALID_THINKING_LEVELS.has(pattern.slice(colonIdx + 1))) {
    return pattern.slice(0, colonIdx);
  }
  return pattern;
}

/** True when `pattern` (suffix already stripped) covers the model. */
export function matchesPattern(model: { provider: string; id: string }, pattern: string): boolean {
  return (
    minimatch(`${model.provider}/${model.id}`, pattern, { nocase: true }) ||
    minimatch(model.id, pattern, { nocase: true })
  );
}

/** True when any of the raw `enabledModels` entries covers the model. Empty list = no entry matches. */
export function modelInScope(model: { provider: string; id: string }, entries: readonly string[]): boolean {
  return entries.some((e) => matchesPattern(model, stripThinkingLevel(e)));
}
