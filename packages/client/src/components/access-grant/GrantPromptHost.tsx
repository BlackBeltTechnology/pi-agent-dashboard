/**
 * Mounts the access-grant dialog for the whole app (change:
 * add-access-grant-dialog, tasks 7.1-7.3).
 *
 * - `grant_channel`  -> hold the capability in memory (`setGrantChannel`);
 *   the socket closing (`ws === null`) clears it.
 * - `grant_request`  -> queue; one dialog at a time, the rest counted.
 * - `grant_dismiss`  -> remove without interaction (settled elsewhere/expired).
 * - An answer is sent only if the prompt is still open (`store.claim`), so a
 *   late local answer after a dismissal never reaches the server.
 * - Expired prompts are dropped on a 1 s tick, which also drives the countdown.
 * - On every (re)connect the queue reconciles against `GET /api/access/prompts`
 *   (prompted entries only): settled-meanwhile prompts vanish, pending ones
 *   re-render.
 */
import type {
  BrowserToServerMessage,
  GrantRequestMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchAccessPrompts } from "../../lib/access-grants/access-prompts-api.js";
import { clearGrantChannel, setGrantChannel } from "../../lib/access-grants/grant-channel.js";
import { type GrantPromptStore, grantPromptStore } from "../../lib/access-grants/grant-prompt-store.js";
import { GrantPromptDialog } from "./GrantPromptDialog.js";

export interface GrantPromptHostProps {
  onMessage(handler: (msg: ServerToBrowserMessage) => void): () => void;
  send(msg: BrowserToServerMessage): unknown;
  /** The live socket; `null` while disconnected. */
  ws: WebSocket | null;
  store?: GrantPromptStore;
  /** Server's prompted pending entries; `null` = unavailable (skip reconcile). */
  loadPending?: () => Promise<GrantRequestMessage[] | null>;
}

/** Prompted pending entries from the Access API, as `grant_request` frames. */
async function loadPromptedPending(): Promise<GrantRequestMessage[] | null> {
  try {
    const res = await fetchAccessPrompts();
    if (!res.ok || !res.data) return null;
    return res.data.pending
      .filter((p) => p.prompted)
      .map((p) => ({
        type: "grant_request",
        promptId: p.promptId,
        plane: p.plane,
        subject: p.subject,
        expiresAt: p.expiresAt,
        copy: p.copy,
      }));
  } catch {
    return null;
  }
}

export function GrantPromptHost({
  onMessage,
  send,
  ws,
  store = grantPromptStore,
  loadPending = loadPromptedPending,
}: GrantPromptHostProps) {
  const queue = useSyncExternalStore(store.subscribe, store.getQueue);
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "grant_channel") setGrantChannel(msg.capability);
        else if (msg.type === "grant_request" || msg.type === "grant_dismiss") {
          store.apply(msg);
          setNow(Date.now());
        }
      }),
    [onMessage, store],
  );

  // Capability lifecycle + reconnect reconcile.
  useEffect(() => {
    if (ws === null) {
      clearGrantChannel();
      return;
    }
    let cancelled = false;
    const before = store.snapshotIds();
    void loadPending().then((pending) => {
      if (!cancelled && pending) store.reconcile(pending, before);
    });
    return () => {
      cancelled = true;
    };
  }, [ws, store, loadPending]);

  // Countdown tick + expiry, only while something is open.
  const open = queue.length > 0;
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const t = Date.now();
      store.expire(t);
      setNow(t);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, store]);

  const current = queue[0];
  if (!current) return null;

  return (
    <GrantPromptDialog
      key={current.promptId}
      prompt={current}
      now={now}
      queued={queue.length - 1}
      onAnswer={(verdict, subject) => {
        if (!store.claim(current.promptId)) return;
        send({ type: "grant_response", promptId: current.promptId, plane: current.plane, subject, verdict });
      }}
    />
  );
}
