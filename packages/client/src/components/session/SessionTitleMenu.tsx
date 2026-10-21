/**
 * Desktop title menu: the session title is a menu button. Items (each omitted
 * when its callback is absent): Rename (F2), Reveal in sidebar, Edit tags,
 * separator, Reload transcript (with a one-line description).
 *
 * WAI-ARIA APG menu-button pattern: `aria-haspopup="menu"`, `role="menu"` /
 * `role="menuitem"`, roving focus with Arrow/Home/End, Escape closes and
 * returns focus to the title button. The Reload item keeps
 * `data-testid="refresh-chat"`.
 *
 * See change: reorganize-session-header.
 */
import { mdiChevronDown, mdiDockLeft, mdiHistory, mdiPencilOutline, mdiTagOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  name: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onRename?: () => void;
  onReveal?: () => void;
  onEditTags?: () => void;
  onReload?: () => void;
}

interface Item {
  key: string;
  icon: string;
  label: string;
  description?: string;
  hint?: string;
  testId?: string;
  /** True when the action moves focus itself (rename input, tag input). */
  takesFocus?: boolean;
  run: () => void;
}

export function SessionTitleMenu({ name, buttonRef, onRename, onReveal, onEditTags, onReload }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items: Item[] = [];
  if (onRename) {
    items.push({ key: "rename", icon: mdiPencilOutline, label: i18nT("common.rename", undefined, "Rename"), hint: "F2", takesFocus: true, run: onRename });
  }
  if (onReveal) {
    items.push({
      key: "reveal",
      icon: mdiDockLeft,
      label: i18nT("session.revealInSidebar", undefined, "Reveal in sidebar"),
      description: i18nT("session.revealInSidebarDesc", undefined, "Expand and scroll to this session's card"),
      run: onReveal,
    });
  }
  if (onEditTags) {
    items.push({ key: "tags", icon: mdiTagOutline, label: i18nT("session.editTags", undefined, "Edit tags"), takesFocus: true, run: onEditTags });
  }
  const separatorBeforeReload = items.length > 0 && !!onReload;
  if (onReload) {
    items.push({
      key: "reload",
      icon: mdiHistory,
      label: i18nT("session.reloadTranscript", undefined, "Reload transcript"),
      description: i18nT("session.reloadTranscriptDesc", undefined, "Re-fetch every event from the server. Use it when the chat looks stale."),
      testId: "refresh-chat",
      run: onReload,
    });
  }

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onOutside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const focusItem = (index: number) => {
    const n = items.length;
    itemRefs.current[(index + n) % n]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const activate = (item: Item) => {
    close(!item.takesFocus);
    try {
      item.run();
    } catch (err) {
      // A throwing action must not take the header down with it.
      console.error("[session-title-menu] action failed", err);
    }
  };

  const hasMenu = items.length > 0;

  return (
    <div ref={wrapRef} className="relative min-w-0 max-w-full">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup={hasMenu ? "menu" : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={name}
        data-testid="session-title-menu"
        onClick={() => hasMenu && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (hasMenu && e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex items-center gap-0.5 min-h-8 px-1.5 rounded-md min-w-0 max-w-full text-base font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
          open ? "bg-[var(--bg-tertiary)]" : ""
        }`}
      >
        <span className="min-w-[6ch] truncate" data-testid="session-title-text">
          {name}
        </span>
        {hasMenu && <Icon path={mdiChevronDown} size={0.75} className="shrink-0 text-[var(--text-secondary)]" />}
      </button>
      {open && hasMenu && (
        <div
          role="menu"
          aria-label={i18nT("session.titleMenu", undefined, "Session")}
          data-testid="session-title-menu-list"
          className="absolute left-0 top-full mt-1 z-popover min-w-60 max-w-80 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <div key={item.key} role="none">
              {item.key === "reload" && separatorBeforeReload && (
                <hr className="my-1 border-0 border-t border-[var(--border-secondary)]" />
              )}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-testid={item.testId}
                onClick={() => activate(item)}
                onKeyDown={(e) => onMenuKeyDown(e, i)}
                className="flex w-full items-start gap-2 min-h-9 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]"
              >
                <Icon path={item.icon} size={0.75} className="mt-px shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0">
                  {item.label}
                  {item.description && <span className="block text-xs text-[var(--text-secondary)]">{item.description}</span>}
                </span>
                {item.hint && <span className="ml-auto text-xs text-[var(--text-secondary)]">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
