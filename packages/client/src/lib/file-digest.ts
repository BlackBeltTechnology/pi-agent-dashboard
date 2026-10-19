/**
 * Client for `GET /api/file/digest` — a content digest (no content) the editor
 * pane compares against a per-tab baseline to decide whether a `file_changed`
 * signal is a real change. Always opted out of the access-grant dialog: a
 * background verification must never suspend or prompt (a refusal simply maps
 * to "show the banner").
 *
 * See change: gate-changed-on-disk-by-content (D4).
 */
import { fetchWithoutGrantPrompt } from "./access-grants/grant-channel.js";
import { getApiBase } from "./api/api-context.js";

export interface FileDigest {
  sha1: string;
  size: number;
  mtime: number;
}

/** `baseline`: a tab is about to mount (served first). `verify`: a background candidate check. */
export type DigestPurpose = "baseline" | "verify";

/**
 * Resolve the digest, or `null` for any non-answer (404, refusal, no `sha1`
 * above the ceiling, malformed body). Rejects only on a transport error or an
 * abort, which callers distinguish from a definite "no digest".
 */
export async function fetchFileDigest(
  cwd: string,
  path: string,
  purpose: DigestPurpose,
  signal?: AbortSignal,
): Promise<FileDigest | null> {
  const url =
    `${getApiBase()}/api/file/digest?cwd=${encodeURIComponent(cwd)}` +
    `&path=${encodeURIComponent(path)}&purpose=${purpose}`;
  const res = await fetchWithoutGrantPrompt(url, { signal, cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const d = body?.success ? body.data : null;
  if (!d || typeof d.sha1 !== "string") return null;
  return { sha1: d.sha1, size: typeof d.size === "number" ? d.size : 0, mtime: typeof d.mtime === "number" ? d.mtime : 0 };
}
