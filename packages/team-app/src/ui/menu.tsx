/**
 * APG menu button (menu / menuitem / menuitemradio): Arrow/Home/End/Escape,
 * focus returns to the trigger. Markup + classes mirror the approved mockup.
 * See change: add-team-plugin (A2/A5).
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface MenuItem {
  id: string;
  label?: ReactNode;
  /** Custom row content (selector rows). */
  node?: ReactNode;
  radio?: boolean;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export type MenuEntry = MenuItem | "sep";

export interface MenuButtonProps {
  label: string;
  items: MenuEntry[];
  trigger?: ReactNode;
  triggerClass?: string;
  menuClass?: string;
  menuLabel?: string;
  testId?: string;
  id?: string;
}

export function MenuButton({ label, items, trigger, triggerClass = "btn btn-ghost btn-icon", menuClass, menuLabel, testId, id }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const els = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const list = els();
    (list.find((e) => e.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  if (items.length === 0) return null;

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const list = els();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close(false);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    }
  };

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {trigger}
      </button>
      <ul
        id={menuId}
        ref={listRef}
        className={`menu${menuClass ? ` ${menuClass}` : ""}`}
        role="menu"
        aria-label={menuLabel ?? label}
        hidden={!open}
        onKeyDown={onListKey}
      >
        {items.map((it, i) =>
          it === "sep" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            <li key={`sep-${i}`} role="separator" />
          ) : (
            <li
              key={it.id}
              role={it.radio ? "menuitemradio" : "menuitem"}
              tabIndex={-1}
              className={[it.danger ? "danger" : "", it.disabled ? "is-disabled" : ""].join(" ").trim() || undefined}
              aria-checked={it.radio ? !!it.checked : undefined}
              aria-disabled={it.disabled ? true : undefined}
              data-item={it.id}
              onClick={() => {
                if (it.disabled) return;
                close(true);
                it.onSelect();
              }}
            >
              {it.node ?? it.label}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
