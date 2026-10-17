/**
 * Step bodies for the share / lan / device tasks. Each reuses the section
 * components the Settings ▸ Network ▸ Gateway page composes — wizard and
 * settings cannot drift — and states its exposure consequence BEFORE its
 * primary action (design D5, spec "Exposure consequence is stated before the
 * action").
 *
 * See change: add-remote-access-wizard.
 */
import type { TunnelMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { disconnectTunnel } from "../../lib/gateway/gateway-api.js";
import type { GatewayProviderId } from "../../lib/gateway/gateway-providers.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { listPairedDevices } from "../../lib/pairing/paired-devices-api.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { type ActionResult, restartServer, writeConfig } from "../../lib/remote-access/ra-api.js";
import { clearRun, saveRun } from "../../lib/remote-access/run-store.js";
import {
  type ApproveOutcome,
  approveOutcome,
  bindInfo,
  deviceEndpoint,
  endpointTransport,
  evaluate,
  isLoopbackHost,
  openEntries,
} from "../../lib/remote-access/steps.js";
import { copyText } from "../../lib/util/clipboard.js";
import { BTN_SMALL, HELP } from "../connectivity/connectivity-ui.js";
import { GatewayConnectToggle } from "../Gateway/GatewayConnectToggle.js";
import { LanRequestPanel } from "../Gateway/GatewayLanRequestPanel.js";
import { GatewayPairQR, QrCanvas } from "../Gateway/GatewayPairQR.js";
import { GatewayProviderSection } from "../Gateway/GatewayProviderSection.js";
import { GatewayReadinessBoard } from "../Gateway/GatewayReadinessBoard.js";
import { GatewayDegradedBanner, GatewayReservedName } from "../Gateway/GatewayReservedName.js";
import { GatewaySetupSteps } from "../Gateway/GatewaySetupGuide.js";
import { WaitingDevices } from "../Gateway/WaitingDevices.js";
import type { StepCtx } from "./ra-context.js";
import { Callout, PrimaryButton, REFUSED_FALLBACK, SmallButton, UnknownNote } from "./ra-ui.js";

/** Map a typed write outcome onto the dialog error region; returns true when it succeeded. */
function useOutcome(ctx: StepCtx) {
  const { t } = useI18n();
  return (r: ActionResult): boolean => {
    if (r.ok) {
      ctx.setError(null);
      return true;
    }
    ctx.setError(
      r.kind === "refused" ? t("remoteAccess.err.refused", undefined, REFUSED_FALLBACK) : r.message,
    );
    return false;
  };
}

const cfgOf = (ctx: StepCtx) => (ctx.snap.config.status === "value" ? ctx.snap.config.value : undefined);

// ── Choose provider ──────────────────────────────────────────────────

export function ProviderBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const report = useOutcome(ctx);
  const cfg = cfgOf(ctx);
  const stored = cfg?.tunnel?.provider as GatewayProviderId | undefined;
  const storedMode = (cfg?.tunnel?.mode as TunnelMode | undefined) ?? "public";
  const [provider, setProvider] = useState<GatewayProviderId>(stored ?? "zrok");
  const [mode, setMode] = useState<TunnelMode>(storedMode);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const connectedPrimary =
    !!stored &&
    ctx.snap.status.status === "value" &&
    (ctx.snap.status.value.connectedProviders ?? []).includes(stored);
  const needsWrite = stored === undefined || provider !== stored || mode !== storedMode;

  const next = async () => {
    // A connected primary is never switched from here (Make primary stays in Settings).
    if (connectedPrimary && provider !== stored) {
      setBlocked(true);
      return;
    }
    if (needsWrite) {
      setBusy(true);
      const ok = report(await writeConfig({ tunnel: { provider, mode } }));
      setBusy(false);
      if (!ok) return;
      await ctx.refresh();
    }
    ctx.complete("provider");
  };

  return (
    <div className="space-y-3">
      <GatewayReadinessBoard
        active
        poll={ctx.ra.poll}
        showProviderActions={false}
        primary={provider}
        onSelectProvider={(id) => {
          setBlocked(false);
          setProvider(id as GatewayProviderId);
        }}
      />
      <GatewayProviderSection
        provider={provider}
        mode={mode}
        disabled={busy}
        onChange={({ provider: p, mode: m }) => {
          setBlocked(false);
          setProvider(p);
          setMode(m);
        }}
      />
      {blocked && (
        <Callout severity="info" testId="remote-access-provider-blocked">
          {t(
            "remoteAccess.provider.connectedPrimary",
            { provider: stored ?? "" },
            `${stored} is connected, so it stays the primary. Disconnect it first, or connect the other provider and make it primary in the Gateway settings.`,
          )}{" "}
          <button
            type="button"
            data-testid="remote-access-provider-settings-link"
            className="underline"
            onClick={() => {
              ctx.close();
              ctx.navigate("/settings/gateway");
            }}
          >
            {t("remoteAccess.openGatewaySettings", undefined, "Open Gateway settings")}
          </button>
        </Callout>
      )}
      <PrimaryButton testId={needsWrite ? "gateway-save" : "remote-access-continue"} onClick={() => void next()} disabled={busy}>
        {busy ? t("gateway.saving", undefined, "Saving…") : needsWrite ? t("gateway.save", undefined, "Save") : t("remoteAccess.continue", undefined, "Continue")}
      </PrimaryButton>
    </div>
  );
}

