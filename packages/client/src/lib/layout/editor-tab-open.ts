/**
 * Client side of `editor_tab_open` (plugin-server-initiated tab open).
 *
 * A client acts ONLY while its current route is the target session's chat
 * (`/session/<id>`) or editor (`/session/<id>/editor`) route; anywhere else
 * (another session, settings/overlays, landing) it ignores the message so a
 * broadcast never yanks the user away. See change: add-browser-editor-pane-tab (D5).
 */
import { openPluginTabRoute } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useEffect, useRef } from "react";

export const EDITOR_TAB_OPEN_EVENT = "editor-tab-open";

/** True when `pathname` is `sessionId`'s chat or editor route. */
export function isOnSessionRoute(pathname: string, sessionId: string): boolean {
  const m = /^\/session\/([^/]+)(\/editor)?\/?$/.exec(pathname);
  if (!m) return false;
  try {
    return decodeURIComponent(m[1]) === sessionId;
  } catch {
    return false;
  }
}

type Navigate = (to: string, opts?: { state?: unknown; replace?: boolean }) => void;

/** Subscribe App to `editor-tab-open` DOM events (dispatched by the WS handler). */
export function useEditorTabOpenListener(pathname: string, navigate: Navigate): void {
  const ref = useRef({ pathname, navigate });
  ref.current = { pathname, navigate };
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ sessionId?: unknown; path?: unknown }>).detail;
      if (!d || typeof d.sessionId !== "string" || typeof d.path !== "string") return;
      if (!isOnSessionRoute(ref.current.pathname, d.sessionId)) return;
      openPluginTabRoute(ref.current.navigate, d.sessionId, [d.path]);
    };
    window.addEventListener(EDITOR_TAB_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(EDITOR_TAB_OPEN_EVENT, onOpen);
  }, []);
}
