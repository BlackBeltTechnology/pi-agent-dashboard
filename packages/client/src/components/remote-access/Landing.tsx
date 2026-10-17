/**
 * Status landing — "who can reach this machine right now" — then four task
 * entries. State is always text (never colour alone); a source that has not
 * loaded reads "Checking…", a failed one "unknown" with a retry — never a
 * default such as "Off".
 *
 * See change: add-remote-access-wizard.
 */
import { mdiAccessPointNetwork, mdiCellphoneLink, mdiMonitorShare, mdiWeb, mdiWifi } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { listPairedDevices } from "../../lib/pairing/paired-devices-api.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { disconnectGateway } from "../../lib/remote-access/ra-api.js";
import {
  type LanRoad,
  roads,
  type Snapshot,
  type TaskHint,
  type TaskId,
  taskHint,
  unauthenticatedNetworkCount,
} from "../../lib/remote-access/steps.js";
import type { RemoteAccessSnapshot } from "../../lib/remote-access/use-remote-access-snapshot.js";
import { severityPill } from "../connectivity/connectivity-ui.js";
import { Callout, REFUSED_FALLBACK, SmallButton, UnknownNote } from "./ra-ui.js";

const TASKS: { id: TaskId; icon: string }[] = [
  { id: "share", icon: mdiWeb },
  { id: "device", icon: mdiCellphoneLink },
  { id: "lan", icon: mdiWifi },
  { id: "connect", icon: mdiMonitorShare },
];

function RoadRow({ testId, label, children }: { testId: string; label: string; children: React.ReactNode }) {
  return (
    <li data-testid={testId} className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
      <span className="min-w-[9rem] font-semibold text-[var(--text-primary)]">{label}</span>
      <span className="min-w-0 flex-1 text-[var(--text-secondary)]">{children}</span>
    </li>
  );
}

function LanState({ lan, retry }: { lan: LanRoad; retry: () => void }) {
  const { t } = useI18n();
  if (lan.state === "loading") return <UnknownNote pending="loading" />;
  if (lan.state === "unknown") return <UnknownNote pending="error" onRetry={retry} />;
  const word =
    lan.state === "on"
      ? t("remoteAccess.state.on", undefined, "On")
      : lan.state === "listening"
        ? t("remoteAccess.lan.listeningOff", undefined, "Listening, but requests are off")
        : lan.state === "restart-pending"
          ? t("remoteAccess.lan.restartPending", undefined, "Restart pending")
          : t("remoteAccess.state.off", undefined, "Off");
  return (
    <span data-testid="remote-access-road-lan-state">
      <span className={severityPill(lan.state === "on" ? "success" : "neutral")}>{word}</span>
      {(lan.state === "on" || lan.state === "listening") && lan.bind ? <span className="ml-2">{lan.bind}</span> : null}
    </span>
  );
}

function hintText(hint: TaskHint, t: ReturnType<typeof useI18n>["t"]): string {
  if (hint.kind === "loading") return t("remoteAccess.checking", undefined, "Checking…");
  if (hint.kind === "ready") return t("remoteAccess.hint.ready", undefined, "Ready");
  return hint.n === 1
    ? t("remoteAccess.hint.step1", undefined, "1 step")
    : t("remoteAccess.hint.steps", { n: String(hint.n) }, `${hint.n} steps`);
}

export function taskTitle(id: TaskId, t: ReturnType<typeof useI18n>["t"]): string {
  switch (id) {
    case "share":
      return t("remoteAccess.task.share", undefined, "Share over the internet");
    case "device":
      return t("remoteAccess.task.device", undefined, "Let a phone or laptop in");
    case "lan":
      return t("remoteAccess.task.lan", undefined, "Allow devices on my network");
    case "connect":
      return t("remoteAccess.task.connect", undefined, "Connect to another machine");
  }
}

function taskBlurb(id: TaskId, t: ReturnType<typeof useI18n>["t"]): string {
  switch (id) {
    case "share":
      return t("remoteAccess.task.shareHint", undefined, "A public HTTPS address for this dashboard, reachable from anywhere.");
    case "device":
      return t("remoteAccess.task.deviceHint", undefined, "Pair a device with a QR code and a one-time code.");
    case "lan":
      return t("remoteAccess.task.lanHint", undefined, "Phones and laptops on the same Wi-Fi can ask to connect.");
    case "connect":
      return t("remoteAccess.task.connectHint", undefined, "Use another computer's dashboard from here.");
  }
}

