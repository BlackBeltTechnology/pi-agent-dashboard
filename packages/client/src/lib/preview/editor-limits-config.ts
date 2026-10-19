/**
 * Client-side mirror of the server's resolved `editor.largeFileLimitMb`
 * (`GET /api/config`). Module-level store (same pattern as
 * `mermaid-repair-config.ts`) so `CappedViewer` / `TooLargePreview` — rendered
 * in many surfaces without a shared provider — read ONE limit via
 * `resolveEditorLimitBytes()`. `loaded` lets the gate wait for hydration
 * instead of flashing the too-large fallback at the default; App hydration
 * calls `hydrateEditorLimitsConfig` on load and on `config_updated {editor}`.
 *
 * See change: gate-changed-on-disk-by-content (D6).
 */
import { MAX_PREVIEW_BYTES } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { useSyncExternalStore } from "react";

const MB = 1024 * 1024;

export interface EditorLimitsSnapshot {
  /** Rich-viewer too-large threshold in bytes. */
  bytes: number;
  /** True once a valid `/api/config` response has been applied. */
  loaded: boolean;
}

const INITIAL: EditorLimitsSnapshot = { bytes: MAX_PREVIEW_BYTES, loaded: false };
let current: EditorLimitsSnapshot = INITIAL;
const listeners = new Set<() => void>();

function set(next: EditorLimitsSnapshot): void {
  if (next.bytes === current.bytes && next.loaded === current.loaded) return;
  current = next;
  for (const l of listeners) l();
}

/** Normalize an untrusted `data.editor.largeFileLimitMb`; anything unusable → default bytes. */
function bytesOf(raw: unknown): number {
  const v = (raw as { largeFileLimitMb?: unknown } | null | undefined)?.largeFileLimitMb;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.round(v) * MB : MAX_PREVIEW_BYTES;
}

/** Apply a `GET /api/config` JSON response. A failed response leaves the store untouched. */
export function hydrateEditorLimitsConfig(response: unknown): void {
  const d = response as { success?: boolean; data?: { editor?: unknown } } | null;
  if (d?.success) set({ bytes: bytesOf(d.data?.editor), loaded: true });
}

/** The single reader of the rich-viewer too-large limit, in bytes. */
export function resolveEditorLimitBytes(): number {
  return current.bytes;
}

export function getEditorLimitsSnapshot(): EditorLimitsSnapshot {
  return current;
}

export function useEditorLimits(): EditorLimitsSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => INITIAL,
  );
}

/** Test seam: restore the pre-hydration state. */
export function __resetEditorLimitsConfig(): void {
  current = INITIAL;
  for (const l of listeners) l();
}
