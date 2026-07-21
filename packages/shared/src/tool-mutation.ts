/**
 * Shared file-mutation tool classifier.
 *
 * Recognizes the shipped file-mutation tool families by NAME (case-insensitive),
 * never by provider or model id. Both the server session-diff extractor and the
 * client diff-refresh signal share this one set so a new alias needs one entry
 * plus a fixture, not a provider branch. See change: retain-failed-tool-file-changes.
 */

/** Mutation tool families and the path-evidence rule each supports. */
export type MutationFamily = "direct" | "shell" | "patch";

/** Direct-file mutation tools — path evidence from `path` / `file_path` args. */
const DIRECT_TOOLS = new Set(["write", "edit", "strreplace"]);
/** Shell mutation tools — path evidence from explicit output tokens. */
const SHELL_TOOLS = new Set(["bash", "shell", "exec_command"]);
/** Patch mutation tools — path evidence from structured applied/changed paths. */
const PATCH_TOOLS = new Set(["apply_patch"]);

/** Normalize a tool name for classification (lower-case, trimmed). */
function normalizeName(toolName: string | null | undefined): string {
  return typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
}

/** True when `toolName` is a shipped file-mutation tool (case-insensitive). */
export function isMutationTool(toolName: string | null | undefined): boolean {
  return mutationFamily(toolName) !== null;
}

/**
 * Classify `toolName` into a mutation family, or `null` when it is not a
 * shipped file-mutation tool. Case-insensitive; ignores surrounding whitespace.
 */
export function mutationFamily(toolName: string | null | undefined): MutationFamily | null {
  const name = normalizeName(toolName);
  if (!name) return null;
  if (DIRECT_TOOLS.has(name)) return "direct";
  if (SHELL_TOOLS.has(name)) return "shell";
  if (PATCH_TOOLS.has(name)) return "patch";
  return null;
}
