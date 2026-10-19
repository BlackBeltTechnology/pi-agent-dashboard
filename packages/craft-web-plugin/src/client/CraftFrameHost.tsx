/**
 * Generic `editor-pane-file-handler` body for the ArtCraft web editors, parameterised by
 * a `CraftWebApp` row. Gates, in order, BEFORE any iframe exists (design D1/D4):
 *   1. `GET /api/plugins/craft-web/status` → disabled / restart-required / not-verified /
 *      not-prepared (size shown, Prepare action) / shim-outdated / offline / … (fail closed);
 *   2. snapshot preflight (core's size check runs first, so an over-limit file never
 *      downloads the app; the bytes are delivered to the app on its `ready`);
 *   3. renderer probe: `navigator.gpu` → default; WebGL2 → `?webgl`; neither → message.
 * Then mounts `CraftFrame`. A static request never provisions: only the Prepare button does.
 * See change: edit-office-in-pane-with-craft-web.
 */
import type {
  FileHandlerProps,
  FileHandlerSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CraftFrame } from "./CraftFrame.js";
import { fetchCraftStatus, prepareCraftApp, type StatusOutcome } from "./craft-api.js";
import type { CraftWebApp } from "./craft-apps-table.js";
import { probeRenderer, rendererMode } from "./gpu-probe.js";
import { formatSize, type MsgKey, type Translate, useCraftT } from "./messages.js";
import { type Gate, gateFor, PREPARABLE } from "./status-types.js";
import { BTN_PRIMARY, PANEL } from "./ui.js";

type Snap = { phase: "loading" } | { phase: "ok" } | { phase: "error"; message: string };
type Prep = { phase: "idle" } | { phase: "running" } | { phase: "failed"; reason: string };
type HostGate = Gate | { kind: "loading" } | { kind: "unreachable" };

const REASON_KEY: Record<string, MsgKey> = {
  offline: "reasonOffline",
  "checksum-mismatch": "reasonChecksum",
  "extract-failed": "reasonExtract",
};

/** Reasons whose copy needs no further data: gate reason → message key. */
const STATIC_GATES: Record<string, { testId: string; key: MsgKey }> = {
  disabled: { testId: "craft-gate-disabled", key: "disabled" },
  "restart-required": { testId: "craft-gate-restart-required", key: "restartRequired" },
  "not-verified": { testId: "craft-gate-not-verified", key: "notVerified" },
  "launcher-source": { testId: "craft-gate-launcher-source", key: "launcherSource" },
};

function toGate(outcome: StatusOutcome | null, appId: string): HostGate {
  if (!outcome) return { kind: "loading" };
  if (outcome.kind === "restart-required") return { kind: "blocked", reason: "restart-required" };
  if (outcome.kind === "unreachable") return { kind: "unreachable" };
  return gateFor(outcome.status, appId);
}

