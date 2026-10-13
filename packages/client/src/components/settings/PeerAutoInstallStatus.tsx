/**
 * Status of the automatic `pi-anthropic-messages` install, shared by the
 * Anthropic provider row and the Landing Step ① done row.
 *
 * Renders content only; each caller owns ONE persistent `role="status"`
 * `aria-live="polite"` wrapper so a change is announced (`InlineMessage` has no
 * live-region semantics). A failure is a warning (sign-in succeeded and the
 * problem is recoverable): plain sentence first, raw installer output only in
 * a collapsed `LogBlock`.
 *
 * See change: streamline-first-run (design D3b, D7).
 */
import { mdiAlert, mdiCheck, mdiInformationOutline } from "@mdi/js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { PeerAutoInstallOutcome } from "../../lib/package/peer-auto-install-store.js";
import { InlineMessage } from "../primitives/InlineMessage.js";
import { LogBlock } from "../primitives/LogBlock.js";

/** ui-contract secondary-button recipe (the primary treatment stays with the step CTA). */
export const SECONDARY_BUTTON_CLASS =
  "focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px] text-[12px] disabled:opacity-60";

export function PeerAutoInstallStatus({
  outcome,
  message,
  onRetry,
  testId,
  retryTestId,
}: {
  outcome: PeerAutoInstallOutcome;
  message?: string;
  onRetry: () => void;
  testId: string;
  retryTestId: string;
}) {
  if (outcome === "deciding" || outcome === "running") {
    return (
      <InlineMessage
        severity="info"
        icon={mdiInformationOutline}
        testId={testId}
        animate
        title={i18nT("providers.peerAutoInstallInstalling", undefined, "Installing pi-anthropic-messages…")}
      />
    );
  }
  if (outcome === "installed") {
    return (
      <InlineMessage
        severity="info"
        icon={mdiCheck}
        testId={testId}
        title={i18nT("providers.anthropicPeerInstalled", undefined, "Peer installed — applies on the next pi session start")}
      />
    );
  }
  return (
    <InlineMessage
      severity="warning"
      icon={mdiAlert}
      testId={testId}
      title={i18nT("providers.peerAutoInstallFailedTitle", undefined, "Couldn't install pi-anthropic-messages")}
      actions={
        <button type="button" data-testid={retryTestId} onClick={onRetry} className={SECONDARY_BUTTON_CLASS}>
          {i18nT("providers.peerAutoInstallRetry", undefined, "Retry install")}
        </button>
      }
    >
      <div>
        {i18nT(
          "providers.peerAutoInstallFailedBody",
          undefined,
          "The install didn't finish. Try again; if it keeps failing, check your network or proxy. Chat with Claude works; tool calls need this package.",
        )}
      </div>
      <LogBlock
        collapsible
        defaultOpen={false}
        label={i18nT("providers.peerAutoInstallDetails", undefined, "Details")}
        text={message ?? ""}
      />
    </InlineMessage>
  );
}
