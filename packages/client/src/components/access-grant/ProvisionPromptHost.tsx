/**
 * Mounts the provisioning dialog for the whole app (change:
 * add-access-provisioning, task 3.2). Sibling of `GrantPromptHost`, which owns
 * the prompt capability's lifecycle (`grant_channel`); this host only reads it.
 *
 * - `provision_request` -> queue; one dialog at a time, the rest counted.
 * - `provision_dismiss` -> remove without interaction (ended elsewhere/expired):
 *   first answer wins across tabs.
 * - An answer is sent only if the request is still open (`store.claim`), so a
 *   late local answer after a dismissal never reaches the server. Dismissal of
 *   the dialog is an answer with every line rejected.
 * - Expired requests are dropped on a slow tick, which also drives the
 *   "Expires in N min" pill.
 * - On every (re)connect, once this browser holds a capability, the queue
 *   reconciles against `GET /api/access/provision`: ended-meanwhile requests
 *   vanish, pending ones re-render. A browser without a capability is never
 *   sent the dialog, so it never reconciles one in.
 */
import type {
  BrowserToServerMessage,
  ProvisionRequestMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchProvisionRequests, provisionViewToMessage } from "../../lib/access-grants/access-prompts-api.js";
import { useHasGrantChannel } from "../../lib/access-grants/grant-channel.js";
import { type ProvisionPromptStore, provisionPromptStore } from "../../lib/access-grants/provision-prompt-store.js";
import { ProvisionPromptDialog } from "./ProvisionPromptDialog.js";

/** Expiry + pill refresh cadence while a request is open. */
const TICK_MS = 5_000;

export interface ProvisionPromptHostProps {
  onMessage(handler: (msg: ServerToBrowserMessage) => void): () => void;
  send(msg: BrowserToServerMessage): unknown;
  /** The live socket; `null` while disconnected. */
  ws: WebSocket | null;
  store?: ProvisionPromptStore;
  /** Server's pending requests; `null` = unavailable (skip reconcile). */
  loadPending?: () => Promise<ProvisionRequestMessage[] | null>;
}

async function loadPendingRequests(): Promise<ProvisionRequestMessage[] | null> {
  try {
    const res = await fetchProvisionRequests();
    if (!res.ok || !res.data) return null;
    return res.data.requests.filter((r) => r.status === "pending").map(provisionViewToMessage);
  } catch {
    return null;
  }
}

export function ProvisionPromptHost({
  onMessage,
  send,
  ws,
  store = provisionPromptStore,
  loadPending = loadPendingRequests,
}: ProvisionPromptHostProps) {
  const queue = useSyncExternalStore(store.subscribe, store.getQueue);
  const hasChannel = useHasGrantChannel();
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "provision_request" || msg.type === "provision_dismiss") {
          store.apply(msg);
          setNow(Date.now());
        }
      }),
    [onMessage, store],
  );

  // Reconnect reconcile, only while this browser can answer.
  useEffect(() => {
    if (ws === null || !hasChannel) return;
    let cancelled = false;
    const before = store.snapshotIds();
    void loadPending().then((pending) => {
      if (!cancelled && pending) store.reconcile(pending, before);
    });
    return () => {
      cancelled = true;
    };
  }, [ws, hasChannel, store, loadPending]);

  const open = queue.length > 0;
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const t = Date.now();
      store.expire(t);
      setNow(t);
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [open, store]);

  const current = queue[0];
  if (!current) return null;

  return (
    <ProvisionPromptDialog
      key={current.requestId}
      request={current}
      now={now}
      queued={queue.length - 1}
      onAnswer={(lines) => {
        if (!store.claim(current.requestId)) return;
        send({ type: "provision_response", requestId: current.requestId, lines });
      }}
    />
  );
}
