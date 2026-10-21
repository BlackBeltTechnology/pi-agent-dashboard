/**
 * Context lane adapter for the composer dock.
 *
 * Hosts the read-only plugin context groups (`composer-context-group`, e.g.
 * Quota) and the Status group (`session-card-badge` claims). It renders when a
 * claim of either slot applies to the session, is never expandable, and its
 * header IS the groups (they are interactive, so they sit in the header's
 * actions, never inside a disclosure control).
 *
 * - `composer-context-group` contributions are NEVER working-gated: usage and
 *   context must stay live exactly while the session runs.
 * - The Status group keeps its working gate: its content element is a
 *   `<fieldset disabled={working}>`, which natively disables every plugin
 *   control while the session is working.
 * - Claims that render nothing add no DOM; a Status group whose content element
 *   is empty hides itself (index.css) and the lane hides while nothing visible
 *   remains (`hideWhenEmpty`), so an empty lane leaves no label or container.
 *
 * See changes: move-quota-to-context-strip, add-composer-dock (task 6.2).
 */
import {
  ComposerContextGroupSlot,
  SessionCardBadgeSlot,
  ToolbarGroup,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiViewDashboardOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t } from "../../lib/i18n/i18n.js";
import { type DockLane, dockLaneLabel } from "./composer-dock-model.js";

export interface ContextLaneInput {
  session: DashboardSession | undefined;
  /** `isComposerWorking(status, retrying)`: disables the Status group only. */
  working: boolean;
}

export function useContextLane({ session, working }: ContextLaneInput): DockLane | null {
  // Hooks run unconditionally.
  const safeSession = session ?? (undefined as unknown as DashboardSession);
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", safeSession);
  const hasContextGroup = useSlotHasClaimsForSession("composer-context-group", safeSession);
  if (!session || (!hasBadge && !hasContextGroup)) return null;
  return {
    key: "context",
    label: dockLaneLabel("context"),
    icon: <Icon path={mdiViewDashboardOutline} size={0.7} />,
    title: "",
    summary: dockLaneLabel("context"),
    summaryText: t("dock.context.summary", undefined, "plugin context"),
    expandable: false,
    hideWhenEmpty: true,
    actions: (
      <>
        {hasContextGroup && <ComposerContextGroupSlot session={session} />}
        {hasBadge && (
          <ToolbarGroup
            label={t("session.subcardStatus", undefined, "STATUS")}
            testId="composer-status-container"
            labelTestId="composer-status-group-label"
            contentAs="fieldset"
            contentProps={{ disabled: working, "data-testid": "composer-status-group" }}
          >
            <SessionCardBadgeSlot session={session} />
          </ToolbarGroup>
        )}
      </>
    ),
  };
}
