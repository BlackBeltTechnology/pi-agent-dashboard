/**
 * Client helper for the content-search endpoint (`GET /api/grep`). Used by the
 * editor pane's search panel in Contents mode.
 *
 * See change: split-editor-workspace.
 */

import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export interface GrepMatch {
  /** Path relative to the session cwd. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match start. */
  col: number;
  /** Trimmed line text. */
  snippet: string;
}

/**
 * Content-grep across the session `cwd`. Returns ranked matches, or `[]` on any
 * error / non-success response (best-effort — the panel shows "no results").
 */
export async function grepContents(cwd: string, query: string, regex: boolean): Promise<GrepMatch[]> {
  try {
    const params = new URLSearchParams({ cwd, q: query });
    if (regex) params.set("regex", "1");
    const json = await fetchJson(`${getApiBase()}/api/grep?${params.toString()}`);
    if (json.success && Array.isArray(json.data?.matches)) return json.data.matches as GrepMatch[];
    return [];
  } catch {
    return [];
  }
}
