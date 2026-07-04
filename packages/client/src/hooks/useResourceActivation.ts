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

export function useResourceActivation(cwd?: string): ResourceActivationController {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [pending, setPending] = useState<PendingReload | null>(null);

  const isEnabled = useCallback(
    (r: PiResource) => (overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled),
    [overrides],
  );

  const toggle = useCallback(
    (r: PiResource, scope: ResourceScope, packageSource?: string) => {
      const prev = overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled;
      const next = !prev;
      // Optimistic flip.
      setOverrides((m) => new Map(m).set(r.filePath, next));
      void (async () => {
        const res = await toggleResource({
          scope,
          cwd: scope === "local" ? cwd : undefined,
          type: r.type,
          filePath: r.filePath,
          enabled: next,
          packageSource,
        });
        if (!res.ok) {
          // Revert on failure.
          setOverrides((m) => new Map(m).set(r.filePath, prev));
          return;
        }
        setPending(
          res.affectedSessions.length > 0
            ? { scope, cwd: scope === "local" ? cwd : undefined, count: res.affectedSessions.length }
            : null,
        );
      })();
    },
    [cwd, overrides],
  );

  const reload = useCallback(() => {
    if (!pending) return;
    void (async () => {
      const res = await reloadResourceSessions(pending.scope, pending.cwd);
      if (res.ok) setPending(null);
    })();
  }, [pending]);

  const clearPending = useCallback(() => setPending(null), []);

  return { isEnabled, toggle, pending, reload, clearPending };
}
