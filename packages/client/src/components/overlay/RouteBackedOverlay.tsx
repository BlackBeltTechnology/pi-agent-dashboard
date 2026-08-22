/**
 * Route-backed overlay container (design D1, option C).
 *
 * A route-backed overlay points the URL at itself, so the launching route stops
 * matching and cannot render from `window.location`. This component supplies the
 * second, URL-independent rendering source that lets the launching surface stay
 * visible anyway: the underlay is wrapped in a nested wouter `<Router>` whose
 * location hooks are pinned to a FROZEN path via `memoryLocation`.
 *
 * Consequences worth stating, because they are the contract:
 *   - Exactly ONE branch is ever derived from `window.location` — the overlay.
 *     The underlay is derived from the frozen background, which is what keeps
 *     `shell-overlay-route` / `url-routing` true under their amended wording.
 *   - BOTH halves of the location are pinned. `searchHook` matters because
 *     `/folder/:cwd/view?path=`, `/pi-view?url=` and `/pi-resource?path=` carry
 *     query strings; pinning only the path would render a frozen path against
 *     the overlay's own query.
 *   - `static: true` makes the pinned router refuse navigation, so a stray
 *     `navigate` from inside the underlay cannot move it out from under the
 *     overlay.
 *
 * Focus trap, Escape (via the shared escape-stack), backdrop click and the ✕
 * affordance all come from the shared `Dialog` — this component deliberately
 * does not reimplement them.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { type ReactNode, useCallback, useMemo, useRef } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { BackgroundLocation } from "../../lib/nav/overlay-background.js";
import {
  type DismissGuardRegistrar,
  type OverlayDismissGuardApi,
  OverlayDismissGuardContext,
} from "./overlay-dismiss-guard.js";

interface Props {
  /** The frozen location the underlay renders from. */
  background: BackgroundLocation;
  /** The shell subtree to render as the underlay, beneath the scrim. */
  backgroundContent: ReactNode;
  /** Leave this surface. Callers navigate to the background path. */
  onDismiss: () => void;
  /** The overlay surface itself. */
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
  testId?: string;
}

export function RouteBackedOverlay({
  background,
  backgroundContent,
  onDismiss,
  children,
  title,
  ariaLabel,
  testId,
}: Props) {
  // Rebuild only when the frozen location actually changes. An in-overlay
  // navigation must NOT churn this, or the underlay would remount (losing its
  // scroll position, which D1 requires it retain for the overlay's lifetime).
  const pinned = useMemo(
    () =>
      memoryLocation({
        path: background.path,
        searchPath: background.search,
        static: true,
      }),
    [background.path, background.search],
  );

  // R1 — backdrop, Escape and the ✕ are three dismissal gestures a full page
  // never had. A surface with unsaved edits registers here to take them over;
  // everything else dismisses immediately. See `overlay-dismiss-guard.tsx`.
  const guard = useRef<(() => void) | null>(null);
  const register = useCallback<DismissGuardRegistrar>((handler) => {
    guard.current = handler;
  }, []);
  const guardApi = useMemo<OverlayDismissGuardApi>(
    () => ({ register, dismiss: onDismiss }),
    [register, onDismiss],
  );
  const handleClose = useCallback(() => {
    if (guard.current) {
      guard.current();
      return;
    }
    onDismiss();
  }, [onDismiss]);

  return (
    <>
      <div
        data-testid={testId ? `${testId}-underlay` : undefined}
        aria-hidden="true"
        // `inert` removes the whole subtree from focus order and pointer
        // interaction, so tabbing cannot escape the dialog into a surface the
        // user cannot see the state of.
        inert
        className="absolute inset-0 overflow-hidden"
      >
        <Router hook={pinned.hook} searchHook={pinned.searchHook}>
          {backgroundContent}
        </Router>
      </div>
      <Dialog
        open
        onClose={handleClose}
        title={title}
        ariaLabel={ariaLabel}
        size="full"
        flush
        testId={testId}
      >
        <OverlayDismissGuardContext.Provider value={guardApi}>
          {children}
        </OverlayDismissGuardContext.Provider>
      </Dialog>
    </>
  );
}
