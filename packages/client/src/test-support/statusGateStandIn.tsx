/**
 * Core-owned stand-in for a status-gating plugin (the shape the browser relay
 * plugin uses): a module-level store fed by a `shell-headless` claim from a
 * plugin WS frame, a `session-card-badge` claim whose `shouldRender` reads the
 * same store, and `bumpSlotClaimsVersion()` on an empty ↔ non-empty flip so the
 * host re-evaluates the STATUS gate without a session broadcast.
 *
 * Lets core tests exercise the host's STATUS-subcard gate generically instead
 * of importing a real plugin. Frames tolerate malformed shapes exactly as the
 * real store's flatten primitive does: a non-array `instances`, or an instance
 * whose `tabs` is not an array, contributes nothing.
 *
 * See change: decouple-plugins-from-core (task 2.12).
 */
import { bumpSlotClaimsVersion, usePluginMessage } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";

export const STAND_IN_PLUGIN_ID = "standin";
export const STAND_IN_FRAME_TYPE = "standin_status" as const;

export interface StandInFrame {
  type: typeof STAND_IN_FRAME_TYPE;
  auditSeq?: number;
  instances: unknown;
}

let status: StandInFrame | null = null;
const subscribers = new Set<() => void>();

/** Flatten a frame into `<instanceId>/<tabId>` items; malformed shapes yield nothing. */
export function standInItemsOf(frame: StandInFrame | null): string[] {
  const instances: unknown = frame?.instances;
  if (!Array.isArray(instances)) return [];
  return instances.flatMap((instance: { instanceId?: string; tabs?: unknown }) =>
    Array.isArray(instance?.tabs)
      ? (instance.tabs as Array<{ tabId: number }>).map((tab) => `${instance.instanceId}/${tab.tabId}`)
      : [],
  );
}

/** Store a frame (`null` clears) and notify; bumps the claims version on an empty ↔ non-empty flip. */
export function setStandInStatus(frame: StandInFrame | null): void {
  const flipped = standInItemsOf(status).length > 0 !== standInItemsOf(frame).length > 0;
  status = frame;
  if (flipped) bumpSlotClaimsVersion();
  for (const listener of subscribers) listener();
}

/** `shouldRender` for the badge claim — the same primitive the badge's null check uses. */
export const hasStandInItems = (): boolean => standInItemsOf(status).length > 0;

export function resetStandIn(): void {
  status = null;
  subscribers.clear();
  bumpSlotClaimsVersion();
}

function useStandInStatus(): StandInFrame | null {
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    () => status,
    () => status,
  );
}

/**
 * `session-card-badge` claim component: a menu button listing one item per flattened entry.
 * Menu-item test ids mirror the real plugin's (`browser-relay-open-<instance>/<tab>`) so the
 * host-level STATUS-gate assertions read the same as when they ran against the real badge.
 */
export function StandInBadge(): React.ReactElement | null {
  const items = standInItemsOf(useStandInStatus());
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <span>
      <button type="button" data-testid="standin-badge" aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {items.length} items
      </button>
      {open && (
        <div role="menu">
          {items.map((id) => (
            <button key={id} type="button" role="menuitem" data-testid={`browser-relay-open-${id}`}>
              Open {id}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** `shell-headless` claim component: feeds the store from the plugin WS frame; clears on unmount. */
export function StandInFeed(): null {
  usePluginMessage<StandInFrame>(STAND_IN_FRAME_TYPE, setStandInStatus);
  useEffect(() => () => setStandInStatus(null), []);
  return null;
}
