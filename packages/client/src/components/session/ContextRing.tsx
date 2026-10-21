/**
 * Context-window ring for the session header (desktop meta line + mobile row).
 *
 * A 16 px SVG arc on a `--border-secondary` track. Arc colour is a pure
 * function of the ROUNDED percentage shown: neutral 0–30, blue 31–50, green
 * 51–70, orange 71–90, red 91+. The percentage is capped at 100; the tooltip
 * keeps the real token counts. Renders nothing when usage is unknown.
 *
 * `ContextRing` (desktop) is a `role="meter"`; `ContextRingButton` (mobile) is
 * a 44 px button that opens a non-modal popover.
 *
 * See change: reorganize-session-header.
 */
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export interface ContextUsageValue {
  tokens: number | null;
  contextWindow: number;
}

export type RingTier = "neutral" | "blue" | "green" | "orange" | "red";

const TIER_STROKE: Record<RingTier, string> = {
  neutral: "var(--text-secondary)",
  blue: "var(--accent-blue-text)",
  green: "var(--accent-green-text)",
  orange: "var(--accent-orange-text)",
  red: "var(--accent-red-text)",
};

/** Rounded percentage, capped at 100; null when usage is unknown. */
export function contextPercent(usage: ContextUsageValue | undefined | null): number | null {
  if (!usage || usage.tokens == null || !(usage.contextWindow > 0)) return null;
  return Math.min(100, Math.round((usage.tokens / usage.contextWindow) * 100));
}

export function ringTier(pct: number): RingTier {
  if (pct > 90) return "red";
  if (pct > 70) return "orange";
  if (pct > 50) return "green";
  if (pct > 30) return "blue";
  return "neutral";
}

/** 127000 → `127.0k`, 1_000_000 → `1.0M`, 1_020_000 → `1.02M`. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(2);
    return `${m.endsWith("0") ? m.slice(0, -1) : m}M`;
  }
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function tokensText(usage: ContextUsageValue): string {
  const used = formatTokens(usage.tokens ?? 0);
  const window = formatTokens(usage.contextWindow);
  return i18nT("session.contextTokens", { used, window }, `${used} of ${window} tokens`);
}

function Arc({ pct, size }: { pct: number; size: number }) {
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const tier = ringTier(pct);
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" stroke="var(--border-secondary)" data-testid="context-ring-track" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke={TIER_STROKE[tier]}
        strokeDasharray={`${((pct / 100) * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
        data-testid="context-ring-arc"
        data-tier={tier}
      />
    </svg>
  );
}

/** Desktop ring: arc + `<pct>%` text, `role="meter"`, tooltip with the counts. */
export function ContextRing({ usage }: { usage: ContextUsageValue | undefined | null }) {
  const pct = contextPercent(usage);
  if (pct === null || !usage) return null;
  const tokens = tokensText(usage);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}% · ${tokens}`}
      aria-label={i18nT("session.contextUsed", undefined, "Context used")}
      title={tokens}
      tabIndex={0}
      data-testid="context-ring"
      className="inline-flex items-center gap-1.5 min-h-6 px-1.5 rounded-lg text-xs tabular-nums text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      <Arc pct={pct} size={16} />
      <span>{pct}%</span>
    </span>
  );
}

/** Mobile ring: 44 px arc-only button that opens a non-modal popover. */
export function ContextRingButton({ usage, cost }: { usage: ContextUsageValue | undefined | null; cost?: number }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pct = contextPercent(usage);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (pct === null || !usage) return null;
  const tokens = tokensText(usage);
  const label = i18nT(
    "session.contextRingLabel",
    { pct, used: formatTokens(usage.tokens ?? 0), window: formatTokens(usage.contextWindow) },
    `Context: ${pct}% used, ${tokens}`,
  );
  const summary = `${pct}% · ${tokens}`;
  const popoverText = cost !== undefined && cost > 0 ? `${summary} · $${cost.toFixed(2)}` : summary;

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        data-testid="context-ring-button"
        className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg hover:bg-[var(--bg-hover)]"
      >
        <Arc pct={pct} size={20} />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={i18nT("session.contextUsed", undefined, "Context used")}
          data-testid="context-ring-popover"
          className="absolute right-0 top-full mt-1 z-popover whitespace-nowrap rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-lg"
        >
          {popoverText}
        </div>
      )}
    </div>
  );
}
