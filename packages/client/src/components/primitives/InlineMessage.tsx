/**
 * InlineMessage — the shared severity-styled inline surface.
 *
 * One primitive for every inline message/banner: a leading severity accent
 * bar, an icon, a title, optional sub/body content, an optional row of action
 * pills, and an optional `mdiClose` dismiss control. Colors (bg / border / fg)
 * derive exclusively from `--severity-{error,warning,info}-*` theme tokens —
 * no raw Tailwind color literals. A `compact` one-line variant serves the
 * missing-tool surface; an `animate` top accent-bar sweep conveys an in-flight
 * state (provider auto-retry). The dismiss control invokes `onDismiss` only —
 * never any other side effect (it never aborts a session).
 *
 * See change: redesign-directory-card (inline-message-log-primitives spec).
 */
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ReactNode } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export type Severity = "error" | "warning" | "info";

// Static token maps (Tailwind cannot JIT-scan a dynamic
// `--severity-${severity}-*`), so each severity resolves through a literal
// class string keyed off the union.
const TONE: Record<Severity, { bg: string; border: string; fg: string; bar: string }> = {
  error: {
    bg: "bg-[var(--severity-error-bg)]",
    border: "border-[var(--severity-error-border)]",
    fg: "text-[var(--severity-error-fg)]",
    bar: "bg-[var(--severity-error-fg)]",
  },
  warning: {
    bg: "bg-[var(--severity-warning-bg)]",
    border: "border-[var(--severity-warning-border)]",
    fg: "text-[var(--severity-warning-fg)]",
    bar: "bg-[var(--severity-warning-fg)]",
  },
  info: {
    bg: "bg-[var(--severity-info-bg)]",
    border: "border-[var(--severity-info-border)]",
    fg: "text-[var(--severity-info-fg)]",
    bar: "bg-[var(--severity-info-fg)]",
  },
};

interface Props {
  severity: Severity;
  /** Leading icon (mdi path). */
  icon: string;
  title: ReactNode;
  /** Optional sub/body content (default variant only). */
  children?: ReactNode;
  /** Optional action-pill row (rendered as-is by the caller). */
  actions?: ReactNode;
  /** Dismiss handler. Present → an `mdiClose` control renders. */
  onDismiss?: () => void;
  /** One-line compact variant (icon + title + trailing action). */
  variant?: "compact";
  /** Render a thin top accent-bar sweep for an in-flight state. */
  animate?: boolean;
  /** Optional test id override on the root (defaults to `inline-message`). */
  testId?: string;
  /** Optional test id for the dismiss control. */
  dismissTestId?: string;
}

export function InlineMessage({
  severity,
  icon,
  title,
  children,
  actions,
  onDismiss,
  variant,
  animate,
  testId = "inline-message",
  dismissTestId = "inline-message-dismiss",
}: Props) {
  const tone = TONE[severity];
  const compact = variant === "compact";

  return (
    <div
      data-testid={testId}
      className={`relative overflow-hidden rounded-xl border pl-3.5 pr-3 py-2 flex gap-2.5 ${compact ? "items-center" : "items-start"} ${tone.bg} ${tone.border} ${tone.fg}`}
    >
      {/* Left severity accent bar. */}
      <span
        data-testid="inline-message-accent"
        className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`}
        aria-hidden="true"
      />
      {/* In-flight top sweep (amber, severity-token sourced). */}
      {animate && (
        <span
          data-testid="inline-message-sweep"
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[var(--severity-warning-fg)] to-transparent animate-pulse"
          aria-hidden="true"
        />
      )}
      <Icon path={icon} size={0.7} className={`shrink-0 ${compact ? "" : "mt-0.5"}`} />
      {compact ? (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-semibold min-w-0">{title}</span>
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-bold break-words">{title}</div>
          {children && (
            <div data-testid="inline-message-body" className="mt-0.5 text-[11.5px] break-words">
              {children}
            </div>
          )}
          {actions && <div className="mt-2 flex items-center gap-1.5 flex-wrap">{actions}</div>}
        </div>
      )}
      {onDismiss && (
        <button
          type="button"
          data-testid={dismissTestId}
          onClick={onDismiss}
          className="shrink-0 opacity-70 hover:opacity-100"
          title={i18nT("common.dismiss", undefined, "Dismiss")}
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      )}
    </div>
  );
}
