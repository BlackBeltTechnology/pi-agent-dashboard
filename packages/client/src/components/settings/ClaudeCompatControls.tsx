/**
 * Claude subscription compat UI: the post-sign-in prompt, the anthropic-row
 * switch, and the one-time "you can uninstall pi-anthropic-messages" notice.
 *
 * All three read and write the shared `claudeCompatStore`. A failed save
 * reverts the switch; the caller's `onSaveFailed` shows the error toast.
 * Copy scopes the switch to the `anthropic` provider.
 *
 * See change: retire-anthropic-messages-bridge.
 */
import { mdiInformationOutline } from "@mdi/js";
import { useEffect, useState } from "react";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { claudeCompatStore, useClaudeCompat } from "../../lib/claude-compat/claude-compat-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { usePluginAvailability } from "../../lib/plugins/plugin-availability.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

/** ui-contract secondary-button recipe (never the primary treatment). */
export const SECONDARY_BUTTON_CLASS =
  "focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] disabled:opacity-60";

const PRIMARY_BUTTON_CLASS =
  "focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold text-[12px] disabled:opacity-60";

/** Toast text for a failed switch save (shared by every surface). */
export function compatSaveFailedText(): string {
  return i18nT("claudeCompat.saveFailed", undefined, "Claude subscription compat change was not saved");
}

/**
 * Asked once per Anthropic subscription sign-in completion while the switch is
 * off (or unreadable). Non-blocking: inline, never a modal. Stays open after a
 * failed save so the user can try again.
 */
export function ClaudeCompatSignInPrompt({
  onClose,
  onSaveFailed,
}: {
  onClose: () => void;
  onSaveFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    const saved = await claudeCompatStore.set(true);
    setBusy(false);
    if (saved) onClose();
    else onSaveFailed();
  };
  return (
    <div role="status" aria-live="polite" className="mb-3">
      <InlineMessage
        severity="info"
        icon={mdiInformationOutline}
        testId="claude-compat-prompt"
        title={i18nT("claudeCompat.promptTitle", undefined, "Keep Claude requests on your subscription?")}
        actions={
          <>
            <button
              type="button"
              data-testid="claude-compat-prompt-turn-on"
              onClick={() => void turnOn()}
              disabled={busy}
              className={PRIMARY_BUTTON_CLASS}
            >
              {i18nT("claudeCompat.turnOn", undefined, "Turn on")}
            </button>
            <button
              type="button"
              data-testid="claude-compat-prompt-not-now"
              onClick={onClose}
              disabled={busy}
              className={SECONDARY_BUTTON_CLASS}
            >
              {i18nT("claudeCompat.notNow", undefined, "Not now")}
            </button>
          </>
        }
      >
        {i18nT(
          "claudeCompat.promptBody",
          undefined,
          "Applies to the anthropic provider. pi's default instructions name pi in two lines, which Anthropic bills as extra usage. Turning this on rewords those two lines.",
        )}
      </InlineMessage>
    </div>
  );
}

/** State + switch on the authenticated anthropic subscription row. */
export function ClaudeCompatRowControl({ onSaveFailed }: { onSaveFailed: () => void }) {
  const { value } = useClaudeCompat();
  const flowsUnavailable = usePluginAvailability().isUnavailable("flows");
  useEffect(() => {
    void claudeCompatStore.read();
  }, []);
  const on = value === true;
  const toggle = async () => {
    const saved = await claudeCompatStore.set(!on);
    if (!saved) onSaveFailed();
  };
  const label = i18nT("claudeCompat.switchLabel", undefined, "Claude subscription compat");
  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="claude-compat-row">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          data-testid="claude-compat-switch"
          onClick={() => void toggle()}
          className={`focus-ring relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--accent-blue)]" : "bg-[var(--border-secondary)]"}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mt-0.75 ${on ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
        <span className="text-[12px] text-[var(--text-secondary)]">
          {label}:{" "}
          {on ? i18nT("claudeCompat.stateOn", undefined, "on") : i18nT("claudeCompat.stateOff", undefined, "off")}
        </span>
      </div>
      {flowsUnavailable && (
        <span data-testid="claude-compat-needs-flows" className="text-[12px] text-[var(--text-secondary)]">
          {i18nT("claudeCompat.needsFlows", undefined, "Needs the Flows plugin to take effect.")}
        </span>
      )}
    </div>
  );
}

const PACKAGE_NAMES = new Set(["@blackbelt-technology/pi-anthropic-messages", "@pi/anthropic-messages"]);

/** True when an installed-package `source` is pi-anthropic-messages (normalized name, exact match). */
export function isAnthropicMessagesSource(source: string): boolean {
  let name = source.trim().replace(/^npm:/, "");
  // Drop a version suffix: `@scope/pkg@1.2.3` / `pkg@1.2.3`.
  const at = name.indexOf("@", name.startsWith("@") ? 1 : 0);
  if (at > 0) name = name.slice(0, at);
  return PACKAGE_NAMES.has(name);
}

const DISMISS_KEY = "pi-dashboard.claudeCompat.uninstallNoticeDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/** Shown while the switch is on and the old package is still installed; dismissal is per browser. */
export function ClaudeCompatUninstallNotice() {
  const { value } = useClaudeCompat();
  const { packages } = useInstalledPackages("global");
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || value !== true) return null;
  if (!Array.isArray(packages) || !packages.some((p) => isAnthropicMessagesSource(p.source))) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* private mode: dismiss for this page only */
    }
    setDismissed(true);
  };
  return (
    <div className="mb-3">
      <InlineMessage
        severity="info"
        icon={mdiInformationOutline}
        testId="claude-compat-uninstall-notice"
        title={i18nT("claudeCompat.uninstallTitle", undefined, "pi-anthropic-messages is no longer needed")}
        onDismiss={dismiss}
      >
        {i18nT(
          "claudeCompat.uninstallBody",
          undefined,
          "Claude subscription compat now does its job. You can uninstall pi-anthropic-messages from Extensions.",
        )}
      </InlineMessage>
    </div>
  );
}
