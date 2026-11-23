/**
 * Client transport for the lazy server-side file-mention resolver
 * (`POST /api/file/resolve-mention`).
 *
 * The client detects mentions synchronously (offline-safe); resolution against
 * the real filesystem happens on click, here. A `{ resolved: string }` names a
 * real in-scope file; `{ resolved: null }` means "no such file" (NOT an error);
 * `{ resolved, outside: true }` is a candidate that FAILED server containment (never
 * statted — existence unknown), which the open route's read gate decides.
 * A transport FAILURE (network / 5xx / non-JSON) throws — the caller MUST treat
 * that differently from a null result (design D5).
 *
 * `resolveFileMentionsBatch` is the transcript pre-confirmation transport (`POST /api/file/resolve-mentions`); it
 * throws `ApiHttpError` on any failure, and the caller treats a 429 as "back off" and everything else as "stay unknown".
 *
 * See change: server-side-file-mention-resolution, fix-file-link-editor-routing, rich-chat-links.
 */
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

type ResolveMentionKind = "abs" | "tilde" | "relative" | "fuzzy";

/** Tagged state the resolver reports (rich-chat-links D3). `unknown` only occurs in a batch (item past the cap). */
export type MentionLinkState = "found" | "recovered" | "ambiguous" | "missing" | "gated";

/** Resolved payload: an absolute path + kind, or null when no in-scope file. */
export interface ResolveMentionResult {
  resolved: string | null;
  kind?: ResolveMentionKind;
  /** True when the candidate failed containment (not statted). Absent on a contained hit and on `null`. */
  outside?: boolean;
  /** Tagged outcome (present when the server speaks rich-chat-links). */
  state?: MentionLinkState;
  /** Candidate paths when `state` is `ambiguous` (server order, at most 10). */
  candidates?: string[];
}

/** One item of a batch request. */
export interface BatchMentionItem {
  mention: string;
  toolCwd?: string;
  reRooted?: string;
}

/** One batch result, same order as the request. `unknown` = not processed (past the server cap). */
export interface BatchMentionResult {
  state: MentionLinkState | "unknown";
  resolved?: string;
  kind?: ResolveMentionKind;
  via?: "tool-dir" | "fuzzy";
  candidates?: string[];
}

/** Opt-in recovery for a click-time resolve (transcript links only). */
export interface ResolveMentionOptions {
  recover?: boolean;
  toolCwd?: string;
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
  opts?: ResolveMentionOptions,
): Promise<ResolveMentionResult> {
  const json = await fetchJson<{ success: boolean; data?: ResolveMentionResult }>(
    `${getApiBase()}/api/file/resolve-mention`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, mention, ...(opts?.recover ? { recover: true } : {}), ...(opts?.toolCwd ? { toolCwd: opts.toolCwd } : {}) }),
    },
  );
  return json.data ?? { resolved: null };
}

/**
 * Resolve many mentions in one request (design D2/D3). Results keep the request order and length.
 * Throws on a transport failure, a non-2xx (429 → `ApiHttpError.status === 429`) or a non-JSON body.
 */
export async function resolveFileMentionsBatch(cwd: string, items: BatchMentionItem[]): Promise<BatchMentionResult[]> {
  const json = await fetchJson<{ success: boolean; data?: { results?: BatchMentionResult[] } }>(
    `${getApiBase()}/api/file/resolve-mentions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, items }),
    },
  );
  return json.data?.results ?? [];
}
