/**
 * Access provisioning dialog (change: add-access-provisioning, tasks 3.2, 3.3;
 * mockups/ui-plan.md S1-S3, operator decisions 2026-10-19).
 *
 * `Dialog` in flush mode (size `lg`): fixed title, ONE keyboard-focusable
 * scroll region for the request, and the reach statement + answers pinned below
 * it so they are never past the fold on a 32-line request. Initial focus lands
 * on the built-in close (first focusable), never on an answer.
 *
 * Rules enforced here:
 *   - Nothing is preselected; the only bulk control ticks `grantable` lines on
 *     an explicit click ("Select all that need approval").
 *   - No answer is emphasised: both footer buttons are neutral.
 *   - Dismissal (Escape / backdrop / close / "Reject all") answers every line
 *     rejected, stated in the footer.
 *   - The project name is shown as the requester's CLAIM ("requested for").
 *   - Remote goals only open the Remote access wizard on its landing.
 *   - Reasons and paths render as React text only.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type {
  ProvisionRequestMessage,
  ProvisionResponseMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { mdiShieldAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { severityPill } from "../connectivity/connectivity-ui.js";
import {
  ProvisionConsent,
  ProvisionConsequence,
  ProvisionLines,
  ProvisionRemoteGoals,
  useProvisionAnswer,
} from "./ProvisionRequestParts.js";

export interface ProvisionPromptDialogProps {
  request: ProvisionRequestMessage;
  /** Epoch ms, ticked by the host; drives the static "Expires in N min" pill. */
  now: number;
  /** Other requests waiting behind this one. */
  queued: number;
  /** The per-line answer (D9 wire shape). Dismissal answers every line `reject`. */
  onAnswer(lines: ProvisionResponseMessage["lines"]): void;
}

export function ProvisionPromptDialog({ request, now, queued, onAnswer }: ProvisionPromptDialogProps) {
  const folders = request.lines.length > 0;
  const answer = useProvisionAnswer(request.lines);
  const title = folders
    ? i18nT("provision.title.folders", undefined, "Allow folders for this project?")
    : i18nT("provision.title.remote", undefined, "Open Remote access for this project?");
  const minutes = Math.max(1, Math.ceil((request.expiresAt - now) / 60_000));
  const reject = () => onAnswer(answer.rejectLines());
  const selected = answer.approved.size;

  return (
    <Dialog open onClose={reject} ariaLabel={title} size="lg" flush showClose testId="provision-dialog">
      <div className="flex items-center gap-3 px-5 pt-5 pr-14 shrink-0">
        <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]">
          <Icon path={mdiShieldAlertOutline} size={0.85} aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label={i18nT("provision.bodyLabel", undefined, "Request details")}
        data-testid="provision-body"
        className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={severityPill("neutral", false)}>
            {i18nT("provision.chip.request", undefined, "Provisioning request")}
          </span>
          <span data-testid="provision-expires" className={severityPill("info", false)}>
            {i18nT("provision.expires", { minutes }, "Expires in {minutes} min")}
          </span>
          {queued > 0 && (
            <span data-testid="provision-queued" className="ml-auto text-[var(--text-tertiary)]">
              {i18nT("provision.queued", { count: queued }, "{count} more waiting")}
            </span>
          )}
        </div>

        <div data-testid="provision-claim" className="space-y-1">
          <span className="block text-xs text-[var(--text-tertiary)]">
            {i18nT("provision.claim.label", undefined, "requested for")}
          </span>
          <code
            data-testid="provision-root"
            className="block font-mono text-sm break-all px-2 py-1.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          >
            {request.projectRoot}
          </code>
          <span className="block text-xs text-[var(--text-tertiary)]">
            {folders
              ? i18nT(
                  "provision.claim.noteFolders",
                  undefined,
                  "The project name is the requester's claim; nothing has verified it. Only the folders you tick are approved.",
                )
              : i18nT(
                  "provision.claim.note",
                  undefined,
                  "The project name is the requester's claim; nothing has verified it.",
                )}
          </span>
        </div>

        <ProvisionLines lines={request.lines} answerable answer={answer} />
        <ProvisionRemoteGoals goals={request.remote} />
        {folders && <ProvisionConsent testId="provision-consent-narrow" className="sm:hidden" />}
      </div>

      <div className="shrink-0 border-t border-[var(--border-secondary)] px-5 pt-3 pb-5 space-y-3">
        {folders && <ProvisionConsequence narrowConsentInBody />}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span data-testid="provision-dismiss-note" className="mr-auto text-xs text-[var(--text-tertiary)]">
            {folders
              ? i18nT("provision.footNote.folders", undefined, "Dismissing rejects every folder.")
              : i18nT("provision.footNote.remote", undefined, "Dismissing closes this request.")}
          </span>
          <Dialog.Cancel onClick={reject} testId="provision-reject-all">
            {folders
              ? i18nT("provision.rejectAll", undefined, "Reject all")
              : i18nT("provision.dismiss", undefined, "Dismiss")}
          </Dialog.Cancel>
          {folders && (
            <Dialog.Action
              intent="neutral"
              disabled={selected === 0}
              onClick={() => onAnswer(answer.answerLines())}
              testId="provision-approve"
            >
              {i18nT("provision.approveSelected", { count: selected }, "Approve selected ({count})")}
            </Dialog.Action>
          )}
        </div>
      </div>
    </Dialog>
  );
}
