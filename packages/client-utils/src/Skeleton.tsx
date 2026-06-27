/**
 * Skeleton primitive — content-shaped loading placeholder for content-layout
 * loads (chat history, board, lists). Spinners stay for short blocking actions
 * only.
 *
 * Honors `prefers-reduced-motion: reduce` by rendering a static placeholder
 * with no shimmer animation. Per-content variants keep placeholder shape close
 * to the real content so there is no layout shift (CLS) on swap.
 *
 * Rule: NN/g skeleton-screens; response-times; Doherty.
 * See change: extend-client-utils-state-feedback-primitives.
 */
import { useMediaQuery } from "./useMediaQuery.js";

export type SkeletonVariant = "text" | "card" | "bubble" | "row";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** How many placeholder rows to render. Default 1. */
  count?: number;
  className?: string;
}

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text: "h-3 w-2/3 rounded",
  card: "h-24 w-full rounded-lg",
  bubble: "h-14 w-3/4 rounded-2xl",
  row: "h-8 w-full rounded-md",
};

export function Skeleton({ variant = "text", count = 1, className }: SkeletonProps) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const items = Array.from({ length: n });
  const motionClass = reducedMotion ? "" : "animate-pulse";
  return (
    <div
      data-skeleton={variant}
      data-static={reducedMotion ? "true" : undefined}
      aria-hidden="true"
      className={`flex flex-col gap-2${className ? ` ${className}` : ""}`}
    >
      {items.map((_, i) => (
        <div
          key={i}
          data-skeleton-item=""
          className={`bg-[var(--bg-surface)] ${motionClass} ${VARIANT_CLASS[variant]}`}
        />
      ))}
    </div>
  );
}
