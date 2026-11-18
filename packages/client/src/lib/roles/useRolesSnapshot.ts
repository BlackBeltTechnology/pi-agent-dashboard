/**
 * Full `GET /api/roles` envelope for a host that must show what a persisted
 * `@role` ref resolves to (Settings → Sessions default model follow hint).
 *
 * `liveRows === null` → roles API absent / non-2xx / unreachable (no hint).
 * `activePreset` → name of the active NAMED preset; `null` when the live group
 * is the active one. Fetched on mount; `refetch()` re-reads (call it after a
 * Default model pick). See change: default-model-follows-role (design D3).
 */
import { parseModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RolesSnapshotRow {
  role: string;
  assigned: boolean;
  model?: string;
  thinkingLevel?: string;
}

interface RolesBody {
  data?: Array<{ preset: string | null; active?: boolean; roles?: RolesSnapshotRow[] }>;
}

export interface RolesSnapshot {
  liveRows: RolesSnapshotRow[] | null;
  activePreset: string | null;
  refetch: () => void;
}

export function useRolesSnapshot(): RolesSnapshot {
  const [state, setState] = useState<{ liveRows: RolesSnapshotRow[] | null; activePreset: string | null }>({
    liveRows: null,
    activePreset: null,
  });
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    void (async () => {
      let next: { liveRows: RolesSnapshotRow[] | null; activePreset: string | null } = { liveRows: null, activePreset: null };
      try {
        const res = await fetch("/api/roles");
        if (res.ok) {
          const body = (await res.json()) as RolesBody;
          const groups = Array.isArray(body?.data) ? body.data : [];
          const live = groups.find((g) => g.preset === null) ?? groups[0];
          const named = groups.find((g) => g.preset !== null && g.active);
          next = { liveRows: Array.isArray(live?.roles) ? live.roles : [], activePreset: named?.preset ?? null };
        }
      } catch {
        /* unreachable → null */
      }
      if (mine === seq.current) setState(next);
    })();
  }, []);
  useEffect(() => {
    load();
    return () => {
      seq.current++; // drop in-flight results after unmount
    };
  }, [load]);
  return { ...state, refetch: load };
}


/** What a persisted `@role[:level]` default resolves to in the live role map. */
export interface RoleDefaultView {
  role: string;
  /** `:level` suffix written into the ref by hand. */
  suffix?: string;
  /** Concrete `provider/id`; absent when unassigned / unknown / no `provider/`. */
  model?: string;
  /** Suffix, else the role's level (only when resolved). */
  level?: string;
}

/** `null` for a concrete (non-`@`) value. Mirrors the shared `resolveDefaultModel` rules. */
export function roleDefaultView(value: string | undefined, liveRows: RolesSnapshotRow[] | null): RoleDefaultView | null {
  const p = parseModelRef(value ?? "");
  if (p.kind !== "role") return null;
  const row = liveRows?.find((r) => r.role === p.role);
  const model = row?.assigned && row.model && row.model.indexOf("/") > 0 ? row.model : undefined;
  const level = p.level ?? (model ? row?.thinkingLevel : undefined);
  return { role: p.role, ...(p.level ? { suffix: p.level } : {}), ...(model ? { model } : {}), ...(level ? { level } : {}) };
}

/**
 * Dashboard defaults as the server mirror would derive them: an `@role` default
 * becomes its resolved `provider/id` + effective level (explicit > suffix > role
 * level). Unresolved / roles API absent → no model and no level, so the pi
 * settings page reports no drift for it.
 */
export function resolvedMirrorDefaults(
  d: { defaultModel?: string; defaultThinkingLevel?: string } | undefined,
  liveRows: RolesSnapshotRow[] | null,
): { defaultModel?: string; defaultThinkingLevel?: string } | undefined {
  const view = roleDefaultView(d?.defaultModel, liveRows);
  if (!d || !view) return d;
  if (!view.model) return { defaultModel: "", defaultThinkingLevel: "" };
  return { defaultModel: view.model, defaultThinkingLevel: d.defaultThinkingLevel || view.level || "" };
}