export function Landing({
  snap,
  ra,
  onStart,
  onClose,
  navigate,
  setError,
}: {
  snap: Snapshot;
  ra: RemoteAccessSnapshot;
  onStart: (task: TaskId) => void;
  onClose: () => void;
  navigate: (path: string) => void;
  setError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const r = roads(snap);
  const pending = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState).pending;
  const [paired, setPaired] = useState<number | "loading" | "error">("loading");
  const open = unauthenticatedNetworkCount(snap);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listPairedDevices().then(
      (d) => alive && setPaired(d.length),
      () => alive && setPaired("error"),
    );
    return () => {
      alive = false;
    };
  }, []);

  const disconnect = async () => {
    setBusy(true);
    const res = await disconnectGateway();
    setBusy(false);
    if (!res.ok) setError(res.kind === "refused" ? t("remoteAccess.err.refused", undefined, REFUSED_FALLBACK) : res.message);
    else setError(null);
    await ra.refresh();
  };

  const settings = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="space-y-4" data-testid="remote-access-landing">
      <ul className="space-y-1.5" aria-label={t("remoteAccess.roads", undefined, "Who can reach this machine")}>
        <RoadRow testId="remote-access-road-local" label={t("remoteAccess.road.local", undefined, "This computer")}>
          <span className={severityPill("success")}>{t("remoteAccess.state.on", undefined, "On")}</span>
        </RoadRow>
        <RoadRow testId="remote-access-road-lan" label={t("remoteAccess.road.lan", undefined, "Devices on my network")}>
          <LanState lan={r.lan} retry={() => void ra.refresh()} />
        </RoadRow>
        <RoadRow testId="remote-access-road-internet" label={t("remoteAccess.road.internet", undefined, "Internet")}>
          {r.internet.state === "loading" ? (
            <UnknownNote pending="loading" />
          ) : r.internet.state === "unknown" ? (
            <UnknownNote pending="error" onRetry={() => void ra.refresh()} />
          ) : r.internet.state === "off" ? (
            <span className={severityPill("neutral")}>{t("remoteAccess.state.off", undefined, "Off")}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className={severityPill("success")}>{t("remoteAccess.state.on", undefined, "On")}</span>
              {r.internet.address && <span data-testid="remote-access-internet-address" className="break-all font-mono">{r.internet.address}</span>}
              {r.internet.private && (
                <span data-testid="remote-access-internet-private">
                  {t("remoteAccess.internet.private", undefined, "Reachable only from that private network.")}
                </span>
              )}
              <SmallButton testId="remote-access-disconnect" onClick={() => void disconnect()} disabled={busy}>
                {t("remoteAccess.disconnect", undefined, "Disconnect")}
              </SmallButton>
            </span>
          )}
        </RoadRow>
      </ul>

      <p className="text-xs text-[var(--text-secondary)]" data-testid="remote-access-paired">
        {paired === "loading" ? (
          <UnknownNote pending="loading" />
        ) : paired === "error" ? (
          <UnknownNote pending="error" />
        ) : (
          t(
            "remoteAccess.paired",
            { n: String(paired) },
            paired === 1 ? "1 paired device" : `${paired} paired devices`,
          )
        )}{" "}
        <button type="button" data-testid="remote-access-manage-devices" className="underline" onClick={() => settings("/settings/security")}>
          {t("remoteAccess.manageDevices", undefined, "Manage")}
        </button>
      </p>

      {pending.length > 0 && (
        <Callout severity="info" testId="remote-access-waiting">
          {pending.length === 1
            ? t("remoteAccess.waiting1", undefined, "1 device is waiting to connect.")
            : t("remoteAccess.waitingN", { n: String(pending.length) }, `${pending.length} devices are waiting to connect.`)}{" "}
          <button
            type="button"
            data-testid="remote-access-review"
            className="font-semibold underline"
            onClick={() => pairingApprovalStore.review(pending[0].pendingId)}
          >
            {t("gateway.pair.review", undefined, "Review")}
          </button>
        </Callout>
      )}

      {open !== null && open > 0 && (
        <Callout severity="warning" testId="remote-access-open-warning">
          {t(
            "remoteAccess.openWarning",
            { n: String(open) },
            `${open} network(s) other than this computer are admitted without signing in.`,
          )}{" "}
          <button type="button" data-testid="remote-access-open-warning-link" className="underline" onClick={() => settings("/settings/security")}>
            {t("remoteAccess.door.openSecurity", undefined, "Open Security settings")}
          </button>
        </Callout>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        {TASKS.map(({ id, icon }) => (
          <li key={id}>
            <button
              type="button"
              data-testid={`remote-access-task-${id}`}
              onClick={() => onStart(id)}
              className="flex h-full w-full items-start gap-2.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-left hover:bg-[var(--bg-tertiary)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]">
                <Icon path={icon} size={0.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{taskTitle(id, t)}</span>
                <span className="block text-xs text-[var(--text-secondary)]">{taskBlurb(id, t)}</span>
              </span>
              <span className={severityPill(taskHint(id, snap).kind === "ready" ? "success" : "neutral", true)} data-testid={`remote-access-task-${id}-hint`}>
                {hintText(taskHint(id, snap), t)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-xs">
        <button type="button" data-testid="remote-access-all-settings" className="inline-flex items-center gap-1 underline text-[var(--text-secondary)]" onClick={() => settings("/settings/gateway")}>
          <Icon path={mdiAccessPointNetwork} size={0.55} aria-hidden="true" />
          {t("remoteAccess.allSettings", undefined, "All network settings")}
        </button>
      </p>
    </div>
  );
}
