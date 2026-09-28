/**
 * Phase-2 slot: footer-segment.
 *
 * Renders all `kind: "footer-segment"` descriptors as small inline pills in
 * the session header. Mounted in `SessionHeader.tsx` to the right of the
 * existing git/model info.
 *
 * See change: add-extension-ui-decorations, design.md §6.
 */

import type { DashboardSession, DecoratorDescriptor } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { Icon } from "@mdi/react";
import React from "react";
import { useMdiIconByKey } from "../../lib/preview/mdi-icon-lookup.js";
import { decoratorsOfKind } from "./decorator-utils.js";

export function FooterSegmentSlot({ session }: { session: Pick<DashboardSession, "uiDecorators"> }) {
  const segments = decoratorsOfKind(session.uiDecorators, "footer-segment");
  if (segments.length === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 mr-1"
      data-testid="footer-segment-slot"
    >
      {segments.map((d) => (
        <FooterSegment key={`${d.namespace}:${d.id}`} descriptor={d} />
      ))}
    </span>
  );
}

type FooterSegmentDescriptor = Extract<DecoratorDescriptor, { kind: "footer-segment" }>;

/**
 * One segment. A component (not inline in `.map`) so the icon hook runs once
 * per segment. See change: harden-ios-safari-memory-and-ws-diagnostics.
 */
function FooterSegment({ descriptor: d }: { descriptor: FooterSegmentDescriptor }) {
  const iconPath = useMdiIconByKey(d.payload.icon);
  return (
    <span
      title={d.payload.tooltip}
      className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] inline-flex items-center gap-0.5"
      data-testid={`footer-segment:${d.namespace}:${d.id}`}
    >
      {iconPath && <Icon path={iconPath} size={0.4} />}
      {d.payload.text}
    </span>
  );
}
