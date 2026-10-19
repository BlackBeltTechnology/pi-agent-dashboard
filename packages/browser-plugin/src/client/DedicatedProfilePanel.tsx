/**
 * "Dedicated agent profile" panel (change: add-dedicated-agent-browser, task
 * 7.2 / spec `browser-plugin-settings` "Dedicated agent profile panel").
 *
 * Driven ONLY by `status.dedicated` (never by `canOpenChrome`). Shows state,
 * holder (session display name → REST `client` label → raw session id), last
 * used, size and data dir; offers Open to sign in / Stop / Reset (inline
 * confirmation, stopped only). Unavailable host → reason, no actions. Relay
 * disabled → shown as stopped with every action disabled.
 */
import {
  SettingsNotice,
  SettingsStatusPill,
  useLanguage,
  useSessionState,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AuditList } from "./AuditList.js";
import {
  type DedicatedHolder,
  type DedicatedState,
  type DedicatedStatus,
  openDedicated,
  resetDedicated,
  stopDedicated,
} from "./browser-api.js";
import { BTN, BTN_DANGER, BTN_PRIMARY, GROUP, HELP } from "./settings-ui.js";

/** `1536` → `"1.5 KB"`, `412 MiB` → `"412 MB"`. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

/** Relative time in the UI language ("3 minutes ago"); falls back to the absolute time. */
function formatRelative(ts: number, language: string, now: number = Date.now()): string {
  try {
    const seconds = Math.round((ts - now) / 1000);
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    if (abs < 60) return rtf.format(seconds, "second");
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
    return rtf.format(Math.round(seconds / 86_400), "day");
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Holder name: the session's display name when resolvable, else the REST client label, else the session id. */
function HolderName({ holder }: { holder: DedicatedHolder }): React.ReactElement {
  const session = useSessionState(holder.sessionId ?? "");
  const name = session?.name?.trim() || holder.client || holder.sessionId || "";
  return <span data-testid="browser-dedicated-holder">{name}</span>;
}

export interface DedicatedProfilePanelProps {
  dedicated: DedicatedStatus;
  /** Relay `enabled`. */
  enabled: boolean;
  onRefetch: () => Promise<void>;
}

export function DedicatedProfilePanel({ dedicated, enabled, onRefetch }: DedicatedProfilePanelProps): React.ReactElement {
  const t = useT();
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setFailed(false);
      try {
        await action();
        await onRefetch();
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [onRefetch],
  );

  const closeConfirm = () => {
    setConfirming(false);
    resetRef.current?.focus();
  };

  // Plugin off: the profile is shown as stopped (the kill switch closed it).
  const state: DedicatedState = !enabled && dedicated.state !== "not-created" ? "stopped" : dedicated.state;
  const locked = !enabled || busy;

  return (
    <section data-testid="browser-dedicated-panel" aria-labelledby={`${ids}-h`} className={GROUP}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${ids}-h`} className="text-sm font-semibold text-[var(--text-primary)]">
          {t("dedicatedTitle", undefined, "Dedicated agent profile")}
        </h3>
        <StatePill dedicated={dedicated} state={state} />
      </div>

      {!dedicated.available ? (
        <UnavailableReason reason={dedicated.reason} />
      ) : (
        <div className="space-y-3">
          {!enabled && <p className={HELP}>{t("relayDisabled", undefined, "Browser relay disabled")}</p>}

          <Facts dedicated={dedicated} state={state} />

          <Actions
            state={state}
            locked={locked}
            resetRef={resetRef}
            onOpen={() => void run(openDedicated)}
            onStop={() => void run(stopDedicated)}
            onReset={() => setConfirming(true)}
          />

          {failed && (
            <SettingsNotice tone="warning" role="alert" testId="browser-dedicated-error">
              {t("dedicatedActionFailed", undefined, "The action failed. Check the dashboard log and try again.")}
            </SettingsNotice>
          )}

          {confirming && (
            <ResetConfirm
              locked={locked}
              onCancel={closeConfirm}
              onConfirm={() => {
                setConfirming(false);
                void run(resetDedicated);
              }}
            />
          )}

          <AuditList profileDirectory="@dedicated" />
        </div>
      )}
    </section>
  );
}

function Fact({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-2">
      <dt className={HELP}>{label}</dt>
      <dd data-testid={testId} className="text-[var(--text-secondary)]">
        {children}
      </dd>
    </div>
  );
}

function StatePill({ dedicated, state }: { dedicated: DedicatedStatus; state: DedicatedState }): React.ReactElement {
  const t = useT();
  if (!dedicated.available) {
    return <SettingsStatusPill tone="neutral" testId="browser-dedicated-state">{t("dedicatedPillUnavailable", undefined, "Unavailable")}</SettingsStatusPill>;
  }
  if (state === "running") {
    return (
      <SettingsStatusPill tone="success" testId="browser-dedicated-state">
        {dedicated.holder
          ? t("dedicatedPillRunningOne", undefined, "Running · 1 session")
          : t("dedicatedPillRunning", undefined, "Running")}
      </SettingsStatusPill>
    );
  }
  if (state === "starting") {
    return <SettingsStatusPill tone="info" testId="browser-dedicated-state">{t("dedicatedPillStarting", undefined, "Starting")}</SettingsStatusPill>;
  }
  if (state === "not-created") {
    return <SettingsStatusPill tone="info" testId="browser-dedicated-state">{t("dedicatedPillNotSetUp", undefined, "Not set up")}</SettingsStatusPill>;
  }
  return <SettingsStatusPill tone="neutral" testId="browser-dedicated-state">{t("dedicatedPillStopped", undefined, "Stopped")}</SettingsStatusPill>;
}

function StatusText({ state, holder }: { state: DedicatedState; holder?: DedicatedHolder }): React.ReactElement {
  const t = useT();
  if (state === "running" && holder) {
    return (
      <>
        {t("dedicatedStatusRunningBy", undefined, "Running, used by")} <HolderName holder={holder} />
      </>
    );
  }
  if (state === "running") return <>{t("dedicatedStatusRunning", undefined, "Running")}</>;
  if (state === "starting") return <>{t("dedicatedStatusStarting", undefined, "Starting")}</>;
  return <>{t("dedicatedStatusStopped", undefined, "Stopped")}</>;
}

/** Inline confirmation (no modal): focuses Cancel on open, Escape cancels. */
function ResetConfirm({
  locked,
  onCancel,
  onConfirm,
}: {
  locked: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const t = useT();
  const ids = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${ids}-ct`}
      aria-describedby={`${ids}-cb`}
      data-testid="browser-dedicated-reset-dialog"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3"
    >
      <h4 id={`${ids}-ct`} className="text-sm font-semibold text-[var(--text-primary)]">
        {t("resetConfirmTitle", undefined, "Reset the dedicated profile?")}
      </h4>
      <p id={`${ids}-cb`} className="mt-1 text-xs text-[var(--text-secondary)]">
        {t(
          "resetConfirmBody",
          undefined,
          "This deletes the profile's cookies, logins and history. Only possible while the profile is stopped.",
        )}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button ref={cancelRef} type="button" data-testid="browser-dedicated-reset-cancel" className={BTN} onClick={onCancel}>
          {t("resetConfirmCancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          data-testid="browser-dedicated-reset-confirm"
          className={BTN_DANGER}
          disabled={locked}
          onClick={onConfirm}
        >
          {t("resetConfirmOk", undefined, "Reset and sign out")}
        </button>
      </div>
    </div>
  );
}

function UnavailableReason({ reason }: { reason: DedicatedStatus["reason"] }): React.ReactElement {
  const t = useT();
  return (
    <p data-testid="browser-dedicated-reason" data-reason={reason} className="text-xs text-[var(--text-secondary)]">
      {reason === "no-display"
        ? t("dedicatedNoDisplay", undefined, "This host has no display, so a Chrome window cannot open here.")
        : t("dedicatedNoChrome", undefined, "Needs desktop Google Chrome on this host.")}
    </p>
  );
}

/** Status facts + data dir + limits copy; `not-created` shows the setup intro instead. */
function Facts({ dedicated, state }: { dedicated: DedicatedStatus; state: DedicatedState }): React.ReactElement {
  const t = useT();
  const language = useLanguage();
  if (state === "not-created") {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        {t(
          "dedicatedCreateIntro",
          undefined,
          "Create a Chrome profile only the agent uses. It opens in its own window so you can sign in to the accounts the agent should reach.",
        )}
      </p>
    );
  }
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Fact label={t("dedicatedStatus", undefined, "Status")} testId="browser-dedicated-status">
          <StatusText state={state} holder={dedicated.holder} />
        </Fact>
        <Fact label={t("dedicatedLastUsed", undefined, "Last used")} testId="browser-dedicated-last-used">
          {dedicated.lastUsed !== undefined
            ? formatRelative(dedicated.lastUsed, language)
            : t("dedicatedNever", undefined, "Never")}
        </Fact>
        <Fact label={t("dedicatedSize", undefined, "Size on disk")} testId="browser-dedicated-size">
          {dedicated.sizeBytes !== undefined ? formatBytes(dedicated.sizeBytes) : "—"}
        </Fact>
        <Fact label={t("dedicatedServes", undefined, "Serves")} testId="browser-dedicated-serves">
          {t("dedicatedServesValue", undefined, "one session at a time")}
        </Fact>
      </dl>
      <p className={HELP}>
        {t("dedicatedData", undefined, "Data:")}{" "}
        <span data-testid="browser-dedicated-data-dir" className="font-mono">
          {dedicated.dataDir}
        </span>{" "}
        ·{" "}
        {t(
          "dedicatedLimits",
          undefined,
          "Sign in once in its window; logins stay here. Open tabs close when the dashboard restarts. Tabs you open by hand in this window are visible to the agent. Other programs running as you can read this folder.",
        )}
      </p>
    </>
  );
}

/** Open / Stop / Reset. Stop only while running; Reset only once created and enabled only while stopped. */
function Actions({
  state,
  locked,
  resetRef,
  onOpen,
  onStop,
  onReset,
}: {
  state: DedicatedState;
  locked: boolean;
  resetRef: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onStop: () => void;
  onReset: () => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="browser-dedicated-open"
        className={BTN_PRIMARY}
        disabled={locked || state === "starting"}
        onClick={onOpen}
      >
        {state === "not-created"
          ? t("dedicatedCreateAndOpen", undefined, "Create and open to sign in")
          : t("dedicatedOpen", undefined, "Open to sign in")}
      </button>
      {state === "running" && (
        <button type="button" data-testid="browser-dedicated-stop" className={BTN} disabled={locked} onClick={onStop}>
          {t("dedicatedStop", undefined, "Stop")}
        </button>
      )}
      {state !== "not-created" && (
        <button
          ref={resetRef}
          type="button"
          data-testid="browser-dedicated-reset"
          className={`${BTN_DANGER} ml-auto`}
          disabled={locked || state !== "stopped"}
          title={state !== "stopped" ? t("dedicatedResetNeedsStop", undefined, "Stop the profile first") : undefined}
          onClick={onReset}
        >
          {t("dedicatedReset", undefined, "Reset profile…")}
        </button>
      )}
    </div>
  );
}
