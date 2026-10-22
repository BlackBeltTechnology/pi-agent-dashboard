/**
 * Collapse / peek state machine of the composer dock (`ComposerDock`).
 *
 * Owns, for one dock: the per-session collapsed bit (`useDockCollapsed`), the transient peek
 * (belongs to one session, never stored, ended by a rebind, Escape, a modal dialog or a row
 * target), the hover-intent wiring (`useDockHoverIntent`), the overlay height, focus hand-off
 * (bar → Hide on expand, Hide → bar on collapse) and the post-Hide / post-Escape cooldown that
 * stops the pointer resting on the new bar from re-peeking it at once.
 *
 * Elements are read through refs the caller attaches; nothing here renders.
 *
 * See change: composer-dock-collapse-and-file-open (D1, D3).
 */
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDockCollapsed } from "../../lib/util/dock-collapsed.js";
import { useDockHoverIntent } from "./useDockHoverIntent.js";

/** A click- or keyboard-opened dock popover (also one portaled out of the dock). */
const OPEN_POPOVER = '[aria-haspopup][aria-expanded="true"]';
const MODAL_DIALOG = '[role="dialog"][aria-modal="true"]';
/** Peek height when the column element is unknown (tests / unmounted anchor). */
const PEEK_MAX_FALLBACK = "70vh";

/** A modal dialog is open: an `aria-modal` dialog, or a `DialogPortal` (it locks body scroll while open). */
const isModalOpen = () => document.querySelector(MODAL_DIALOG) !== null || document.body.style.overflow === "hidden";

interface DockElements {
  root: { current: HTMLDivElement | null };
  /** The lane region (the peek overlay when peeked). */
  region: { current: HTMLDivElement | null };
  bar: { current: HTMLButtonElement | null };
  pin: { current: HTMLButtonElement | null };
  hide: { current: HTMLButtonElement | null };
}

export interface UseDockCollapseInput {
  sessionId: string;
  /** Live for the session the editor pane serves; otherwise read-only (no write, no peek). */
  live: boolean;
  /** At least one lane renders something (else there is nothing to collapse). */
  hasVisibleLane: boolean;
  columnEl?: HTMLElement | null;
  els: DockElements;
}

export function useDockCollapse({ sessionId, live, hasVisibleLane, columnEl, els }: UseDockCollapseInput) {
  const [storedCollapsed, setCollapsed] = useDockCollapsed(sessionId, live);
  const [peekSession, setPeekSession] = useState<string | null>(null);
  const focusHideRef = useRef(false);
  const focusBarRef = useRef(false);
  const cooldownRef = useRef(false);

  const collapsed = storedCollapsed && hasVisibleLane;
  const canHover = live && collapsed && sessionId !== "";
  const peeking = canHover && peekSession === sessionId;
  const endPeek = useCallback(() => setPeekSession(null), []);

  // Rebinding to another session ends any peek (returning to a session never resurrects one).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the bound session
  useEffect(() => {
    setPeekSession(null);
  }, [sessionId]);

  const hasPopoverOpen = () => !!els.root.current?.querySelector(OPEN_POPOVER);
  useDockHoverIntent({
    enabled: canHover,
    peeking,
    host: {
      suppressed: () => cooldownRef.current || hasPopoverOpen() || isModalOpen(),
      isBar: (target) => !!target && !!els.bar.current?.contains(target),
      isInside: (target) => !!target && !!els.root.current?.contains(target),
      held: () => {
        const overlay = els.region.current;
        if (overlay?.querySelector(OPEN_POPOVER)) return true;
        const active = document.activeElement;
        return !!active && (!!overlay?.contains(active) || !!els.pin.current?.contains(active));
      },
      open: () => setPeekSession(sessionId),
      close: () => setPeekSession(null),
      pointerLeftBar: () => {
        cooldownRef.current = false;
      },
    },
  });

  // A modal dialog opening returns a peeked dock to collapsed.
  useEffect(() => {
    if (!peeking) return;
    const check = () => {
      if (isModalOpen()) setPeekSession(null);
    };
    const tree = new MutationObserver(check);
    tree.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "role"] });
    // `DialogPortal` locks scroll through the body's own style (no subtree needed).
    const bodyStyle = new MutationObserver(check);
    bodyStyle.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => {
      tree.disconnect();
      bodyStyle.disconnect();
    };
  }, [peeking]);

  // The overlay may grow up to the top of the chat column, and scrolls internally past that.
  // Imperative (no state): a peek is exactly one React commit.
  useLayoutEffect(() => {
    const region = els.region.current;
    if (!peeking || !region) return;
    const columnTop = columnEl?.getBoundingClientRect().top;
    const rootTop = els.root.current?.getBoundingClientRect().top;
    region.style.maxHeight =
      rootTop !== undefined && columnTop !== undefined ? `${Math.max(0, Math.floor(rootTop - columnTop))}px` : PEEK_MAX_FALLBACK;
    return () => {
      region.style.maxHeight = "";
    };
  }, [peeking, columnEl, els.region, els.root]);

  const expand = useCallback(() => {
    focusHideRef.current = true;
    setPeekSession(null);
    setCollapsed(false);
  }, [setCollapsed]);
  const hide = useCallback(() => {
    focusBarRef.current = true;
    // The bar lands under the pointer: don't peek until the pointer has left it once.
    cooldownRef.current = true;
    setCollapsed(true);
  }, [setCollapsed]);
  useLayoutEffect(() => {
    if (!collapsed && focusHideRef.current) {
      focusHideRef.current = false;
      els.hide.current?.focus();
    }
    if (collapsed && focusBarRef.current) {
      focusBarRef.current = false;
      els.bar.current?.focus();
    }
  }, [collapsed, els.bar, els.hide]);

  // Escape: an open dock menu handles it first; only then (focus on the bar or inside the
  // overlay) it closes the peek. Escape elsewhere (the composer) is never consumed.
  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !peeking || hasPopoverOpen()) return;
    if (!els.root.current?.contains(e.target as Node)) return;
    e.stopPropagation();
    cooldownRef.current = true;
    setPeekSession(null);
    els.bar.current?.focus();
  };

  return { collapsed, peeking, expand, hide, endPeek, onRootKeyDown };
}