// ── Install / Enable ─────────────────────────────────────────────────

export function ProviderSetupBody({ ctx, part }: { ctx: StepCtx; part: "install" | "enable" }) {
  const { t } = useI18n();
  const provider = (cfgOf(ctx)?.tunnel?.provider ?? "zrok") as GatewayProviderId;
  return (
    <div className="space-y-3">
      <GatewaySetupSteps provider={provider} part={part} />
      <p className={HELP}>
        {part === "install"
          ? t("remoteAccess.install.help", undefined, "Run the command in a terminal. This step completes by itself once the client is detected.")
          : t("remoteAccess.enable.help", undefined, "This step completes by itself once the provider reports it is set up.")}
      </p>
      <SmallButton testId="remote-access-recheck" onClick={() => void ctx.ra.poll.tick()} disabled={ctx.ra.poll.inFlight}>
        {t("remoteAccess.recheck", undefined, "Check again")}
      </SmallButton>
    </div>
  );
}

// ── Public address (zrok) ────────────────────────────────────────────

export function AddressBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const report = useOutcome(ctx);
  const cfg = cfgOf(ctx);
  const name = cfg?.tunnel?.zrok?.reservedName;
  const status = ctx.snap.status.status === "value" ? ctx.snap.status.value : undefined;
  const degraded = status?.status === "active" ? status.degraded : undefined;

  const temporary = async () => {
    if (report(await writeConfig({ tunnel: { zrok: { persistent: false } } }))) {
      await ctx.refresh();
      ctx.complete("address");
    }
  };

  return (
    <div className="space-y-3">
      <GatewayDegradedBanner degraded={degraded} />
      <GatewayReservedName stored={name} onStoredChange={() => void ctx.refresh()} />
      <div className="flex flex-wrap items-center gap-2">
        <SmallButton testId="remote-access-temporary-address" onClick={() => void temporary()}>
          {t("remoteAccess.address.temporary", undefined, "Use a temporary address")}
        </SmallButton>
        {/* Releasing a reserved name is IRREVERSIBLE — the name returns to zrok's pool. Confirm-gated. */}
        {name && (
          <button
            type="button"
            data-testid="gateway-forget-reserved"
            className={BTN_SMALL}
            onClick={() => {
              const url = `https://${name}.shares.zrok.io`;
              if (
                !globalThis.confirm?.(
                  t(
                    "gateway.confirmRelease",
                    { url },
                    `Release ${url}? The name returns to zrok's global pool and anyone may claim it. Anyone you shared that URL with will no longer reach this dashboard.`,
                  ),
                )
              )
                return;
              void disconnectTunnel({ forget: true })
                .then(() => ctx.refresh())
                .catch((e) => ctx.setError(e instanceof Error ? e.message : t("gateway.err.disconnectFailed", undefined, "disconnect failed")));
            }}
          >
            {t("gateway.releaseReserved", undefined, "Release reserved URL")}
          </button>
        )}
      </div>
      <p className={HELP}>
        {t("remoteAccess.address.help", undefined, "A temporary address changes every time you go online. A reserved name keeps the same address.")}
      </p>
    </div>
  );
}

