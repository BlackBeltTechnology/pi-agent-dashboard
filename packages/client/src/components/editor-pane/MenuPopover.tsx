/**
 * Anchored `role="menu"` panel: a `Popover` (portal, outside-click + Escape
 * dismissal) around menu items with the shared keyboard model. The first
 * enabled item takes focus on open; Escape refocuses the trigger.
 *
 * See change: scope-anchor-editor-pane-controls (D9).
 */
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { type ReactNode, useEffect, useRef } from "react";
import { enabledMenuItems, handleMenuKeyDown } from "./menu-keys.js";

export interface MenuPopoverProps {
  anchorEl: HTMLElement;
  label: string;
  testId: string;
  onClose: () => void;
  /** Element refocused on Escape (default `anchorEl`). See change: add-file-download. */
  returnFocusTo?: HTMLElement;
  children: ReactNode;
}

const MENU_ITEM_CLASS =
  "flex min-h-7 w-full items-center gap-2 whitespace-nowrap px-3 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-hover)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function MenuPopover({ anchorEl, label, testId, onClose, returnFocusTo, children }: MenuPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    enabledMenuItems(ref.current)[0]?.focus();
  }, []);
  const closeAndRefocus = () => {
    onClose();
    (returnFocusTo ?? anchorEl).focus();
  };
  return (
    <Popover anchorEl={anchorEl} onDismiss={onClose}>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        data-testid={testId}
        onKeyDown={(e) => handleMenuKeyDown(e, ref.current, closeAndRefocus)}
        className="min-w-[200px] overflow-hidden rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
      >
        {children}
      </div>
    </Popover>
  );
}

export interface MenuItemProps {
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
  trailing?: ReactNode;
  /** Muted second line under the label. See change: add-file-download. */
  hint?: ReactNode;
}

export function MenuItem({ label, onSelect, disabled, testId, trailing, hint }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" data-testid={testId} disabled={disabled} onClick={onSelect} className={MENU_ITEM_CLASS}>
      <span className="flex-1">
        {label}
        {hint && <span className="block text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}
