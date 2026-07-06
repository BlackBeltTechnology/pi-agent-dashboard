/**
 * Owns the Resources-surface activation UX: optimistic enable/disable overrides
 * plus the one-click "Reload N sessions" pending state.
 *
 * pi reads resource arrays at session start, so a toggle only takes effect on
 * reload — hence the pending-reload affordance. See change:
 * folder-resource-activation-toggle.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useState } from "react";
import {
  type ResourceScope,
  type ResourceType,
  reloadResourceSessions,
  toggleResource,
} from "../lib/resources-api.js";

export interface PendingReload {
  scope: ResourceScope;
  cwd?: string;
  count: number;
}

export interface ResourceActivationController {
  /** Displayed enabled state, honoring any optimistic override. */
  isEnabled: (r: PiResource) => boolean;
  /** Toggle a resource for a scope. `packageSource` set for package-contributed resources. */
  toggle: (r: PiResource, scope: ResourceScope, packageSource?: string) => void;
  pending: PendingReload | null;
  reload: () => void;
  clearPending: () => void;
}

/** Fire the toggle request and reconcile optimistic state. Extracted to keep the
 *  `toggle` callback flat. `revert` restores the pre-toggle value on any failure. */
async function runToggle(
  args: { scope: ResourceScope; cwd?: string; r: PiResource; type: ResourceType; next: boolean; packageSource?: string },
  revert: () => void,
  setPending: (p: PendingReload | null) => void,
): Promise<void> {
  const scopeCwd = args.scope === "local" ? args.cwd : undefined;
  try {
    const res = await toggleResource({
      scope: args.scope,
      cwd: scopeCwd,
      type: args.type,
      filePath: args.r.filePath,
      enabled: args.next,
      packageSource: args.packageSource,
    });
    if (!res.ok) {
      revert();
      return;
    }
    setPending(
      res.affectedSessions.length > 0
        ? { scope: args.scope, cwd: scopeCwd, count: res.affectedSessions.length }
        : null,
    );
  } catch {
    // Network error (fetch threw): revert the optimistic flip.
    revert();
  }
}

export function useResourceActivation(cwd?: string): ResourceActivationController {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [pending, setPending] = useState<PendingReload | null>(null);

  const isEnabled = useCallback(
    (r: PiResource) => (overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled),
    [overrides],
  );

  const toggle = useCallback(
    (r: PiResource, scope: ResourceScope, packageSource?: string) => {
      // Agents have no pi activation dimension; the card never renders a toggle
      // for them, but guard here too. See change: resources-card-tabs.
      if (r.type === "agent") return;
      const type: ResourceType = r.type;
      const prev = overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled;
      const next = !prev;
      // Optimistic flip.
      setOverrides((m) => new Map(m).set(r.filePath, next));
      const revert = () => setOverrides((m) => new Map(m).set(r.filePath, prev));
      void runToggle({ scope, cwd, r, type, next, packageSource }, revert, setPending);
    },
    [cwd, overrides],
  );

  const reload = useCallback(() => {
    if (!pending) return;
    void (async () => {
      try {
        const res = await reloadResourceSessions(pending.scope, pending.cwd);
        if (res.ok) setPending(null);
      } catch {
        // Network error: keep the pending banner so the user can retry.
      }
    })();
  }, [pending]);

  const clearPending = useCallback(() => setPending(null), []);

  return { isEnabled, toggle, pending, reload, clearPending };
}
