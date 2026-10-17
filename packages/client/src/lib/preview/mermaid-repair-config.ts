/**
 * Client-side mirror of the server's resolved `mermaidRepair` config block
 * (`GET /api/config`). Module-level store so `MermaidBlock` — rendered in many
 * surfaces without a shared provider — can gate the "Fix with AI" action.
 * Default is disabled; App hydration calls `hydrateMermaidRepairConfig`.
 * See change: add-mermaid-ai-repair.
 */
import { useSyncExternalStore } from "react";

export interface MermaidRepairClientConfig {
  enabled: boolean;
  /** `provider/id` shown in the disclosure line and AI-fixed badge. */
  model?: string;
}

const DISABLED: MermaidRepairClientConfig = { enabled: false };
let current: MermaidRepairClientConfig = DISABLED;
const listeners = new Set<() => void>();

/** Normalize an untrusted `data.mermaidRepair` value; anything unusable → disabled. */
export function setMermaidRepairClientConfig(raw: unknown): void {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const model = typeof r?.model === "string" && r.model ? r.model : undefined;
  const next: MermaidRepairClientConfig =
    r?.enabled === true && model ? { enabled: true, model } : DISABLED;
  if (next.enabled === current.enabled && next.model === current.model) return;
  current = next;
  for (const l of listeners) l();
}

/** Apply a `GET /api/config` JSON response. */
export function hydrateMermaidRepairConfig(response: unknown): void {
  const d = response as { success?: boolean; data?: { mermaidRepair?: unknown } } | null;
  if (d?.success) setMermaidRepairClientConfig(d.data?.mermaidRepair);
}

export function getMermaidRepairClientConfig(): MermaidRepairClientConfig {
  return current;
}

export function useMermaidRepairClientConfig(): MermaidRepairClientConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => DISABLED,
  );
}
