import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
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

// Trigger→panel gap for the portaled `fixed` panel — replaces the `mt-1` /
// `mb-1` the inline form got from flow. See change: fix-composer-popover-layering.
const GAP = 4;

export function ThinkingLevelSelector({ current, onSelect, supportedLevels }: Props) {
  const { t } = useI18n();
  const levelsToRender = supportedLevels?.length
    ? THINKING_LEVELS.filter((l) => supportedLevels.includes(l))
    : FALLBACK_LEVELS;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownId = useId();
  // In the composer/chat pane (NOT immune): measure against that offset
  // `overflow` pane, left-preserving. See change: fix-popover-container-clip.
  const boundaryRef = usePopoverBoundary();
  const { flipUp, maxHeight, minHeight, anchorRight, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 128, // w-32 natural width
    preferredAnchor: "left",
    boundaryRef,
  });

  // Close on outside click / touch. The panel is PORTALED to the layer root,
  // so it is no longer a DOM descendant of the container — `panelRef` is
  // checked FIRST (the trigger toggles; letting a panel click fall through to
  // it would close-then-reopen). See change: fix-composer-popover-layering
  // (pattern: FolderActionsMenu).
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
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
        // Portaled to the layer root + positioned `fixed` from the trigger's
        // viewport rect — escapes the composer's stacking context / overflow
        // clip (the underlap fix). GAP replaces the mt-1/mb-1 the inline form
        // got from flow; `visibility` hides the pre-measure frame so the panel
        // never flashes at (0,0). See change: fix-composer-popover-layering.
        <LayerPortal>
          <div
            ref={panelRef}
            className="fixed w-32 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-popover overflow-hidden"
            style={{
              visibility: triggerRect ? "visible" : "hidden",
              ...(triggerRect
                ? flipUp
                  ? { bottom: Math.round(window.innerHeight - triggerRect.top + GAP) }
                  : { top: Math.round(triggerRect.bottom + GAP) }
                : {}),
              ...(triggerRect
                ? anchorRight
                  ? { right: Math.max(0, Math.round(window.innerWidth - triggerRect.right)) }
                  : { left: Math.round(triggerRect.left) }
                : {}),
            }}
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
        </LayerPortal>
      )}
    </div>
  );
}
