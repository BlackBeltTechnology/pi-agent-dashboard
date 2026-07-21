/**
 * PopoverBoundaryContext — provides the nearest clipping-pane ref to popovers
 * nested inside an offset `overflow` pane (split/board chat pane, session-card
 * rail, resources list). Consumers pass the value to `usePopoverFlip`'s
 * `boundaryRef` so the flip/clamp decision measures the pane edge instead of
 * the viewport. Undefined at the viewport root → hook falls back to the
 * viewport (backward-compatible).
 *
 * Placed instead of deep ref-drilling through App's content tree (design
 * Decision 3: "prefer a small React context over deep drilling").
 *
 * See change: fix-popover-container-clip.
 */
import type React from "react";
import { createContext, useContext } from "react";

const PopoverBoundaryContext = createContext<
  React.RefObject<HTMLElement | null> | undefined
>(undefined);

/** Provide the nearest clipping-pane ref to descendant popovers. */
export const PopoverBoundaryProvider = PopoverBoundaryContext.Provider;

/**
 * Read the nearest popover clipping-boundary ref, or `undefined` when no
 * provider wraps the consumer (viewport root).
 */
export function usePopoverBoundary(): React.RefObject<HTMLElement | null> | undefined {
  return useContext(PopoverBoundaryContext);
}
