/**
 * Spawn error banner component.
 *
 * Renders structured spawn failure info via the shared `InlineMessage`
 * primitive: code→hint mapping, preflight reasons list, stderr in a
 * collapsible `LogBlock`, and — when pi started but never connected — a
 * `severity="warning"` timeout surface (folded in, no separate
 * `TimeoutBanner` component).
 *
 * See change: spawn-failure-diagnostics; redesign-directory-card.
 */

import type { SpawnFailureCode } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { mdiAlertCircleOutline, mdiClockAlertOutline } from "@mdi/js";
import type { SpawnErrorDetail } from "../../hooks/useMessageHandler.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { InlineMessage } from "../primitives/InlineMessage.js";
import { LogBlock } from "../primitives/LogBlock.js";

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
  const { kind, message, code, reasons, stderr } = detail;

  if (kind === "timeout") {
    return <TimeoutSurface detail={detail} onDismiss={onDismiss} />;
  }

  const hint = code ? CODE_HINTS[code] : undefined;
  const title = hint ? i18nT(hint.labelKey, undefined, hint.label) : message;
  const showMessageSub = hint && (!code || code !== "PREFLIGHT_FAILED");

  const actions = hint?.cta ? (
    hint.cta.action === "wizard" ? (
      <button
        type="button"
        onClick={openWizard}
        className="text-xs font-semibold px-2 py-0.5 rounded-full border border-current inline-flex items-center gap-1 bg-[color-mix(in_srgb,currentColor_12%,transparent)]"
      >
        {i18nT(hint.cta.labelKey, undefined, hint.cta.label)}
      </button>
    ) : (
      <a
        href="/settings/general"
        className="text-xs font-semibold px-2 py-0.5 rounded-full border border-current inline-flex items-center gap-1 bg-[color-mix(in_srgb,currentColor_12%,transparent)]"
      >
        {i18nT(hint.cta.labelKey, undefined, hint.cta.label)}
      </a>
    )
  ) : undefined;

  return (
    <div className="mx-2">
      <InlineMessage
        severity="error"
        icon={mdiAlertCircleOutline}
        title={title}
        onDismiss={onDismiss}
        testId="spawn-error-banner"
        dismissTestId="spawn-error-dismiss"
        actions={actions}
      >
        {showMessageSub && <span className="opacity-80">{message}</span>}
        {code === "PREFLIGHT_FAILED" && reasons && reasons.length > 0 && (
          <ul className="mt-1 space-y-0.5 list-disc list-inside opacity-80">
            {reasons.map((r, i) => (
              <li key={i}>{r.message}</li>
            ))}
          </ul>
        )}
        {stderr && (
          <LogBlock
            label={i18nT("terminal.piStderr", undefined, "Pi stderr")}
            text={stderr}
            collapsible
          />
        )}
      </InlineMessage>
    </div>
  );
}

function TimeoutSurface({ detail, onDismiss }: Props) {
  const { pid, stderr, timeoutMs } = detail;
  // Use the timeout value carried in the message; fall back to 30s for legacy servers.
  const timeoutSecs = timeoutMs !== undefined ? timeoutMs / 1000 : 30;

  const label = pid !== undefined
    ? i18nT("err.spawnTimeoutWithPid", { pid, secs: timeoutSecs }, "Pi started (PID {pid}) but never connected to the dashboard within {secs}s.")
    : i18nT("err.spawnTimeout", { secs: timeoutSecs }, "Pi started but never connected to the dashboard within {secs}s.");

  return (
    <div className="mx-2">
      <InlineMessage
        severity="warning"
        icon={mdiClockAlertOutline}
        title={label}
        onDismiss={onDismiss}
        testId="spawn-timeout-banner"
        dismissTestId="spawn-timeout-dismiss"
      >
        {stderr && (
          <LogBlock
            label={i18nT("terminal.piStderr", undefined, "Pi stderr")}
            text={stderr}
            collapsible
          />
        )}
      </InlineMessage>
    </div>
  );
}
