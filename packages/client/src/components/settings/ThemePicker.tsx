import { mdiCheck, mdiPalette } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { THEMES } from "../../lib/theme/themes.js";
import { useThemeContext } from "./ThemeProvider.js";
import { ThemeToggle } from "./ThemeToggle.js";

export function ThemePicker() {
  const { themeName, setThemeName, resolved } = useThemeContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Set on a keyboard open: focus lands on the pressed mode button once the panel mounts. */
  const pendingFocus = useRef(false);
  const { flipUp, maxHeight, minHeight, anchorRight, maxWidth } = usePopoverFlip(triggerRef, {
    open,
    preferredAnchor: "left",
    estimatedWidth: 200,
  });

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open && pendingFocus.current) {
      pendingFocus.current = false;
      ref.current?.querySelector<HTMLElement>('[data-testid="theme-toggle"] [aria-pressed="true"]')?.focus();
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref} data-testid="theme-picker">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            pendingFocus.current = true;
            setOpen(true);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            closeToTrigger();
          }
        }}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
        aria-haspopup="true"
        aria-expanded={open}
        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        title={i18nT("common.appearance", undefined, "Appearance")}
        aria-label={i18nT("common.appearance", undefined, "Appearance")}
        data-testid="theme-picker-trigger"
      >
        <Icon path={mdiPalette} size={0.5} />
      </button>

      {/* Structurally immune — re-audited for fix-popover-pane-bounded-height
          (task 5.6) after panes started provisioning boundaries. ThemePicker's
          only mount is the SessionList header bar, a sibling ABOVE that view's
          scroll list, so no `overflow` pane encloses it on either axis and it
          keeps the viewport measurement (no boundaryRef).
          First audited in fix-popover-container-clip. */}
      {open && (
        <div
          style={{ maxHeight, minHeight, maxWidth }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeToTrigger();
            }
          }}
          className={`absolute ${anchorRight ? "right-0" : "left-0"} overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-20 min-w-[160px] py-1 ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-testid="theme-picker-dropdown"
        >
          <div className="px-3 pb-1 pt-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {i18nT("common.appearanceMode", undefined, "Mode")}
            </div>
            <ThemeToggle />
          </div>
          <div className="my-1 border-t border-[var(--border-secondary)]" role="presentation" />
          {THEMES.map((theme) => {
            const isActive = theme.id === themeName;
            const colors = resolved === "light" ? theme.light : theme.dark;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  setThemeName(theme.id);
                  closeToTrigger();
                }}
                className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-hover)] ${
                  isActive ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"
                }`}
                data-testid={`theme-option-${theme.id}`}
              >
                {/* Color swatches */}
                <span className="flex gap-0.5">
                  <span
                    className="w-3 h-3 rounded-full border border-[var(--border-subtle)]"
                    style={{ backgroundColor: colors["--bg-primary"] }}
                  />
                  <span
                    className="w-3 h-3 rounded-full border border-[var(--border-subtle)]"
                    style={{ backgroundColor: colors["--accent-blue"] }}
                  />
                </span>
                <span className="flex-1">{theme.name}</span>
                {isActive && (
                  <Icon path={mdiCheck} size={0.5} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
