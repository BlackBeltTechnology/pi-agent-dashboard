/**
 * Supervised tool-approval metadata → renderer params.
 *
 * `prompt_request` metadata reaches the card only through the `params` object the
 * client builds, at TWO sites (live `useMessageHandler`, replay `useSessionState`).
 * This is the single key list both spread, so they cannot drift.
 * See change: add-supervised-tool-approval (5.1a, E33).
 */

/** Metadata keys copied verbatim (when present) into the interactive request's params. */
const SUPERVISED_METADATA_KEYS = [
  "kind",
  "deadline",
  "tool",
  "summary",
  "command",
  "path",
  "diffStat",
  "diff",
  "cwd",
  "toolCallId",
] as const;

export function supervisedPromptParams(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!metadata) return out;
  for (const key of SUPERVISED_METADATA_KEYS) {
    if (metadata[key] !== undefined) out[key] = metadata[key];
  }
  return out;
}
