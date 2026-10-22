/**
 * The pair action of one server card (D8): which dialog is open, the in-flight request and the last
 * refusal note, plus the handlers that run the action for the current client.
 *
 * Browser: "Request access…" navigates a new context (noopener) to the peer's own request page and
 * "Pair with code…" opens the in-page dialog. Electron: every action goes over the main-window bridge
 * (`openServerWindow` / `pairWithCode`), so the pasted text and the credential never touch the page;
 * "Verify and request access…" opens the compare dialog first.
 *
 * See change: group-servers-by-identity (D8, tasks 7.3, 7.4).
 */
import type { PairAction, PairClient } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { useState } from "react";
import { getOpenServerWindow, getPairWithCode } from "../../lib/electron-server-windows.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { describeOpenFailure } from "../../lib/open-server-window-failure.js";

export type PairDialog = "code" | "verify" | null;
export interface PairNote {
  text: string;
  /** The refusal reason / failure code (`knock_not_lan` offers "Pair with code instead"). */
  reason: string;
}

/** Whether this client can run the action at all (Electron needs its bridge; a browser always can). */
export function isActionable(client: PairClient, action: PairAction | null): boolean {
  if (!action) return false;
  if (client === "browser") return action.kind === "request-access" ? !!action.url : true;
  return action.kind === "pair-with-code" ? !!getPairWithCode() : !!getOpenServerWindow();
}

export function usePairAction({ client, name, fingerprint }: { client: PairClient; name: string; fingerprint?: string }) {
  const [dialog, setDialog] = useState<PairDialog>(null);
  const [note, setNote] = useState<PairNote | null>(null);
  const [busy, setBusy] = useState(false);

  const viaBridge = (call: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true);
    setNote(null);
    call()
      .then((res) => {
        if (!res.ok) setNote({ text: describeOpenFailure(res.reason, name), reason: res.reason });
      })
      .catch(() => setNote({ text: describeOpenFailure("failed", name), reason: "failed" }))
      .finally(() => setBusy(false));
  };

  const startCode = () => {
    if (!fingerprint) return;
    const bridge = getPairWithCode();
    if (client === "electron" && bridge) viaBridge(() => bridge({ fingerprint }));
    else if (client === "browser") setDialog("code");
  };

  const run = (action: PairAction) => {
    setNote(null);
    if (action.kind === "pair-with-code") return startCode();
    if (action.kind === "verify-and-request") return setDialog("verify");
    const open = getOpenServerWindow();
    if (client === "electron" && open) {
      // Only host + port cross the bridge; the app proves the identity before anything is sent.
      return viaBridge(() => open({ host: action.route.host, port: action.route.port }));
    }
    // Browser: the peer's own request page in a new context; nothing is proven or sent from this page.
    if (action.url) openExternalUrl(action.url);
  };

  return { dialog, note, busy, run, startCode, closeDialog: () => setDialog(null) };
}
