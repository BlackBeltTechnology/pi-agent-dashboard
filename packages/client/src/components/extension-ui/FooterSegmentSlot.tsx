/**
 * Phase-2 slot: footer-segment.
 *
 * Renders all `kind: "footer-segment"` descriptors as small inline pills in
 * the session header. Mounted in `SessionHeader.tsx` to the right of the
 * existing git/model info.
 *
 * See change: add-extension-ui-decorations, design.md §6.
 */
import React from "react";
import { Icon } from "@mdi/react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { decoratorsOfKind } from "./decorator-utils.js";
import { resolveMdiIcon } from "../../lib/preview/mdi-icon-lookup.js";

export function FooterSegmentSlot({ session }: { session: Pick<DashboardSession, "uiDecorators"> }) {
  const segments = decoratorsOfKind(session.uiDecorators, "footer-segment");
  if (segments.length === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 mr-1"
      data-testid="footer-segment-slot"
    >
      {segments.map((d) => {
        const iconPath = resolveMdiIcon(d.payload.icon);
        return (
          <span
            key={`${d.namespace}:${d.id}`}
            title={d.payload.tooltip}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] inline-flex items-center gap-0.5"
            data-testid={`footer-segment:${d.namespace}:${d.id}`}
          >
            {iconPath && <Icon path={iconPath} size={0.4} />}
            {d.payload.text}
          </span>
        );
      })}
    </span>
  );
}
