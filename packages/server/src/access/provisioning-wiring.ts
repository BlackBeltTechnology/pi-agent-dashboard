/**
 * Wires the pure provisioning registry to the browser gateway (change:
 * add-access-provisioning, design D2/D3/D14; task 2.4).
 *
 * - Delivery: `provision_request` goes ONLY to operator sockets (live capability
 *   AND operate tier) via `sendToOperators`, never `broadcastToAll`. The ladder's
 *   `operatorCount` is the same set.
 * - Settlement: `onResponse` (the `provision_response` handler) drops (and counts) a message
 *   whose SENDING socket holds no live capability; a capability held by another
 *   socket never authorises it. A socket below operate tier is dropped too (the
 *   gateway's tier gate normally refuses it first).
 * - Terminal transitions: every one (settled / dismissed / expired) sends
 *   `provision_dismiss` to the operator sockets so other tabs close the dialog.
 * - Expiry: one unref'd timer per request calls `registry.expire()`; it is
 *   cleared on any terminal transition, so no timer outlives its request.
 *
 * Kept out of `server.ts` so the same wiring is exercised against a real gateway.
 */
import type { ProvisionResponseMessage, ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";
import {
  type ProvisioningDeps,
  ProvisioningRegistry,
  type ProvisionRequestView,
  toProvisionRequestMessage,
} from "./provisioning.js";

/** The slice of `BrowserGateway` the wiring needs. */
interface ProvisioningGatewayPort {
  holdsLiveCapability(ws: WebSocket): boolean;
  isOperatorSocket(ws: WebSocket): boolean;
  operatorSocketCount(): number;
  sendToOperators(msg: ServerToBrowserMessage): number;
}

export interface InstallProvisioningOptions {
  gateway: ProvisioningGatewayPort;
  /** Registry deps; `operatorCount` and `onTerminal` are supplied here. */
  deps: Omit<ProvisioningDeps, "ladder" | "onTerminal"> & {
    ladder: Omit<ProvisioningDeps["ladder"], "operatorCount">;
  };
}

export interface InstalledProvisioning {
  registry: ProvisioningRegistry;
  /**
   * The `provision_response` handler. Registered by `server.ts` itself
   * (`registerHandler("provision_response", …)`): the bus-client verb-completeness
   * test finds receivers by scanning that literal call.
   */
  onResponse(msg: ProvisionResponseMessage, ws: WebSocket): void;
  /** Send a freshly created request to the operator sockets and arm its expiry timer. */
  announce(request: ProvisionRequestView): void;
  /** Clear every pending expiry timer (shutdown, tests). */
  dispose(): void;
}

export function installProvisioning({ gateway, deps }: InstallProvisioningOptions): InstalledProvisioning {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const clear = (id: string): void => {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
  };

  /** Expire at `expiresAt`; a timer that fires a tick early re-arms instead of leaving the request lingering. */
  const arm = (id: string, expiresAt: number): void => {
    const timer = setTimeout(() => {
      timers.delete(id);
      if (registry.get(id)?.status === "pending") arm(id, expiresAt); // `get` sweeps expired requests first
    }, Math.max(1, expiresAt - deps.now()));
    timer.unref();
    timers.set(id, timer);
  };

  const registry: ProvisioningRegistry = new ProvisioningRegistry({
    ...deps,
    ladder: { ...deps.ladder, operatorCount: () => gateway.operatorSocketCount() },
    onTerminal: (requestId, reason) => {
      clear(requestId);
      gateway.sendToOperators({
        type: "provision_dismiss",
        requestId,
        reason: reason === "settled" ? "settled" : reason === "expired" ? "expired" : "dismissed",
      });
    },
  });

  const onResponse = (msg: ProvisionResponseMessage, ws: WebSocket): void => {
    if (!gateway.holdsLiveCapability(ws)) {
      registry.recordDroppedResponse();
      return;
    }
    if (!gateway.isOperatorSocket(ws)) return;
    registry.settle(msg.requestId, { lines: msg.lines }).catch((err: unknown) => {
      console.error(`[access-provision] settle failed: ${(err as Error)?.message ?? err}`);
    });
  };

  return {
    registry,
    onResponse,
    announce(request) {
      gateway.sendToOperators(toProvisionRequestMessage(request, deps.now()));
      clear(request.requestId);
      arm(request.requestId, request.expiresAt);
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