/** Status fetch: once per mount, again after a successful Prepare or an explicit refresh. */
function useStatus(appId: string) {
  const [outcome, setOutcome] = useState<StatusOutcome | null>(null);
  const [key, setKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the refresh trigger
  useEffect(() => {
    let alive = true;
    void fetchCraftStatus().then((o) => alive && setOutcome(o));
    return () => {
      alive = false;
    };
  }, [key]);
  const refresh = useCallback((clear: boolean) => {
    if (clear) setOutcome(null);
    setKey((k) => k + 1);
  }, []);
  return { gate: toGate(outcome, appId), refresh };
}

/** Snapshot preflight: held until the frame's `ready` takes it, then fresh reads (Retry/Resume). */
function useSnapshotPreflight(fhRef: { current: FileHandlerProps }) {
  const [snap, setSnap] = useState<Snap>({ phase: "loading" });
  const [key, setKey] = useState(0);
  const preflight = useRef<Promise<FileHandlerSnapshot> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the retry trigger
  useEffect(() => {
    let alive = true;
    setSnap({ phase: "loading" });
    const p = fhRef.current.snapshot();
    preflight.current = p;
    p.then(
      () => alive && setSnap({ phase: "ok" }),
      (err: unknown) => alive && setSnap({ phase: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
  }, [key, fhRef]);
  const take = useCallback((): Promise<FileHandlerSnapshot> => {
    const p = preflight.current ?? fhRef.current.snapshot();
    preflight.current = null;
    return p;
  }, [fhRef]);
  return { snap, take, retry: () => setKey((k) => k + 1) };
}

function Panel({ testId, appId, message, action }: { testId: string; appId: string; message: string; action?: { label: string; onClick: () => void; disabled?: boolean; testId: string } }) {
  return (
    <div className={PANEL} data-testid={testId} data-app={appId}>
      <p>{message}</p>
      {action && (
        <button type="button" className={BTN_PRIMARY} disabled={action.disabled} data-testid={action.testId} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

interface PrepareGateProps {
  t: Translate;
  app: CraftWebApp;
  reason: string;
  sizeGzip?: number;
  prep: Prep;
  snapReady: boolean;
  onPrepare: () => void;
}

/** Preparable gate: size first, then the explicit Prepare/Retry action (X2: "could not be prepared"). */
function PrepareGate({ t, app, reason, sizeGzip, prep, snapReady, onPrepare }: PrepareGateProps) {
  const size = formatSize(sizeGzip);
  const prepFailed = prep.phase === "failed";
  const failed = prepFailed || reason === "offline" || reason === "checksum-mismatch" || reason === "extract-failed";
  const failReason = prep.phase === "failed" ? prep.reason : reason;
  const keyFor = (withSize: MsgKey, noSize: MsgKey): MsgKey => (size ? withSize : noSize);
  const baseKey = reason === "shim-outdated" ? keyFor("shimOutdated", "shimOutdatedNoSize") : keyFor("notPrepared", "notPreparedNoSize");
  const message = failed
    ? t("prepareFailed", { app: app.label, reason: t(REASON_KEY[failReason] ?? "reasonUnknown") })
    : t(baseKey, { app: app.label, size: size ?? "" });
  const label = prep.phase === "running" ? t("preparing", { app: app.label }) : failed ? t("retry") : t("prepare", { app: app.label });
  return (
    <Panel
      testId="craft-gate-prepare"
      appId={app.id}
      message={message}
      action={{ label, onClick: onPrepare, disabled: prep.phase === "running" || !snapReady, testId: "craft-prepare" }}
    />
  );
}

export function CraftFrameHost({ app, ...fh }: { app: CraftWebApp } & FileHandlerProps) {
  const t = useCraftT();
  const fhRef = useRef<FileHandlerProps>(fh);
  fhRef.current = fh;
  const { gate, refresh } = useStatus(app.id);
  const { snap, take, retry: retrySnap } = useSnapshotPreflight(fhRef);
  const [prep, setPrep] = useState<Prep>({ phase: "idle" });
  const probe = useMemo(() => (gate.kind === "ready" && snap.phase === "ok" ? probeRenderer() : null), [gate.kind, snap.phase]);

  const onPrepare = async () => {
    setPrep({ phase: "running" });
    const res = await prepareCraftApp(app.id);
    setPrep(res.ok ? { phase: "idle" } : { phase: "failed", reason: res.reason });
    if (res.ok) refresh(false);
  };

  const panel = (testId: string, message: string, action?: { label: string; onClick: () => void; testId: string }) => (
    <Panel testId={testId} appId={app.id} message={message} action={action} />
  );
  const snapError = (message: string) =>
    panel("craft-snapshot-error", t("snapshotFailed", { message }), { label: t("retry"), onClick: retrySnap, testId: "craft-snapshot-retry" });

  if (gate.kind === "loading") return panel("craft-gate-loading", t("checking", { app: app.label }));
  if (gate.kind === "unreachable")
    return panel("craft-gate-unreachable", t("statusUnreachable", { app: app.label }), {
      label: t("retry"),
      onClick: () => refresh(true),
      testId: "craft-gate-retry",
    });
  if (gate.kind === "blocked") {
    const fixed = STATIC_GATES[gate.reason];
    if (fixed) return panel(fixed.testId, t(fixed.key, { app: app.label }));
    if (!PREPARABLE.has(gate.reason)) return panel("craft-gate-unavailable", t("unavailable", { app: app.label }));
    if (snap.phase === "error") return snapError(snap.message);
    return <PrepareGate t={t} app={app} reason={gate.reason} sizeGzip={gate.sizeGzip} prep={prep} snapReady={snap.phase === "ok"} onPrepare={() => void onPrepare()} />;
  }

  // Gate ready: snapshot preflight, then the renderer probe, then the frame.
  if (snap.phase === "error") return snapError(snap.message);
  if (!probe) return panel("craft-snapshot-loading", t("readingFile"));
  const mode = rendererMode(probe);
  if (mode === "none") return panel("craft-no-renderer", t("noRenderer", { app: app.label }));
  return <CraftFrame app={app} fh={fh} initialWebgl={mode === "webgl"} webglCapable={probe.webgl2} takeSnapshot={take} />;
}
