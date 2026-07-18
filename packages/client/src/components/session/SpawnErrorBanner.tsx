/**
 * Spawn error banner component.
 *
 * Renders structured spawn failure info: code→hint mapping, preflight
 * reasons list, collapsed stderr, and a distinct "timeout" banner when
 * pi started but never connected to the dashboard.
 *
 * See change: spawn-failure-diagnostics.
 */

import type { SpawnFailureCode } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import React from "react";
import type { SpawnErrorDetail } from "../../hooks/useMessageHandler.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface HintEntry {
  labelKey: string;
  label: string;
  cta?: { labelKey: string; label: string; action: "wizard" | "log" };
}

const WIZARD_CTA = { labelKey: "err.openSetupWizard", label: "Open Setup Wizard", action: "wizard" } as const;

const CODE_HINTS: Record<SpawnFailureCode, HintEntry> = {
  DIR_MISSING: { labelKey: "err.dirMissing", label: "Folder no longer exists." },
  PI_NOT_FOUND: { labelKey: "err.piNotFound", label: "Pi binary not found.", cta: WIZARD_CTA },
  WIN_PI_CMD_ONLY: { labelKey: "err.winPiCmdOnly", label: "Windows install incomplete (only pi.cmd found).", cta: WIZARD_CTA },
  WT_MISSING: { labelKey: "err.wtMissing", label: "Windows Terminal not installed." },
  TMUX_MISSING: { labelKey: "err.tmuxMissing", label: "tmux not installed." },
  PI_CRASHED: { labelKey: "err.piCrashed", label: "Pi exited immediately. See log below." },
  SPAWN_ERRNO: { labelKey: "err.spawnErrno", label: "OS refused to start pi. See message." },
  PREFLIGHT_FAILED: { labelKey: "err.preflightFailed", label: "Preflight checks failed." },
  REGISTER_TIMEOUT: { labelKey: "err.registerTimeout", label: "Pi started but never connected to the dashboard.", cta: { labelKey: "err.viewLog", label: "View log", action: "log" } },
};

function openWizard(): void {
  // Navigate to the setup wizard (Settings → Tools rescan / install).
  // In Electron this posts a message to the main process; in web we link
  // to settings with the tools tab pre-selected.
  window.dispatchEvent(new CustomEvent("pi-dashboard:open-settings", { detail: { tab: "general" } }));
}

interface Props {
  detail: SpawnErrorDetail;
  onDismiss?: () => void;
}

export function SpawnErrorBanner({ detail, onDismiss }: Props) {
  const { kind, message, code, reasons, stderr, pid } = detail;

  if (kind === "timeout") {
    return <TimeoutBanner detail={detail} onDismiss={onDismiss} />;
  }

  const hint = code ? CODE_HINTS[code] : undefined;

  return (
    <div
      data-testid="spawn-error-banner"
      className="mx-2 bg-[var(--severity-error-bg)] border border-[var(--severity-error-border)] rounded-lg px-3 py-2 text-xs text-[var(--severity-error-fg)]"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {hint ? (
            <>
              <span className="font-medium">{i18nT(hint.labelKey, undefined, hint.label)}</span>
              {!code || code !== "PREFLIGHT_FAILED" ? (
                <span className="ml-1 text-[var(--severity-error-fg)]/70">{message}</span>
              ) : null}
            </>
          ) : (
            <span>{message}</span>
          )}

          {/* Preflight reasons list */}
          {code === "PREFLIGHT_FAILED" && reasons && reasons.length > 0 && (
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-[var(--severity-error-fg)]/80">
              {reasons.map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
          )}

          {/* CTA button */}
          {hint?.cta && (
            <div className="mt-1.5">
              {hint.cta.action === "wizard" && (
                <button
                  onClick={openWizard}
                  className="text-xs text-[var(--severity-error-fg)] underline hover:text-[var(--severity-error-fg)]/80"
                >
                  {i18nT(hint.cta.labelKey, undefined, hint.cta.label)}
                </button>
              )}
              {hint.cta.action === "log" && (
                <a
                  href="/settings/general"
                  className="text-xs text-[var(--severity-error-fg)] underline hover:text-[var(--severity-error-fg)]/80"
                >
                  {i18nT(hint.cta.labelKey, undefined, hint.cta.label)}
                </a>
              )}
            </div>
          )}

          {/* Stderr tail */}
          {stderr && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[var(--severity-error-fg)]/70 hover:text-[var(--severity-error-fg)]">{i18nT("terminal.piStderr", undefined, "Pi stderr")}</summary>
              <pre className="mt-1 text-[10px] text-[var(--severity-error-fg)]/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">{stderr}</pre>
            </details>
          )}
        </div>

        {onDismiss && (
          <button
            data-testid="spawn-error-dismiss"
            onClick={onDismiss}
            className="text-[var(--severity-error-fg)]/80 hover:text-[var(--severity-error-fg)] shrink-0 mt-0.5"
          >✕</button>
        )}
      </div>
    </div>
  );
}

function TimeoutBanner({ detail, onDismiss }: Props) {
  const { pid, stderr, timeoutMs } = detail;
  // Use the timeout value carried in the message; fall back to 30s for legacy servers.
  const timeoutSecs = timeoutMs !== undefined ? timeoutMs / 1000 : 30;

  const label = pid !== undefined
    ? i18nT("err.spawnTimeoutWithPid", { pid, secs: timeoutSecs }, "Pi started (PID {pid}) but never connected to the dashboard within {secs}s.")
    : i18nT("err.spawnTimeout", { secs: timeoutSecs }, "Pi started but never connected to the dashboard within {secs}s.");

  return (
    <div
      data-testid="spawn-timeout-banner"
      className="mx-2 bg-[var(--severity-warning-bg)] border border-[var(--severity-warning-border)] rounded-lg px-3 py-2 text-xs text-[var(--severity-warning-fg)]"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-medium">{label}</span>
          {stderr && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[var(--severity-warning-fg)]/70 hover:text-[var(--severity-warning-fg)]">{i18nT("terminal.piStderr", undefined, "Pi stderr")}</summary>
              <pre className="mt-1 text-[10px] text-[var(--severity-warning-fg)]/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">{stderr}</pre>
            </details>
          )}
        </div>
        {onDismiss && (
          <button
            data-testid="spawn-timeout-dismiss"
            onClick={onDismiss}
            className="text-[var(--severity-warning-fg)]/80 hover:text-[var(--severity-warning-fg)] shrink-0 mt-0.5"
          >✕</button>
        )}
      </div>
    </div>
  );
}