// ── Go online ────────────────────────────────────────────────────────

export function ConnectBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <Callout severity="info" testId="remote-access-connect-consequence">
        <b>{t("remoteAccess.connect.consequenceLead", undefined, "Anyone with the address reaches a sign-in / request-access page.")}</b>{" "}
        {t("remoteAccess.connect.consequenceTail", undefined, "Nobody gets in until you approve their device or they sign in.")}
      </Callout>
      <GatewayConnectToggle onChanged={() => void ctx.refresh()} />
    </div>
  );
}

// ── Listen on network ────────────────────────────────────────────────

const PINNED_SOURCES = new Set(["flag", "env"]);

export function BindBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const report = useOutcome(ctx);
  const [phase, setPhase] = useState<"idle" | "saving" | "restarting">("idle");
  const [restartFailed, setRestartFailed] = useState(false);
  const cfg = cfgOf(ctx);
  const info = bindInfo(ctx.snap);
  const source = cfg?.reachability?.bindHostSource ?? ctx.snap.live?.bindHostSource;
  const pinned = source !== undefined && PINNED_SOURCES.has(source);
  const open = cfg ? openEntries(cfg) : [];
  const saved = info.status === "value" && isLoopbackHost(info.value.resolved) && !isLoopbackHost(info.value.pending);
  const restartPending = saved || restartFailed;

  const restart = async () => {
    setPhase("restarting");
    // The restart IS what completes this step: persist it as done so the
    // resumed dialog reads "done", not "already set".
    saveRun({ ...ctx.run, done: ctx.run.done.includes("bind") ? ctx.run.done : [...ctx.run.done, "bind"] });
    const r = await restartServer();
    if (!r.ok) {
      // The config already holds 0.0.0.0; nothing may resume later.
      clearRun();
      setRestartFailed(true);
      setPhase("idle");
      report(r);
    }
  };

  const listen = async () => {
    setPhase("saving");
    // Binding 0.0.0.0 (not one NIC) keeps this computer's own localhost origin
    // working, so the post-restart reconnect — and local self-probes — still land.
    if (!report(await writeConfig({ bindHost: "0.0.0.0" }))) {
      setPhase("idle");
      return;
    }
    await restart();
  };

  if (info.status !== "value") return <UnknownNote pending={info.status === "loading" ? "loading" : "error"} onRetry={() => void ctx.refresh()} />;

  if (pinned) {
    const host = info.value.pending;
    return (
      <Callout severity="info" testId="remote-access-bind-pinned">
        {source === "env"
          ? t("remoteAccess.bind.pinnedEnv", { host }, `PI_DASHBOARD_HOST sets the bind host to ${host}. Change that variable and restart the server to listen on the network.`)
          : t("remoteAccess.bind.pinnedFlag", { host }, `A command-line flag (--host) sets the bind host to ${host}. Restart the server without it to listen on the network.`)}
      </Callout>
    );
  }

  return (
    <div className="space-y-3">
      <Callout severity="warning" testId="remote-access-bind-consequence">
        <b>
          {t(
            "remoteAccess.bind.consequenceAll",
            undefined,
            "The dashboard becomes reachable on every network this computer is connected to, including VPNs.",
          )}
        </b>{" "}
        {t(
          "remoteAccess.bind.consequenceHttp",
          undefined,
          "Devices there can open the request page over plain http (unencrypted). They still can't get in without your approval.",
        )}{" "}
        {t("remoteAccess.bind.consequenceRestart", undefined, "The server restarts.")}
        {open.length > 0 && (
          <>
            {" "}
            {t(
              "remoteAccess.bind.consequenceOpen",
              { n: String(open.length), list: open.join(", ") },
              `${open.length} network(s) are admitted without signing in (${open.join(", ")}): devices on them get full access without sign-in once the server listens.`,
            )}
          </>
        )}
      </Callout>
      {restartPending && (
        <p className="text-xs text-[var(--text-secondary)]" data-testid="remote-access-restart-pending">
          {t("remoteAccess.bind.restartPending", undefined, "Saved — restart pending.")}
        </p>
      )}
      {phase === "restarting" ? (
        <p role="status" className="text-xs text-[var(--text-secondary)]" data-testid="remote-access-restarting">
          {t("remoteAccess.bind.restarting", undefined, "Restarting the server… this dialog continues when it is back.")}
        </p>
      ) : restartPending ? (
        <PrimaryButton testId="remote-access-restart" onClick={() => void restart()}>
          {t("remoteAccess.bind.restart", undefined, "Restart")}
        </PrimaryButton>
      ) : (
        <PrimaryButton testId="remote-access-listen" onClick={() => void listen()} disabled={phase !== "idle"}>
          {t("remoteAccess.bind.listen", undefined, "Listen on all networks and restart")}
        </PrimaryButton>
      )}
    </div>
  );
}

