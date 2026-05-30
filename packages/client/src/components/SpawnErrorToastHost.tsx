/**
 * App-level toast container for off-screen `spawn_error` events. Mounted
 * once at the top of the React tree; reads from the
 * `spawn-error-toast-bus` singleton. See change: harden-worktree-spawn.
 */
import React, { useEffect, useState } from "react";
import {
  dismissSpawnErrorToast,
  subscribeSpawnErrorToasts,
  type SpawnErrorToastEntry,
} from "../lib/spawn-error-toast-bus.js";

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
          className="pointer-events-auto flex items-start gap-2 px-3 py-2 bg-red-900/90 text-red-200 text-sm rounded-lg shadow-lg border border-red-800 max-w-sm"
          data-testid={`spawn-error-toast-${e.id}`}
        >
          <span className="flex-1 whitespace-pre-line">{e.message}</span>
          <button
            type="button"
            onClick={() => dismissSpawnErrorToast(e.id)}
            className="text-red-300/70 hover:text-red-100 flex-shrink-0 leading-none"
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
