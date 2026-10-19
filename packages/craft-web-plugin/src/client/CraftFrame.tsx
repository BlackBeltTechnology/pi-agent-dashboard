/**
 * The sandboxed editor frame (design D4). Mounted by `CraftFrameHost` only after the status
 * gate, the snapshot preflight and the GPU probe have passed. All protocol logic lives in
 * `FrameSession` (one per run); this component renders its state: toolbar with the
 * Save-target toggle, notices (blocked / navigate / save errors / over-cap offer), the
 * Save-as dialog, loading + failure panels.
 *
 * The iframe is `sandbox="allow-scripts"` (opaque origin), `allow="clipboard-write"`,
 * deliberately WITHOUT `allow-downloads`: every save/export is a host-origin download.
 * See change: edit-office-in-pane-with-craft-web.
 */
import type {
  FileHandlerProps,
  FileHandlerSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CraftWebApp } from "./craft-apps-table.js";
import { downloadToDevice } from "./device-download.js";
import { type DownloadOffer, FrameSession, type Phase, type SaveAsChoice } from "./frame-session.js";
import { formatSize, type Translate, useCraftT } from "./messages.js";
import { baseName } from "./save-routing.js";
import { getSaveTarget, saveTargetKey, setSaveTarget, useSaveTarget } from "./save-target-store.js";
import { makeNonce } from "./shim-protocol.js";
import { BTN, BTN_PRIMARY, NOTICE, PANEL } from "./ui.js";

export { OPENED_TIMEOUT_MS, READY_TIMEOUT_MS } from "./frame-session.js";

interface Run {
  attempt: number;
  nonce: string;
  webgl: boolean;
}

export interface CraftFrameProps {
  app: CraftWebApp;
  fh: FileHandlerProps;
  /** Frame starts with `?webgl` (no `navigator.gpu`, WebGL2 present). */
  initialWebgl: boolean;
  /** WebGL2 is available, so a failed WebGPU start can be retried with `?webgl`. */
  webglCapable: boolean;
  /** Hands over the preflight snapshot once, then fresh ones (Retry/Resume). */
  takeSnapshot: () => Promise<FileHandlerSnapshot>;
}

