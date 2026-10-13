/**
 * Warning callout for a one-shot role pick that did not apply cleanly
 * (unassigned role, level left unchanged, roles API unavailable). Shared by the
 * composer picker and the OpenSpec run-config row so both read the same.
 * Recipe: severity callout with an icon + `role="status"`; keeps the host's
 * `data-testid` and `data-kind`.
 * See change: retro-ux-model-selector (spec model-selector "resolve a role once").
 */
import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type RolePickNotice, rolePickNoticeText } from "../../lib/roles/useRolePick.js";

export function RolePickNoticeCallout({ notice, testId, className }: { notice: RolePickNotice; testId: string; className?: string }) {
  return (
    <span
      role="status"
      data-testid={testId}
      data-kind={notice.kind}
      className={`inline-flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)] ${className ?? ""}`}
    >
      <Icon path={mdiAlertOutline} size={0.55} className="flex-shrink-0 mt-0.5" aria-hidden />
      <span>{rolePickNoticeText(notice, i18nT)}</span>
    </span>
  );
}
