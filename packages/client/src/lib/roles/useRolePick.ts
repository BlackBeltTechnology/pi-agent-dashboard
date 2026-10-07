/**
 * One-shot role pick for session-model pickers (Kind C).
 *
 * Picking `@coding` resolves the role ONCE (fresh `GET /api/roles` at pick
 * time, never a cached list) and applies the concrete model through the
 * caller's existing `selectModel` / `selectLevel`. The running session does NOT
 * follow later preset changes; the picker shows a transient "via @coding" hint
 * that clears when the session model moves off the resolved value.
 *
 * - unassigned role / unreachable roles API → no change + notice
 * - resolved level the target model does not support → model applied, level
 *   skipped + notice (no nearest-level mapping)
 *
 * See change: add-role-aware-model-refs (D8).
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RolePickNotice {
  kind: "unassigned" | "level-skipped" | "unavailable";
  role: string;
  level?: string;
}

interface RoleRow {
  role: string;
  assigned: boolean;
  model?: string;
  thinkingLevel?: string;
}

async function fetchRoleRow(role: string): Promise<RoleRow | "unavailable"> {
  try {
    const res = await fetch("/api/roles");
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { data?: Array<{ preset: string | null; roles: RoleRow[] }> };
    const live = body.data?.find((g) => g.preset === null) ?? body.data?.[0];
    return live?.roles.find((r) => r.role === role) ?? { role, assigned: false };
  } catch {
    return "unavailable";
  }
}

export interface UseRolePickOptions {
  /** The model the session (or draft) currently reports, as `provider/id`. */
  currentModel?: string;
  models?: ModelInfo[];
  selectModel: (label: string) => void;
  selectLevel?: (level: string) => void;
}

export interface UseRolePick {
  /** Drop-in `onSelect` for a picker rendered with `allowRoles`. */
  onSelect: (label: string) => void;
  /** `@role` the current session model came from, until it changes. */
  viaRole?: string;
  notice?: RolePickNotice;
  clearNotice: () => void;
}

export function useRolePick(opts: UseRolePickOptions): UseRolePick {
  const { currentModel, models, selectModel, selectLevel } = opts;
  const [via, setVia] = useState<{ role: string; model: string } | null>(null);
  const [notice, setNotice] = useState<RolePickNotice | undefined>();
  // Becomes true once the session has REPORTED the resolved model, so a stale
  // pre-switch `model_update` cannot clear the hint early.
  const confirmed = useRef(false);

  useEffect(() => {
    if (!via) return;
    if (currentModel === via.model) confirmed.current = true;
    else if (confirmed.current) setVia(null);
  }, [currentModel, via]);

  const onSelect = useCallback(
    (label: string) => {
      setNotice(undefined);
      if (!label.startsWith("@")) {
        setVia(null);
        selectModel(label);
        return;
      }
      const role = label.slice(1).split(":")[0] ?? "";
      void (async () => {
        const row = await fetchRoleRow(role);
        if (row === "unavailable") return setNotice({ kind: "unavailable", role: label });
        if (!row.assigned || !row.model) return setNotice({ kind: "unassigned", role: label });
        selectModel(row.model);
        confirmed.current = false;
        setVia({ role: label, model: row.model });
        const level = row.thinkingLevel;
        if (!level || !selectLevel) return;
        const supported = models?.find((m) => `${m.provider}/${m.id}` === row.model)?.supportedThinkingLevels;
        if (supported?.length && !supported.includes(level)) {
          setNotice({ kind: "level-skipped", role: label, level });
          return;
        }
        selectLevel(level);
      })();
    },
    [models, selectLevel, selectModel],
  );

  return { onSelect, viaRole: via?.role, notice, clearNotice: () => setNotice(undefined) };
}

/** Human text for a notice. i18n keys carry English defaults, matching the surrounding components. */
export function rolePickNoticeText(
  n: RolePickNotice,
  t: (key: string, vars: Record<string, string> | undefined, fallback: string) => string,
): string {
  switch (n.kind) {
    case "unassigned":
      return t("roles.pick.unassigned", { role: n.role }, `${n.role} has no model assigned — model unchanged.`);
    case "level-skipped":
      return t(
        "roles.pick.levelSkipped",
        { role: n.role, level: n.level ?? "" },
        `Model set from ${n.role}; thinking level ${n.level} is not supported by it, so the level was left unchanged.`,
      );
    default:
      return t("roles.pick.unavailable", { role: n.role }, `Could not resolve ${n.role} — model unchanged.`);
  }
}
