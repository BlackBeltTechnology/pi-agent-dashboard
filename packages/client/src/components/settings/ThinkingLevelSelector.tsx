import { mdiHeadLightbulb } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useId, useRef, useState } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { usePopoverBoundary } from "../../lib/state/PopoverBoundaryContext.js";

// Canonical render order. `max` is opt-in: it only renders when the model's
// `supportedLevels` explicitly includes it (a max-capable session runtime +
// native `thinkingLevelMap.max`). The undefined/empty FALLBACK stays the six
// levels below `max` — see `FALLBACK_LEVELS`. See change: honor-native-models-json-metadata.
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const FALLBACK_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

interface Props {
  current?: string;
  onSelect: (level: string) => void;
  /**
   * Levels this model supports (pi 0.72+ per-model thinkingLevelMap). When
   * provided, only these render (canonical order preserved). Undefined or
   * empty → all canonical levels. See change: adopt-pi-071-072-073-features.
   */
  supportedLevels?: string[];
}

export function ThinkingLevelSelector({ current, onSelect, supportedLevels }: Props) {
  const { t } = useI18n();
  const levelsToRender = supportedLevels?.length
    ? THINKING_LEVELS.filter((l) => supportedLevels.includes(l))
    : FALLBACK_LEVELS;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownId = useId();
  // In the composer/chat pane (NOT immune): measure against that offset
  // `overflow` pane, left-preserving. See change: fix-popover-container-clip.
  const boundaryRef = usePopoverBoundary();
  const { flipUp, maxHeight, minHeight, anchorRight } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 128, // w-32 natural width
    preferredAnchor: "left",
    boundaryRef,
  });

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative" data-testid="thinking-level-selector">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        data-testid="thinking-level-button"
        aria-label={t("thinking.level", undefined, "Thinking level")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? dropdownId : undefined}
      >
        <span className="font-mono truncate flex items-center gap-1"><Icon path={mdiHeadLightbulb} size={0.5} /> {current ?? "off"}</span>
      </button>
      {open && (
        <div
          className={`absolute w-32 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-50 overflow-hidden ${
            anchorRight ? "right-0" : "left-0"
          } ${flipUp ? "bottom-full mb-1" : "top-full mt-1"}`}
          data-testid="thinking-level-dropdown"
          id={dropdownId}
          role="listbox"
        >
          <div className="overflow-y-auto" style={{ maxHeight, minHeight }}>
            {levelsToRender.map((level) => (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={level === current}
                onClick={() => {
                  onSelect(level);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 md:py-1.5 min-h-[44px] md:min-h-0 text-xs font-mono hover:bg-[var(--bg-tertiary)] transition-colors ${
                  level === current ? "text-[var(--accent-text)] font-bold" : "text-[var(--text-secondary)]"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
