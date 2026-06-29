/**
 * Client-side editor detection and open-editor API helpers.
 */
import { getApiBase } from "./api-context.js";
import { fetchJson, fetchJsonResponse } from "./fetch-json.js";

export function isLocalhost(): boolean {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export interface DetectedEditor {
  id: string;
  name: string;
}

export async function fetchEditors(cwd: string): Promise<DetectedEditor[]> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/editors?path=${encodeURIComponent(cwd)}`);
    if (json.success) return json.data;
    return [];
  } catch {
    return [];
  }
}

export async function openEditor(
  cwd: string,
  editorId: string,
  file?: string,
  line?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { json } = await fetchJsonResponse<{ success: boolean; error?: string }>(`${getApiBase()}/api/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cwd, editor: editorId, file, line }),
    });
    return json;
  } catch (err: any) {
    return { success: false, error: err.message ?? "Network error" };
  }
}
