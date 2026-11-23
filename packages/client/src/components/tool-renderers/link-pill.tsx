import type React from "react";
import { LinkIconSlot } from "./LinkIconSlot.js";

/**
 * Shared chrome for transcript link pills (render-file-links-as-pill, render-web-links-as-pill): one atomic inline
 * box that never breaks inside. Inside an inline `code` chip the pill drops its own chrome (no chip-in-chip).
 */
export const PILL_BASE =
  "inline-flex items-center max-w-full min-w-0 whitespace-nowrap align-[-0.2em] mx-[0.1em] " +
  "rounded-full border px-[0.5em] leading-[1.45] text-[0.92em] " +
  "[code_&]:border-0 [code_&]:bg-transparent [code_&]:px-0 [code_&]:mx-0 [code_&]:text-[1em]";

/** A transcript web link: same tokens as a found file link; the `<a>` itself is the pill. */
export const WEB_PILL = `${PILL_BASE} border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--link)] hover:border-[var(--link)]`;

/** Web link label: truncates at the END so scheme + host stay visible (file links truncate at the start instead). */
export function WebLinkLabel({ children }: { children: React.ReactNode }) {
  return (
    <span data-web-link-label="" className="truncate min-w-0">
      {children}
    </span>
  );
}

/** Pill class for a web anchor: the pill in the transcript (`rich`), else the anchor's own plain class. */
export function webLinkClass(rich: boolean, plain: string): string {
  return rich ? WEB_PILL : plain;
}

/** Provider icon + end-truncating label: the content of a transcript web-link pill. */
export function WebLinkBody({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <>
      <LinkIconSlot glyph={icon} />
      <WebLinkLabel>{children}</WebLinkLabel>
    </>
  );
}
