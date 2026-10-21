import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { mdiChevronDown, mdiFlag, mdiPlaylistPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { usePopoverBoundary } from "../../lib/state/PopoverBoundaryContext.js";

/**
 * Composer toolbar delivery control: a `Steer ▾` / `Queue ▾` dropdown chip and
 * the radio items it shares with the `＋` menu (below 26.25rem the states live
 * there instead of a chip). `Enter` follows the chosen state, `Alt+Enter` is
 * always follow-up — the keyboard contract is owned by `CommandInput`.
 * See change: add-composer-dock (D7, tasks 7.1–7.2).
 */
export type DeliveryMode = "steer" | "queue";

// Gap between a portaled popover and its trigger (a portaled panel has no flow sibling).
const POPOVER_GAP = 4;

/** Index the arrow/Home/End key moves focus to, or `null` for any other key. */
function menuTarget(key: string, at: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return at < 0 ? 0 : (at + 1) % count;
    case "ArrowUp":
      return at <= 0 ? count - 1 : at - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Keyboard model for a portaled `role="menu"`: focus enters on open (the
 * checked item, else the first), ArrowUp/Down/Home/End move, Escape closes and
 * returns focus to the trigger, Tab closes. Returns the panel `onKeyDown`.
 */
export function useMenuKeys(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const items = panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
      const checked = panelRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
      (checked ?? items?.[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panelRef]);

  return useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        close();
        return;
      }
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
      const next = items.length === 0 ? null : menuTarget(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
      if (next === null) return;
      e.preventDefault();
      items[next]?.focus();
    },
    [close, panelRef, triggerRef],
  );
}

/** The two delivery states as `menuitemradio`s — shared by the chip's menu and `＋`. */
export function DeliveryRadioItems({
  mode,
  onSelect,
  itemClassName,
}: {
  mode: DeliveryMode;
  onSelect: (mode: DeliveryMode) => void;
  itemClassName: string;
}) {
  const { t } = useI18n();
  const items: Array<{ id: DeliveryMode; icon: string; label: string; description: string; key: string }> = [
    {
      id: "steer",
      icon: mdiFlag,
      label: t("command.steer", undefined, "Steer"),
      description: t("command.steerDescription", undefined, "Interrupts at the next tool boundary"),
      key: "⏎",
    },
    {
      id: "queue",
      icon: mdiPlaylistPlus,
      label: t("command.queue", undefined, "Queue"),
      description: t("command.queueDescription", undefined, "Delivered when the turn ends"),
      key: "⌥⏎",
    },
  ];
  return (
    <>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitemradio"
          aria-checked={mode === it.id}
          onClick={() => onSelect(it.id)}
          data-testid={`delivery-${it.id}`}
          className={`${itemClassName} ${mode === it.id ? "bg-[var(--accent-soft)]" : ""}`}
        >
          <Icon path={it.icon} size={0.7} className="flex-none text-[var(--text-secondary)]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block">{it.label}</span>
            <span className="block text-xs text-[var(--text-secondary)]">{it.description}</span>
          </span>
          <span className="ml-auto text-xs text-[var(--text-secondary)]">{it.key}</span>
        </button>
      ))}
    </>
  );
}

export const DELIVERY_ITEM_CLASS =
  "focus-ring w-full flex items-center gap-2.5 px-3 py-2 min-h-[44px] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-left";

/**
 * The chip. Its text label drops below 40rem (container query, composer card
 * is the `@container`); the accessible name always carries the current state.
 * The menu is horizontal-axis only — two fixed items, no height bound.
 */
export function DeliveryChip({ mode, onSelect }: { mode: DeliveryMode; onSelect: (mode: DeliveryMode) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const boundaryRef = usePopoverBoundary();
  const { anchorRight, maxWidth, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 288,
    preferredAnchor: "left",
    boundaryRef,
  });
  const close = useCallback(() => setOpen(false), []);
  const onPanelKeyDown = useMenuKeys(open, panelRef, triggerRef, close);

  // Panel first: the portaled menu is not a DOM descendant of the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const label = mode === "steer" ? t("command.steer", undefined, "Steer") : t("command.queue", undefined, "Queue");
  const name = t("command.deliveryModeValue", { mode: label }, `Delivery mode: ${label}`);
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring inline-flex items-center justify-center gap-1 px-2 h-[30px] rounded-lg text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        title={name}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="delivery-control"
      >
        <Icon path={mode === "steer" ? mdiFlag : mdiPlaylistPlus} size={0.5} aria-hidden />
        <span className="hidden @[40rem]:inline">{label}</span>
        <Icon path={mdiChevronDown} size={0.5} aria-hidden />
      </button>
      {open && (
        <LayerPortal>
          <div
            ref={panelRef}
            role="menu"
            aria-label={t("command.deliveryMode", undefined, "Delivery mode")}
            onKeyDown={onPanelKeyDown}
            style={{
              position: "fixed",
              width: Math.min(288, maxWidth),
              visibility: triggerRect ? "visible" : "hidden",
              ...(triggerRect
                ? {
                    bottom: Math.round(window.innerHeight - triggerRect.top + POPOVER_GAP),
                    ...(anchorRight
                      ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
                      : { left: Math.round(triggerRect.left) }),
                  }
                : {}),
            }}
            className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-lg z-popover"
            data-testid="delivery-menu"
          >
            <DeliveryRadioItems
              mode={mode}
              itemClassName={DELIVERY_ITEM_CLASS}
              onSelect={(next) => {
                onSelect(next);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            />
          </div>
        </LayerPortal>
      )}
    </div>
  );
}
