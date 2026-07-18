import React, { useState, useRef, useEffect } from "react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { Icon } from "@mdi/react";
import { mdiHeadLightbulb } from "@mdi/js";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

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
  const levelsToRender = supportedLevels?.length
    ? THINKING_LEVELS.filter((l) => supportedLevels.includes(l))
    : THINKING_LEVELS;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { flipUp, maxHeight } = usePopoverFlip(triggerRef, { open });

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
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        data-testid="thinking-level-button"
      >
        <span className="font-mono truncate flex items-center gap-1"><Icon path={mdiHeadLightbulb} size={0.5} /> {current ?? "off"}</span>
      </button>
      {open && (
        <div
          className={`absolute left-0 w-32 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-50 overflow-hidden ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-testid="thinking-level-dropdown"
        >
          <div className="overflow-y-auto" style={{ maxHeight }}>
            {levelsToRender.map((level) => (
              <button
                key={level}
                onClick={() => {
                  onSelect(level);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 md:py-1.5 min-h-[44px] md:min-h-0 text-xs font-mono hover:bg-[var(--bg-tertiary)] transition-colors ${
                  level === current ? "text-[var(--accent)] font-bold" : "text-[var(--text-secondary)]"
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
