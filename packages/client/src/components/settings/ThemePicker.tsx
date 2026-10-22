import { mdiBrightness6 } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { THEMES } from "../../lib/theme/themes.js";
import { HEADER_ICON_BTN, HEADER_ICON_SIZE } from "../primitives/header-icon-button.js";
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
    estimatedWidth: 300,
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
            if (open) {
              // Already open (mouse): the focus effect won't re-run, so move focus now.
              ref.current?.querySelector<HTMLElement>('[data-testid="theme-toggle"] [aria-pressed="true"]')?.focus();
            } else {
              pendingFocus.current = true;
              setOpen(true);
            }
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            closeToTrigger();
          }
        }}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
        aria-haspopup="true"
        aria-expanded={open}
        className={HEADER_ICON_BTN}
        title={i18nT("common.appearance", undefined, "Appearance")}
        aria-label={i18nT("common.appearance", undefined, "Appearance")}
        data-testid="theme-picker-trigger"
      >
        <Icon path={mdiBrightness6} size={HEADER_ICON_SIZE} />
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
          className={`@container absolute ${anchorRight ? "right-0" : "left-0"} z-20 flex w-[300px] flex-col rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1.5 shadow-lg ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-testid="theme-picker-dropdown"
        >
          <div className="px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {i18nT("common.appearanceMode", undefined, "Mode")}
          </div>
          <ThemeToggle />
          <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {i18nT("common.appearancePalette", undefined, "Palette")}
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-0.5 overflow-y-auto @max-[239.98px]:grid-cols-1" data-testid="theme-palette-grid">
            {THEMES.map((theme) => {
              const isActive = theme.id === themeName;
              const colors = resolved === "light" ? theme.light : theme.dark;
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setThemeName(theme.id);
                    closeToTrigger();
                  }}
                  className="focus-ring flex min-h-9 min-w-0 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:font-semibold max-sm:min-h-11"
                  data-testid={`theme-option-${theme.id}`}
                >
                  {/* Split swatch: palette background | accent, outlined so a panel-coloured half stays visible. */}
                  <span className="flex h-3.5 w-[18px] shrink-0 overflow-hidden rounded-sm ring-1 ring-inset ring-[var(--border-secondary)]" aria-hidden="true">
                    <span className="h-full w-1/2" data-testid="theme-swatch-bg" style={{ backgroundColor: colors["--bg-primary"] }} />
                    <span className="h-full w-1/2" data-testid="theme-swatch-accent" style={{ backgroundColor: colors["--accent-blue"] }} />
                  </span>
                  <span className="min-w-0 truncate" data-testid="theme-name-label">{theme.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
