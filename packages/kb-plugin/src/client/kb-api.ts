/**
 * Thin REST client for the folder-scoped KB endpoints, plus the base64url
 * folder-path codec used in the `/folder/:encodedCwd/kb` overlay route.
 *
 * Same-origin relative `/api/kb/...` URLs. The kb routes return plain JSON
 * objects (`{ files, chunks, ... }` or `{ error }`) — not the `{ success,
 * data }` envelope — so responses are read directly. A content-type guard
 * mirrors the client's `fetch-json` protection so a proxy/SPA HTML body
 * surfaces as a typed error, never a JSON parse crash.
 *
 * See change: add-kb-folder-slot.
 */
import type {
  KbConfigPatch,
  KbConfigResponse,
  KbReindexResult,
  KbReindexRunning,
  KbStats,
} from "../shared/kb-plugin-types.js";

// ── Folder-path codec (base64url, UTF-8 safe) ─────────────────────
// `btoa`/`atob` only handle Latin1; round-trip through UTF-8 bytes first so a
// cwd with accents/CJK does not throw.
export function encodeFolderPath(cwd: string): string {
  const bytes = new TextEncoder().encode(cwd);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeFolderPath(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    const bin = atob(padded + "=".repeat(pad));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function kbSettingsUrl(cwd: string): string {
  return `/folder/${encodeFolderPath(cwd)}/kb`;
}

// ── REST ──────────────────────────────────────────────────────────
async function parseJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  }
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

export async function fetchKbStats(cwd: string, signal?: AbortSignal): Promise<KbStats> {
  const res = await fetch(`/api/kb/stats?cwd=${encodeURIComponent(cwd)}`, { signal });
  return parseJson<KbStats>(res);
}

export async function reindexKb(cwd: string): Promise<KbReindexResult | KbReindexRunning> {
  const res = await fetch(`/api/kb/reindex?cwd=${encodeURIComponent(cwd)}`, { method: "POST" });
  return parseJson<KbReindexResult | KbReindexRunning>(res);
}

export async function fetchKbConfig(cwd: string, signal?: AbortSignal): Promise<KbConfigResponse> {
  const res = await fetch(`/api/kb/config?cwd=${encodeURIComponent(cwd)}`, { signal });
  return parseJson<KbConfigResponse>(res);
}

export async function saveKbConfig(cwd: string, patch: KbConfigPatch): Promise<KbConfigResponse> {
  const res = await fetch(`/api/kb/config?cwd=${encodeURIComponent(cwd)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseJson<KbConfigResponse>(res);
}
