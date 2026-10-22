/**
 * Shared class recipes for the identity + connectivity settings surfaces
 * (Users, server selector, known servers, network discovery).
 *
 * Tokens and semantic families only — no palette class, hex or `rgba(` literal
 * (`ui-contract.md` § Colour roles; scanned by `connectivity-token-scan.test.ts`).
 * Class strings are written out in full so Tailwind's scanner sees them.
 *
 * See change: retro-ux-identity-connectivity.
 */

export type Severity = "success" | "info" | "warning" | "error" | "neutral";

const PILL_BASE = "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold whitespace-nowrap";

const SEVERITY_PILL: Record<Severity, string> = {
  success: "border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]",
  info: "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]",
  warning: "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]",
  error: "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]",
  neutral: "border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)]",
};

const IDENTITY_PILL = {
  local: "border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  remote: "border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)] text-[var(--tint-purple-fg)]",
} as const;

/** 11 px as a plain label; 12 px when it sits inside an interactive item (the probes' interactive floor). */
const pillSize = (inItem: boolean) => (inItem ? "text-xs" : "text-[11px]");

/** Severity pill: fg on its own bg (never a severity fg on a surface — audit A1). */
export function severityPill(severity: Severity, inItem = false): string {
  return `${PILL_BASE} ${pillSize(inItem)} ${SEVERITY_PILL[severity]}`;
}

/** Local / Remote identity pill, shared by the selector and discovery. */
export function identityPill(isLocal: boolean, inItem = false): string {
  return `${PILL_BASE} ${pillSize(inItem)} ${isLocal ? IDENTITY_PILL.local : IDENTITY_PILL.remote}`;
}

export type RouteChipTone = "ok" | "bad" | "off";

const ROUTE_CHIP_BASE =
  "inline-flex items-center gap-1 rounded border px-1.5 py-px text-xs font-semibold whitespace-nowrap bg-[var(--bg-tertiary)]";

const ROUTE_CHIP_TONE: Record<RouteChipTone, string> = {
  ok: "border-[var(--border-secondary)] text-[var(--text-primary)]",
  off: "border-dashed border-[var(--border-secondary)] text-[var(--text-secondary)]",
  bad: "border-[var(--severity-error-border)] !bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]",
};

/** Route chip (kind + proof outcome as text): `used` marks the best route with a success border, never colour alone. */
export function routeChip(tone: RouteChipTone, used = false): string {
  return `${ROUTE_CHIP_BASE} ${ROUTE_CHIP_TONE[tone]}${used && tone === "ok" ? " !border-[var(--severity-success-border)]" : ""}`;
}

const CALLOUT_BASE = "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs";

const SEVERITY_CALLOUT: Record<Exclude<Severity, "success" | "neutral">, string> = {
  info: "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]",
  warning: "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]",
  error: "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]",
};

/** Severity callout (icon + text), the contract's recipe. */
export function callout(severity: keyof typeof SEVERITY_CALLOUT): string {
  return `${CALLOUT_BASE} ${SEVERITY_CALLOUT[severity]}`;
}

const BTN_BASE =
  "focus-ring inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer disabled:cursor-not-allowed";
const BTN_DISABLED = "disabled:border-[var(--border-secondary)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]";

/** The section's one primary action: ≥ 44 px below `sm`, 36 px from `sm` up. */
export const BTN_PRIMARY = `${BTN_BASE} bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white ${BTN_DISABLED}`;

const BTN_SECONDARY_LOOK = "border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]";
export const BTN_SECONDARY = `${BTN_BASE} ${BTN_SECONDARY_LOOK} px-3 min-h-[36px] ${BTN_DISABLED}`;
/** Row action: 32 px target. */
export const BTN_SMALL = `${BTN_BASE} ${BTN_SECONDARY_LOOK} px-2.5 min-h-[32px] ${BTN_DISABLED}`;
export const BTN_SMALL_GHOST = `${BTN_BASE} px-2.5 min-h-[32px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${BTN_DISABLED}`;
export const BTN_SMALL_DANGER = `${BTN_BASE} border tint-action-red px-2.5 min-h-[32px] ${BTN_DISABLED}`;
export const BTN_SMALL_PRIMARY = `${BTN_BASE} bg-[var(--accent-solid)] px-2.5 min-h-[32px] text-white ${BTN_DISABLED}`;
/** Icon-only 32 px button; the caller supplies an `aria-label`. */
export const BTN_ICON_GHOST = `${BTN_BASE} h-8 w-8 shrink-0 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`;

export const LABEL = "mb-1 block text-xs font-semibold text-[var(--text-primary)]";
export const HELP = "text-xs text-[var(--text-secondary)]";
export const META = "text-[11px] text-[var(--text-secondary)]";
export const INPUT =
  "focus-ring min-h-[36px] w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] aria-[invalid=true]:border-[var(--severity-error-border)]";
export const ROW = "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2";
export const INSET = "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3";

/** Message of a thrown value, for inline error text. */
export function errorMessage(e: unknown, fallback = ""): string {
  return e instanceof Error ? e.message : fallback;
}