// ── Let devices ask ──────────────────────────────────────────────────

export function AcceptBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const endpoints = ctx.snap.endpoints.status === "value" ? ctx.snap.endpoints.value : [];
  return (
    <div className="space-y-3">
      <p className={HELP}>
        {t("remoteAccess.accept.help", undefined, "Phones and laptops on the same Wi-Fi can ask to connect. You approve each one with a code.")}
      </p>
      <LanRequestPanel endpoints={endpoints} onChanged={() => void ctx.refresh()} />
    </div>
  );
}

// ── Who may enter ────────────────────────────────────────────────────

export function DoorBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const cfg = cfgOf(ctx);
  if (!cfg) return <UnknownNote pending={ctx.snap.config.status === "error" ? "error" : "loading"} onRetry={() => void ctx.refresh()} />;
  const open = openEntries(cfg);
  const sat = open.length === 0;
  return (
    <div className="space-y-3" data-testid="remote-access-step-door-body">
      {sat ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {t("remoteAccess.door.ok", undefined, "No network is admitted without signing in, apart from this computer.")}
        </p>
      ) : (
        <Callout severity="warning" testId="remote-access-door-warning">
          {t(
            "remoteAccess.door.warning",
            { n: String(open.length), list: open.join(", ") },
            `${open.length} network(s) get full access without signing in: ${open.join(", ")}. A sign-in provider does not change that.`,
          )}
        </Callout>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="remote-access-who-may-enter-security-link"
          className={BTN_SMALL}
          onClick={() => {
            ctx.close();
            ctx.navigate("/settings/security");
          }}
        >
          {t("remoteAccess.door.openSecurity", undefined, "Open Security settings")}
        </button>
        {!sat && (
          <SmallButton
            testId="remote-access-door-continue"
            onClick={() => ctx.patchRun({ waived: [...(ctx.run.waived ?? []), "door"] })}
          >
            {t("remoteAccess.door.continueAnyway", undefined, "Continue anyway")}
          </SmallButton>
        )}
      </div>
    </div>
  );
}

// ── Where is the device ──────────────────────────────────────────────

export function RoadBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const ev = evaluate("road", ctx.snap, ctx.run);
  if (ev.sat === "unknown") return <UnknownNote pending={ev.pending} onRetry={() => void ctx.refresh()} />;
  if (ev.sat === true && !ctx.run.branch) {
    return (
      <p className="text-xs text-[var(--text-secondary)]" data-testid="remote-access-road-endpoint">
        {t("remoteAccess.road.using", { url: ev.value ?? "" }, `The device will use ${ev.value ?? "this road"}.`)}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--text-secondary)]">{t("remoteAccess.road.ask", undefined, "Where is the device you want to let in?")}</p>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton testId="remote-access-branch-wifi" onClick={() => ctx.patchRun({ branch: "wifi" })}>
          {t("remoteAccess.road.wifi", undefined, "On the same Wi-Fi")}
        </PrimaryButton>
        <PrimaryButton testId="remote-access-branch-anywhere" onClick={() => ctx.patchRun({ branch: "anywhere" })}>
          {t("remoteAccess.road.anywhere", undefined, "Anywhere")}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Open it on the device ────────────────────────────────────────────

