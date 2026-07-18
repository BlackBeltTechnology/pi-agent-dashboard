import { mdiCheck, mdiPalette } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { THEMES } from "../../lib/theme/themes.js";
import { useThemeContext } from "./ThemeProvider.js";

export function ThemePicker() {
  const { themeName, setThemeName, resolved } = useThemeContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { flipUp, maxHeight } = usePopoverFlip(triggerRef, { open });

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
        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        title={i18nT("common.colorTheme", undefined, "Color theme")}
        data-testid="theme-picker-trigger"
      >
        <Icon path={mdiPalette} size={0.5} />
      </button>

      {open && (
        <div
          style={{ maxHeight }}
          className={`absolute left-0 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-20 min-w-[160px] py-1 ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-testid="theme-picker-dropdown"
        >
          {THEMES.map((theme) => {
            const isActive = theme.id === themeName;
            const colors = resolved === "light" ? theme.light : theme.dark;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  setThemeName(theme.id);
                  setOpen(false);
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
