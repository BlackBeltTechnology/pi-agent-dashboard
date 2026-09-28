/**
 * Content-view gate for the selected session (change:
 * fix-browser-live-view-subscribe-and-reopen, design D6).
 *
 * Renders `renderContentView(session)` when ≥1 `content-view` claim's predicate
 * is true for the session, else `renderDetail()`. Subscribes to the
 * slot-claims invalidation store (`useSlotClaimsVersion`) so a plugin
 * predicate flip (`bumpSlotClaimsVersion`) re-evaluates the gate even on an
 * idle session. A leaf component keeps that re-render local instead of
 * re-rendering the whole `App` shell on every plugin bump.
 */
import {
  forSession,
  type SlotRegistry,
  useSlotClaimsVersion,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";

export interface SessionContentGateProps {
  registry: SlotRegistry;
  session: DashboardSession | undefined;
  renderContentView: (session: DashboardSession) => React.ReactNode;
  renderDetail: () => React.ReactNode;
}

export function SessionContentGate({
  registry,
  session,
  renderContentView,
  renderDetail,
}: SessionContentGateProps): React.ReactElement {
  useSlotClaimsVersion();
  const claimed = session !== undefined && forSession(registry.getClaims("content-view"), session).length > 0;
  return <>{claimed ? renderContentView(session) : renderDetail()}</>;
}
