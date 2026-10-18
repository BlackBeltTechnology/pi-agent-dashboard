import type { OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertCircleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Error badge for a change whose `openspec status --all` entry carries an
 * `error` (invalid `.openspec.yaml`, unknown schema, …). Focusable so the full
 * (server-capped, single-line) message is reachable by keyboard as well as by
 * hover (`title`); the accessible label carries the message. Pointer events
 * stop here so a card's drag listeners never swallow the hover/focus target.
 * See change: use-openspec-status-all.
 */
export function OpenSpecErrorBadge({ error }: { error: NonNullable<OpenSpecChange["error"]> }) {
  const label = i18nT("openspec.changeErrorLabel", { message: error.message }, "Error: {message}");
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      title={error.message}
      data-testid="openspec-error-badge"
      data-error-code={error.code}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="focus-ring inline-flex flex-none items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium leading-none bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]"
    >
      <Icon path={mdiAlertCircleOutline} size={0.4} aria-hidden="true" />
      {i18nT("openspec.changeError", undefined, "Error")}
    </span>
  );
}