export function QrBody({ ctx }: { ctx: StepCtx }) {
  const { t } = useI18n();
  const ep = deviceEndpoint(ctx.snap);
  const [copied, setCopied] = useState(false);
  if (!ep) return <UnknownNote pending={ctx.snap.status.status === "error" || ctx.snap.config.status === "error" ? "error" : "loading"} onRetry={() => void ctx.refresh()} />;
  const transport = endpointTransport(ep);
  if (transport === "https") {
    return <GatewayPairQR httpsOnly showLanPanel={false} showWaiting={false} onSetupRequested={() => ctx.patchRun({ open: "provider" })} />;
  }
  if (transport === "other-http") {
    return (
      <Callout severity="warning" testId="remote-access-qr-needs-https">
        {t("remoteAccess.qr.needsHttps", undefined, "Pairing needs an https address or the same Wi-Fi. This address is plain http outside your local network, so no QR is shown.")}
      </Callout>
    );
  }
  return (
    <div className="space-y-3" data-testid="remote-access-qr-lan">
      <div className="flex flex-wrap gap-4">
        <QrCanvas text={ep.url} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-[var(--text-primary)]">
            {t("remoteAccess.qr.lanSteps", undefined, "Open this address on the device, then choose Request access.")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <code data-testid="remote-access-qr-lan-url" className="select-all break-all font-mono text-xs text-[var(--text-primary)]">
              {ep.url}
            </code>
            <SmallButton
              testId="remote-access-qr-lan-copy"
              onClick={() => {
                void copyText(ep.url).then((ok) => ok && setCopied(true));
              }}
            >
              {copied ? t("gateway.lan.copied", undefined, "Copied") : t("gateway.lan.copy", undefined, "Copy")}
            </SmallButton>
          </div>
          <p className={HELP}>
            {t("remoteAccess.qr.lanProtect", undefined, "This address is plain http. What protects the pairing is the code you compare in the next step.")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Approve with the code ────────────────────────────────────────────

export interface ApproveTrack {
  pendingId: string;
  /** Paired-device ids when the request arrived. */
  before: string[];
}

export function ApproveBody({
  ctx,
  tracked,
  onStartOver,
}: {
  ctx: StepCtx;
  tracked: ApproveTrack | null;
  onStartOver: () => void;
}) {
  const { t } = useI18n();
  const { pending } = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState);
  const [outcome, setOutcome] = useState<ApproveOutcome | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const stillPending = !!tracked && pending.some((p) => p.pendingId === tracked.pendingId);

  useEffect(() => {
    if (!tracked || stillPending || outcome) return;
    let cancelled = false;
    listPairedDevices()
      .then((after) => {
        if (cancelled) return;
        setOutcome(approveOutcome(tracked.before, after));
      })
      .catch(() => !cancelled && setReadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [tracked, stillPending, outcome]);

  if (outcome?.kind === "paired") {
    const devs = outcome.devices;
    return (
      <div className="space-y-2">
        <p role="status" data-testid="remote-access-approve-paired" className="text-sm text-[var(--severity-success-fg)]">
          {devs.length === 1
            ? t("remoteAccess.approve.paired1", { name: devs[0].label }, `${devs[0].label} is paired.`)
            : t("remoteAccess.approve.pairedN", { n: String(devs.length) }, `${devs.length} devices paired.`)}
        </p>
        <SmallButton testId="remote-access-approve-done" onClick={() => ctx.finishTask()}>
          {t("gateway.done", undefined, "Done")}
        </SmallButton>
      </div>
    );
  }
  if (outcome?.kind === "denied") {
    return (
      <div className="space-y-2" data-testid="remote-access-approve-denied">
        <Callout severity="warning">{t("remoteAccess.approve.denied", undefined, "Denied or expired.")}</Callout>
        <SmallButton testId="remote-access-approve-restart" onClick={onStartOver}>
          {t("remoteAccess.approve.startOver", undefined, "Start over")}
        </SmallButton>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className={HELP}>
        {t("remoteAccess.approve.help", undefined, "The approval dialog asks you to type the code the device shows. If you closed it, press Review.")}
      </p>
      <WaitingDevices />
      {readFailed && <UnknownNote pending="error" onRetry={() => setReadFailed(false)} />}
    </div>
  );
}
