import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * LayerPortal — portals an overlay to the top-level layer root (`document.body`)
 * so it escapes ALL ancestor stacking contexts (`transform`, `will-change`,
 * `opacity < 1`, `isolation: isolate`, an ancestor's own `z-*`).
 *
 * This is the mechanism the `overlay-layering` spec calls "portal-or-perish":
 * a numeric z-index only orders siblings WITHIN the nearest ancestor stacking
 * context, so an inline `position:absolute` overlay is trapped and can UNDERLAP
 * a sibling (e.g. a `SessionCard` — it sets `isolate`). Portaling removes the
 * overlay from those contexts; the `z-*` layer token then orders it against the
 * other portaled layers.
 *
 * Companion of `DialogPortal`, which does the same portal but ALSO locks body
 * scroll (`overflow: hidden`) — correct for a full-screen modal, WRONG for a
 * menu/popover/dropdown, which must not freeze the page behind it. Use
 * `DialogPortal` for modals; use `LayerPortal` for everything else that escapes
 * its box. The portaled surface positions itself (`position: fixed`) from its
 * trigger's viewport rect and carries a `z-*` layer utility.
 *
 * See openspec spec overlay-layering. See change: add-overlay-layering-system.
 */
export function LayerPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
