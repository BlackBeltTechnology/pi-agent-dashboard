import type { TunnelStatus, TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiAccessPointNetwork } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ToastVariant } from "../../hooks/useAsyncAction.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { getTunnelStatusDetail } from "../../lib/gateway/gateway-api.js";
import { type RemoteAccessTone, remoteAccessIndicator } from "../../lib/gateway/gateway-connection.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { useLiveReachability } from "../../lib/remote-access/reachability-store.js";
import { hasStoredRun, takeFreshRun } from "../../lib/remote-access/run-store.js";
import type { RunState } from "../../lib/remote-access/steps.js";
import { logRejection } from "../../lib/report-error.js";

// The dialog (wizard, step bodies, QR) stays off the entry chunk: it loads on first click.
const RemoteAccessDialog = lazy(() =>
  import("../remote-access/RemoteAccessDialog.js").then((m) => ({ default: m.RemoteAccessDialog })),
);

const POLL_INTERVAL = 30_000;

/** State dot — colour is decoration; the same state is in the title and accessible name. */
const DOT: Record<RemoteAccessTone, string> = {
  failed: "var(--status-error)",
  partial: "var(--status-working)",
  internet: "var(--status-idle)",
  network: "var(--accent-primary)",
  local: "var(--text-tertiary)",
};

/**
 * Toolbar **Remote access** button: network glyph + a state dot (this computer
 * only / network / internet / partial / failed) + a waiting-request badge.
 * Click always opens the Remote access dialog on its status landing.
 *
 * Network state comes from the `reachability_updated` broadcast (no polling of
 * the guarded config); waiting requests come from the app-wide pairing approval
 * state. A run saved before a Listen-on-network restart reopens the dialog when
 * the server comes back (design D4).
 *
 * See change: add-remote-access-wizard.
 */
export function TunnelButton(_props: { showToast?: (text: string, variant?: ToastVariant) => void } = {}) {
  const [status, setStatus] = useState<TunnelStatus | TunnelStatusDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialRun, setInitialRun] = useState<RunState | null>(null);
  const live = useLiveReachability();
  const pending = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState).pending.length;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/tunnel-status`);
      if (res.ok) {
        const data = (await res.json()) as TunnelStatus;
        // The ungated counts cannot tell a failed provider from an idle one; the
        // gated twin can (null for a browser without access — harmless).
        const detail = data.gateway && data.gateway.expected > 0 ? await getTunnelStatusDetail().catch(() => null) : null;
        setStatus(detail?.providers ? { ...data, providers: detail.providers } : data);
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  useEffect(() => {
    void fetchStatus().catch(logRejection("TunnelButton.fetchStatus"));
    const id = setInterval(() => { void fetchStatus().catch(logRejection("TunnelButton.poll")); }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Resume a run saved by Listen on network: on mount (page reload) and when the
  // server's RESOLVED bind host changes (it only does so across a restart — a
  // save alone moves `pendingBindHost`). The key is always removed when read.
  const resolved = live?.resolvedBindHost ?? null;
  const lastResolved = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const first = lastResolved.current === undefined;
    const changed = !first && lastResolved.current !== resolved;
    lastResolved.current = resolved;
    if (!(first || changed) || !hasStoredRun()) return;
    const run = takeFreshRun();
    if (run) {
      setInitialRun(run);
      setDialogOpen(true);
    }
  }, [resolved]);

  const handleClick = useCallback(async () => {
    await fetchStatus();
    setInitialRun(null);
    setDialogOpen(true);
  }, [fetchStatus]);

  const { tone, title } = remoteAccessIndicator(status, resolved, pending);
  const glyph =
    tone === "failed" || tone === "partial" || tone === "internet"
      ? "text-[var(--text-primary)]"
      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`relative inline-flex ${glyph}`}
        title={title}
        aria-label={title}
        data-testid="tunnel-btn"
        data-tone={tone}
      >
        <Icon path={mdiAccessPointNetwork} size={0.6} />
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-[var(--bg-primary)]"
          style={{ background: DOT[tone] }}
        />
        {pending > 0 && (
          <span
            data-testid="tunnel-btn-badge"
            className="absolute -right-2 -top-1.5 min-w-[14px] rounded-full bg-[var(--accent-solid)] px-1 text-center text-[9px] font-bold leading-[14px] text-white"
          >
            {pending}
          </span>
        )}
      </button>
      {dialogOpen && (
        <Suspense fallback={null}>
          <RemoteAccessDialog initialRun={initialRun} onClose={() => setDialogOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
