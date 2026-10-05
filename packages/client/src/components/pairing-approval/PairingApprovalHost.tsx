/**
 * Mounts the pairing approval dialog for the whole app (change:
 * add-pairing-approval-dialog, design D1/D5). Mirrors `GrantPromptHost`.
 *
 * - The server broadcasts a content-free `pair_pending_changed` hint; this host
 *   refetches the operator-guarded `GET /api/pair/pending` on every hint and on
 *   every (re)connect. A browser holding a paired-device bearer skips the fetch
 *   entirely (it would only get a 401/403) and never renders a dialog.
 * - One dialog at a time, oldest first, the rest counted ("+N more waiting").
 * - Closing without answering adds the request to the per-tab dismissed set;
 *   Settings ▸ Gateway "Review" reopens it.
 * - While a grant dialog is open the pairing dialog waits (held back, NOT
 *   dismissed) and opens as soon as the grant dialog closes.
 * - An open request that disappears from the list without this tab answering
 *   closes with a "handled in another window" toast.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type GrantPromptStore, grantPromptStore } from "../../lib/access-grants/grant-prompt-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getDeviceBearer, isDevicePaired } from "../../lib/pairing/device-auth.js";
import type { PendingPairing } from "../../lib/pairing/pairing-approval-api.js";
import * as pairingApi from "../../lib/pairing/pairing-approval-api.js";
import { type PairingApprovalStore, pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { Toast, useToast } from "../primitives/Toast.js";
import { PairingApprovalDialog } from "./PairingApprovalDialog.js";

/** Approve outcomes after which the dialog no longer shows the form. */
const TERMINAL_ERRORS: ReadonlySet<string> = new Set(["locked_out", "expired", "no_pending"]);

export interface PairingApprovalHostProps {
  onMessage(handler: (msg: ServerToBrowserMessage) => void): () => void;
  /** The live socket; `null` while disconnected. A non-null change refetches. */
  ws: WebSocket | null;
  store?: PairingApprovalStore;
  grantStore?: GrantPromptStore;
  api?: Pick<typeof pairingApi, "listPending" | "approvePending" | "denyPending">;
  getBearer?: () => string | null;
}

export function PairingApprovalHost({
  onMessage,
  ws,
  store = pairingApprovalStore,
  grantStore = grantPromptStore,
  api = pairingApi,
  getBearer = getDeviceBearer,
}: PairingApprovalHostProps) {
  const { pending, dismissed, preferred } = useSyncExternalStore(store.subscribe, store.getState);
  const grantOpen = useSyncExternalStore(grantStore.subscribe, grantStore.getQueue).length > 0;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<PendingPairing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { messages, showToast, dismissToast } = useToast();
  /** Requests this tab is answering / has answered — their disappearance is expected. */
  const answered = useRef(new Set<string>());

  /** Monotonic fetch id: only the newest request may write the list, so an older
   *  response resolving late can never erase a newer pending device. */
  const fetchSeq = useRef(0);
  const refresh = useCallback(async () => {
    if (getBearer() || isDevicePaired()) return;
    const seq = ++fetchSeq.current;
    try {
      const list = await api.listPending();
      if (seq === fetchSeq.current) store.setPending(list);
    } catch {
      // Network error / 401 / 500: show nothing; the next hint or reconnect retries.
    }
  }, [api, store, getBearer]);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "pair_pending_changed") void refresh();
      }),
    [onMessage, refresh],
  );

  // Catch up on mount and on every (re)connect without waiting for a new hint.
  const mounted = useRef(false);
  useEffect(() => {
    if (ws !== null || !mounted.current) void refresh();
    mounted.current = true;
  }, [ws, refresh]);

  // `showToast` is recreated each render; read it through a ref so the
  // reconcile effect below does not re-run on every render.
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const handledElsewhere = useCallback(() => {
    setActiveId(null);
    setActiveEntry(null);
    showToastRef.current(
      i18nT("pairingApproval.handledElsewhere", undefined, "Pairing request handled in another window."),
    );
  }, []);

  // Reconcile the open dialog with the list, then pick the next one.
  useEffect(() => {
    const ids = new Set(pending.map((p) => p.pendingId));
    if (activeId !== null) {
      if (ids.has(activeId) || answered.current.has(activeId)) return;
      handledElsewhere();
      return;
    }
    const pick =
      pending.find((p) => p.pendingId === preferred && !answered.current.has(p.pendingId)) ??
      pending.find((p) => !dismissed.has(p.pendingId) && !answered.current.has(p.pendingId));
    if (pick) {
      setActiveId(pick.pendingId);
      setActiveEntry(pick);
    }
  }, [pending, dismissed, preferred, activeId, handledElsewhere]);

  // Countdown / age tick while a dialog is open.
  useEffect(() => {
    if (activeId === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeId]);

  const close = useCallback(() => {
    setActiveId(null);
    setActiveEntry(null);
  }, []);

  const toast = messages.length > 0 ? <Toast messages={messages} onDismiss={dismissToast} /> : null;
  if (activeId === null || activeEntry === null || grantOpen) return toast;

  const id = activeId;
  const queued = pending.filter(
    (p) => p.pendingId !== id && !dismissed.has(p.pendingId) && !answered.current.has(p.pendingId),
  ).length;

  return (
    <>
      <PairingApprovalDialog
        key={id}
        entry={activeEntry}
        now={now}
        queued={queued}
        onApprove={async (confirmCode, label) => {
          answered.current.add(id);
          try {
            const outcome = await api.approvePending(id, confirmCode, label);
            // Any non-terminal failure (wrong code, 401, validation…) leaves the
            // dialog in its form, so the request's disappearance is news again.
            if (!outcome.ok && !TERMINAL_ERRORS.has(outcome.error)) answered.current.delete(id);
            return outcome;
          } catch (err) {
            answered.current.delete(id);
            throw err;
          }
        }}
        onDeny={async () => {
          answered.current.add(id);
          let res: { ok: boolean; error?: string };
          try {
            res = await api.denyPending(id);
          } catch (err) {
            answered.current.delete(id);
            throw err;
          }
          if (res.ok) return close();
          if (res.error === "no_pending") return handledElsewhere();
          answered.current.delete(id);
          throw new Error(res.error ?? "deny failed");
        }}
        onDismiss={() => {
          store.dismiss(id);
          close();
        }}
        onDone={close}
        onHandledElsewhere={handledElsewhere}
      />
      {toast}
    </>
  );
}
