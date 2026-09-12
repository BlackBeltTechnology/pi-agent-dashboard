import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * The nearest layer host a `LayerPortal` should portal INTO, overriding the
 * default `document.body`.
 *
 * `body` is the right host only while nothing higher on the layer scale wraps
 * the overlay. Inside a `Dialog` it is wrong: the dialog paints at `z-dialog`
 * with a full-viewport backdrop, so a popover portaled to `body` becomes its
 * SIBLING at the lower `z-popover` — it sinks behind the backdrop and every
 * click on it dismisses the dialog instead. Portaling into the dialog panel
 * keeps the popover inside the dialog's stacking context (so it rides the
 * dialog's rank against the rest of the scale) and inside its focus trap, while
 * still escaping the ancestor stacking contexts INSIDE the dialog.
 *
 * `null` (the default, and the value while a host element is still mounting)
 * means `document.body` — the composer/card case, which must keep escaping all
 * the way out.
 *
 * See change: fix-composer-popover-layering.
 */
export const LayerHostContext = createContext<HTMLElement | null>(null);

export function LayerHostProvider({
  host,
  children,
}: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  return <LayerHostContext.Provider value={host}>{children}</LayerHostContext.Provider>;
}

/**
 * LayerPortal — portals an overlay to the nearest layer host, defaulting to the
 * top-level layer root (`document.body`), so it escapes ALL ancestor stacking
 * contexts (`transform`, `will-change`, `opacity < 1`, `isolation: isolate`, an
 * ancestor's own `z-*`).
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
 * See openspec spec overlay-layering. See change: add-overlay-layering-system,
 * fix-composer-popover-layering.
 */
export function LayerPortal({ children }: { children: ReactNode }) {
  const host = useContext(LayerHostContext);
  return createPortal(children, host ?? document.body);
}
