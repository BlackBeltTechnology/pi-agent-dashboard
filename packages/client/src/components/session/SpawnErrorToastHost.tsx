/**
 * App-level toast container for off-screen `spawn_error` events. Mounted
 * once at the top of the React tree; reads from the
 * `spawn-error-toast-bus` singleton. See change: harden-worktree-spawn.
 */
import React, { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  dismissSpawnErrorToast,
  type SpawnErrorToastEntry,
  subscribeSpawnErrorToasts,
} from "../../lib/state/spawn-error-toast-bus.js";

export function SpawnErrorToastHost() {
  const [entries, setEntries] = useState<ReadonlyArray<SpawnErrorToastEntry>>([]);

  useEffect(() => {
    return subscribeSpawnErrorToasts(setEntries);
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      data-testid="spawn-error-toast-host"
    >
      {entries.map((e) => (
        <div
          key={e.id}
          className="pointer-events-auto flex items-start gap-2 px-3 py-2 bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] text-sm rounded-lg shadow-lg border border-[var(--severity-error-border)] max-w-sm"
          data-testid={`spawn-error-toast-${e.id}`}
        >
          <span className="flex-1 whitespace-pre-line">{e.message}</span>
          <button
            type="button"
            onClick={() => dismissSpawnErrorToast(e.id)}
            className="text-[var(--severity-error-fg)]/70 hover:text-[var(--severity-error-fg)] flex-shrink-0 leading-none"
            aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
            title={i18nT("common.dismiss", undefined, "Dismiss")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
