/**
 * Spawn error banner component.
 *
 * Renders structured spawn failure info: code→hint mapping, preflight
 * reasons list, collapsed stderr, and a distinct "timeout" banner when
 * pi started but never connected to the dashboard.
 *
 * See change: spawn-failure-diagnostics.
 */
import React from "react";
import type { SpawnErrorDetail } from "../hooks/useMessageHandler.js";
import type { SpawnFailureCode } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { t as i18nT } from "../lib/i18n";

interface HintEntry {
  label: string;
  cta?: { label: string; action: "wizard" | "log" };
}

const CODE_HINTS: Record<SpawnFailureCode, HintEntry> = {
  DIR_MISSING: { label: "Folder no longer exists." },
  PI_NOT_FOUND: { label: "Pi binary not found.", cta: { label: "Open Setup Wizard", action: "wizard" } },
  WIN_PI_CMD_ONLY: { label: "Windows install incomplete (only pi.cmd found).", cta: { label: "Open Setup Wizard", action: "wizard" } },
  WT_MISSING: { label: "Windows Terminal not installed." },
  TMUX_MISSING: { label: "tmux not installed." },
  PI_CRASHED: { label: "Pi exited immediately. See log below." },
  SPAWN_ERRNO: { label: "OS refused to start pi. See message." },
  PREFLIGHT_FAILED: { label: "Preflight checks failed." },
  REGISTER_TIMEOUT: { label: "Pi started but never connected to the dashboard.", cta: { label: "View log", action: "log" } },
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
      className="mx-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-300"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {hint ? (
            <>
              <span className="font-medium">{hint.label}</span>
              {!code || code !== "PREFLIGHT_FAILED" ? (
                <span className="ml-1 text-red-400/70">{message}</span>
              ) : null}
            </>
          ) : (
            <span>{message}</span>
          )}

          {/* Preflight reasons list */}
          {code === "PREFLIGHT_FAILED" && reasons && reasons.length > 0 && (
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-red-400/80">
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
                  className="text-xs text-red-300 underline hover:text-red-200"
                >
                  {hint.cta.label}
                </button>
              )}
              {hint.cta.action === "log" && (
                <a
                  href="/settings/general"
                  className="text-xs text-red-300 underline hover:text-red-200"
                >
                  {hint.cta.label}
                </a>
              )}
            </div>
          )}

          {/* Stderr tail */}
          {stderr && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-red-400/70 hover:text-red-300">{i18nT("auto.pi_stderr", undefined, "Pi stderr")}</summary>
              <pre className="mt-1 text-[10px] text-red-400/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">{stderr}</pre>
            </details>
          )}
        </div>

        {onDismiss && (
          <button
            data-testid="spawn-error-dismiss"
            onClick={onDismiss}
            className="text-red-400 hover:text-red-300 shrink-0 mt-0.5"
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
    ? `Pi started (PID ${pid}) but never connected to the dashboard within ${timeoutSecs}s.`
    : `Pi started but never connected to the dashboard within ${timeoutSecs}s.`;

  return (
    <div
      data-testid="spawn-timeout-banner"
      className="mx-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-medium">{label}</span>
          {stderr && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-amber-400/70 hover:text-amber-300">{i18nT("auto.pi_stderr", undefined, "Pi stderr")}</summary>
              <pre className="mt-1 text-[10px] text-amber-400/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">{stderr}</pre>
            </details>
          )}
        </div>
        {onDismiss && (
          <button
            data-testid="spawn-timeout-dismiss"
            onClick={onDismiss}
            className="text-amber-400 hover:text-amber-300 shrink-0 mt-0.5"
          >✕</button>
        )}
      </div>
    </div>
  );
}
