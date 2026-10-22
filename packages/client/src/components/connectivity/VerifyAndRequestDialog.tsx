/**
 * Electron "Verify and request access…" (a discovered on-link server that advertises no identity).
 *
 * Trust on first use, made explicit: the route is proven first (a fresh-nonce identity challenge,
 * nothing else is sent), the FULL fingerprint is shown for the user to compare with the one the
 * other dashboard shows under Gateway ▸ This dashboard, and only after "They match" is the
 * main-process request started (`openServerWindow({host, port})`). A refusal keeps its request-
 * landing meaning (`KNOCK_REFUSAL_COPY`); `knock_not_lan` offers "Pair with code instead".
 * A browser never mounts this dialog (a browser opens the peer's own request page instead).
 *
 * See change: group-servers-by-identity (D8, test-plan #F8).
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { Route } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { mdiAlertCircleOutline, mdiFingerprint, mdiInformationOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { OpenServerWindowFn } from "../../lib/electron-server-windows.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { describeOpenFailure } from "../../lib/open-server-window-failure.js";
import { canProveIdentity, challengeIdentity } from "../../lib/pairing/pair-protocol.js";
import { routeBaseUrl } from "../../lib/server-route-check.js";
import { callout, HELP } from "./connectivity-ui.js";

type Phase =
  | { kind: "proving" }
  | { kind: "compare"; fingerprint: string }
  | { kind: "unproven" }
  | { kind: "requesting"; fingerprint: string }
  | { kind: "refused"; reason: string };

export interface VerifyAndRequestDialogProps {
  name: string;
  route: Pick<Route, "host" | "port" | "scheme">;
  /** The main-window bridge call that starts the knock for `host:port`. */
  openServerWindow: OpenServerWindowFn;
  /** Offered after a `knock_not_lan` refusal; closes this dialog first. */
  onPairWithCode?: () => void;
  onClose: () => void;
}

export function VerifyAndRequestDialog({ name, route, openServerWindow, onPairWithCode, onClose }: VerifyAndRequestDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "proving" });
  const { host, port, scheme } = route;

  // Prove once on open. Nothing but the challenge is sent until the user confirms.
  useEffect(() => {
    let cancelled = false;
    const done = (p: Phase) => {
      if (!cancelled) setPhase(p);
    };
    if (!canProveIdentity()) {
      done({ kind: "unproven" });
      return;
    }
    challengeIdentity(routeBaseUrl({ host, port, scheme }))
      .then((proof) => done(proof.verified ? { kind: "compare", fingerprint: proof.fingerprint } : { kind: "unproven" }))
      .catch(() => done({ kind: "unproven" }));
    return () => {
      cancelled = true;
    };
  }, [host, port, scheme]);

  const request = (fingerprint: string) => {
    setPhase({ kind: "requesting", fingerprint });
    openServerWindow({ host, port })
      .then((res) => (res.ok ? onClose() : setPhase({ kind: "refused", reason: res.reason })))
      .catch(() => setPhase({ kind: "refused", reason: "failed" }));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={i18nT("connection.verify.title", { name }, "Request access to {name}")}
      icon={mdiFingerprint}
      size="md"
      testId="verify-and-request-dialog"
    >
      {phase.kind === "proving" && (
        <div className={`${HELP} flex items-center gap-1.5`} role="status">
          <Icon path={mdiLoading} size={0.6} className="animate-spin" aria-hidden="true" />
          {i18nT("connection.verify.proving", undefined, "Checking the server's identity…")}
        </div>
      )}

      {(phase.kind === "compare" || phase.kind === "requesting") && (
        <div className="space-y-3">
          <div className={callout("warning")}>
            <Icon path={mdiInformationOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {i18nT(
                "connection.verify.compare",
                { name },
                "{name} doesn't advertise its identity. Compare this fingerprint with the one shown on {name} under Gateway ▸ This dashboard before you send.",
              )}
            </div>
          </div>
          <code
            data-testid="verify-fingerprint"
            className="block break-all rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] select-all"
          >
            {phase.fingerprint}
          </code>
        </div>
      )}

      {phase.kind === "unproven" && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {i18nT("connection.verify.unproven", { name }, "{name} did not prove who it is, so no request was sent.")}
          </div>
        </div>
      )}

      {phase.kind === "refused" && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <strong>{i18nT("connection.verify.refused", undefined, "Request not sent.")}</strong> {describeOpenFailure(phase.reason, name)}
          </div>
        </div>
      )}

      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose}>{phase.kind === "refused" ? i18nT("common.close", undefined, "Close") : i18nT("common.cancel", undefined, "Cancel")}</Dialog.Cancel>
        {phase.kind === "refused" && phase.reason === "knock_not_lan" && onPairWithCode && (
          <Dialog.Action
            onClick={() => {
              onClose();
              onPairWithCode();
            }}
            testId="verify-pair-with-code"
          >
            {i18nT("connection.pair.withCodeInstead", undefined, "Pair with code instead")}
          </Dialog.Action>
        )}
        {(phase.kind === "compare" || phase.kind === "requesting") && (
          <Dialog.Action onClick={() => request(phase.fingerprint)} disabled={phase.kind === "requesting"} testId="verify-confirm">
            {i18nT("connection.verify.confirm", undefined, "They match — request access")}
          </Dialog.Action>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
