/**
 * Client transport for the lazy server-side file-mention resolver
 * (`POST /api/file/resolve-mention`).
 *
 * The client detects mentions synchronously (offline-safe); resolution against
 * the real filesystem happens on click, here. A `{ resolved: string }` names a
 * real in-scope file; `{ resolved: null }` means "no such file" (NOT an error).
 * A transport FAILURE (network / 5xx / non-JSON) throws — the caller MUST treat
 * that differently from a null result (design D5).
 *
 * See change: server-side-file-mention-resolution.
 */
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export type ResolveMentionKind = "abs" | "tilde" | "relative";

/** Resolved payload: an absolute path + kind, or null when no in-scope file. */
export interface ResolveMentionResult {
  resolved: string | null;
  kind?: ResolveMentionKind;
}

/**
 * Ask the server to resolve `mention` against `cwd`. Returns the resolved
 * payload (`resolved` string | null). Throws `ApiHttpError` on a transport
 * failure so the caller can fall back to client-side open (never treating a
 * failure as absent).
 */
export async function resolveFileMention(
  cwd: string,
  mention: string,
): Promise<ResolveMentionResult> {
  const json = await fetchJson<{ success: boolean; data?: ResolveMentionResult }>(
    `${getApiBase()}/api/file/resolve-mention`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, mention }),
    },
  );
  return json.data ?? { resolved: null };
}