/** Mutable "latest" values the long-lived session reads without re-creating the effect. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function CraftFrame({ app, fh, initialWebgl, webglCapable, takeSnapshot }: CraftFrameProps) {
  const t = useCraftT();
  const tRef = useLatest(t);
  const fhRef = useLatest(fh);
  const takeRef = useLatest(takeSnapshot);
  const saveKey = saveTargetKey(fh.cwd, fh.path);
  const saveKeyRef = useLatest(saveKey);
  const target = useSaveTarget(saveKey);

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef<FrameSession | null>(null);
  const [run, setRun] = useState<Run>(() => ({ attempt: 0, nonce: makeNonce(), webgl: initialWebgl }));
  const [phase, setPhase] = useState<Phase>("starting");
  const [lostEdits, setLostEdits] = useState(false);
  const [snapMsg, setSnapMsg] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [nav, setNav] = useState<{ url: string | null } | null>(null);
  const [saveAs, setSaveAs] = useState<{ name: string } | null>(null);
  const [offer, setOffer] = useState<DownloadOffer | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a session is keyed by `run` (fresh nonce per mount); the rest is read through refs
  useEffect(() => {
    const session = new FrameSession({
      app,
      nonce: run.nonce,
      frame: frameRef.current,
      fh: () => fhRef.current,
      takeSnapshot: () => takeRef.current(),
      saveTarget: () => getSaveTarget(saveKeyRef.current),
      t: () => tRef.current,
      ui: { setPhase, setLostEdits, setSnapMsg, setBlocked, setNav, setSaveAs, setOffer, setSaveError },
    });
    sessionRef.current = session;
    session.start();
    return () => session.dispose();
  }, [run, app]);

  const restart = useCallback((webgl: boolean) => {
    setPhase("starting");
    setRun((r) => ({ attempt: r.attempt + 1, nonce: makeNonce(), webgl }));
  }, []);

  const showFrame = phase === "starting" || phase === "opening" || phase === "open";
  const src = `/apps/craft-${app.id}/index.html${run.webgl ? "?webgl" : ""}#n=${run.nonce}`;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="craft-frame-host" data-app={app.id} data-phase={phase}>
      <Toolbar label={app.label} target={target} onTarget={(v) => setSaveTarget(saveKey, v)} t={t} />
      <Notices
        t={t}
        app={app}
        blocked={blocked}
        nav={nav}
        saveError={saveError}
        offer={offer}
        onNavClose={() => setNav(null)}
        onOfferClose={() => setOffer(null)}
      />
      <div className="relative min-h-0 flex-1">
        {showFrame && (
          <iframe
            key={run.attempt}
            ref={frameRef}
            title={t("frameTitle", { app: app.label })}
            src={src}
            sandbox="allow-scripts"
            allow="clipboard-write"
            data-testid="craft-frame"
            className="h-full w-full border-0 bg-[var(--bg-primary)]"
          />
        )}
        {(phase === "starting" || phase === "opening") && (
          <div className={`absolute inset-0 ${PANEL} bg-[var(--bg-primary)]`} data-testid="craft-loading">
            {phase === "starting" ? t("starting", { app: app.label }) : t("opening")}
          </div>
        )}
        {saveAs && (
          <SaveAsDialog t={t} app={app} name={saveAs.name} file={baseName(fh.path)} onPick={(c) => sessionRef.current?.pickSaveAs(c)} />
        )}
        <FailPanels
          t={t}
          app={app}
          phase={phase}
          lostEdits={lostEdits}
          snapMsg={snapMsg}
          onRetryStart={() => restart(run.webgl || webglCapable)}
          onRetry={() => restart(run.webgl)}
        />
      </div>
    </div>
  );
}

function Toolbar({ label, target, onTarget, t }: { label: string; target: "overwrite" | "copy"; onTarget: (v: "overwrite" | "copy") => void; t: Translate }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1">
      <span className="text-xs font-semibold text-[var(--text-primary)]">{label}</span>
      <div role="group" aria-label={t("saveTarget")} className="ml-auto flex items-center gap-1 text-xs" data-testid="craft-save-target">
        <span className="text-[var(--text-secondary)]">{t("saveTarget")}</span>
        {(["overwrite", "copy"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={target === v}
            data-testid={`craft-save-target-${v}`}
            onClick={() => onTarget(v)}
            className={`focus-ring rounded px-2 py-0.5 ${target === v ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
          >
            {v === "overwrite" ? t("targetOverwrite") : t("targetCopy")}
          </button>
        ))}
      </div>
    </div>
  );
}

interface NoticesProps {
  t: Translate;
  app: CraftWebApp;
  blocked: boolean;
  nav: { url: string | null } | null;
  saveError: string | null;
  offer: DownloadOffer | null;
  onNavClose: () => void;
  onOfferClose: () => void;
}

function Notices({ t, app, blocked, nav, saveError, offer, onNavClose, onOfferClose }: NoticesProps) {
  return (
    <>
      {blocked && (
        <div role="status" data-testid="craft-blocked-toast" className={NOTICE}>
          {t("blockedToast")}
        </div>
      )}
      {nav && <NavOffer t={t} app={app} url={nav.url} onClose={onNavClose} />}
      {saveError && (
        <div role="alert" data-testid="craft-save-error" className={NOTICE}>
          {saveError}
        </div>
      )}
      {offer && (
        <div role="alert" data-testid="craft-too-large" className={NOTICE}>
          <span>{t("tooLarge", { limit: formatSize(app.maxBytes) ?? "" })}</span>
          <button type="button" className={BTN_PRIMARY} data-testid="craft-download-offer" onClick={() => downloadToDevice(offer.name, offer.bytes, offer.mime)}>
            {t("downloadDoc")}
          </button>
          <button type="button" className={BTN} onClick={onOfferClose}>
            {t("dismiss")}
          </button>
        </div>
      )}
    </>
  );
}

function NavOffer({ t, app, url, onClose }: { t: Translate; app: CraftWebApp; url: string | null; onClose: () => void }) {
  return (
    <div role="status" data-testid="craft-nav-offer" className={NOTICE}>
      <span>{url ? t("navigateOffer", { app: app.label, url }) : t("navigateUnsafe", { app: app.label })}</span>
      {url && (
        <button
          type="button"
          className={BTN_PRIMARY}
          data-testid="craft-nav-open"
          onClick={() => {
            window.open(url, "_blank", "noopener,noreferrer");
            onClose();
          }}
        >
          {t("openNewTab")}
        </button>
      )}
      <button type="button" className={BTN} data-testid="craft-nav-dismiss" onClick={onClose}>
        {t("dismiss")}
      </button>
    </div>
  );
}

function SaveAsDialog({ t, app, name, file, onPick }: { t: Translate; app: CraftWebApp; name: string; file: string; onPick: (c: SaveAsChoice) => void }) {
  const title = t("saveAsTitle", { app: app.label, name });
  return (
    <div className="absolute inset-0 z-raised flex items-center justify-center bg-[var(--bg-primary)]/80 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-testid="craft-save-as"
        className="flex max-w-md flex-col gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-primary)]"
      >
        <p>{title}</p>
        <div className="flex flex-wrap gap-2">
          <ChoiceButton testId="craft-save-as-copy" primary onPick={() => onPick("copy")}>
            {t("saveAsCopy", { file })}
          </ChoiceButton>
          <ChoiceButton testId="craft-save-as-overwrite" onPick={() => onPick("overwrite")}>
            {t("saveAsOverwrite", { file })}
          </ChoiceButton>
          <ChoiceButton testId="craft-save-as-cancel" onPick={() => onPick("cancel")}>
            {t("cancel")}
          </ChoiceButton>
        </div>
      </div>
    </div>
  );
}

function ChoiceButton({ children, onPick, primary, testId }: { children: ReactNode; onPick: () => void; primary?: boolean; testId: string }) {
  return (
    <button type="button" className={primary ? BTN_PRIMARY : BTN} data-testid={testId} onClick={onPick}>
      {children}
    </button>
  );
}

interface FailPanelsProps {
  t: Translate;
  app: CraftWebApp;
  phase: Phase;
  lostEdits: boolean;
  snapMsg: string;
  onRetryStart: () => void;
  onRetry: () => void;
}

/** The terminal panels (no iframe): start-failed / open-failed / snapshot-error / reloaded. */
function FailPanels({ t, app, phase, lostEdits, snapMsg, onRetryStart, onRetry }: FailPanelsProps) {
  switch (phase) {
    case "start-failed":
      return <FailPanel testId="craft-start-failed" message={t("startFailed", { app: app.label })} action={t("retry")} onRetry={onRetryStart} />;
    case "open-failed":
      return <FailPanel testId="craft-open-failed" message={t("openFailed")} action={t("retry")} onRetry={onRetry} />;
    case "snapshot-error":
      return <FailPanel testId="craft-snapshot-error" message={t("snapshotFailed", { message: snapMsg })} action={t("retry")} onRetry={onRetry} />;
    case "reloaded":
      return <FailPanel testId="craft-reloaded" message={lostEdits ? t("reloadedLost") : t("reloaded")} action={t("resume")} onRetry={onRetry} />;
    default:
      return null;
  }
}

function FailPanel({ message, action, onRetry, testId }: { message: string; action: string; onRetry: () => void; testId: string }) {
  return (
    <div role="alert" className={PANEL} data-testid={testId}>
      <p>{message}</p>
      <button type="button" className={BTN_PRIMARY} data-testid={`${testId}-retry`} onClick={onRetry}>
        {action}
      </button>
    </div>
  );
}
