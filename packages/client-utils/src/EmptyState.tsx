/**
 * EmptyState primitive — encodes the NN/g empty-state pattern: a value-framed
 * heading, optional body / shape-of-success slot, at most ONE primary CTA, and
 * at most one secondary (escape-hatch) action.
 *
 * The single `action` prop (not an array) enforces one-primary-CTA by
 * construction — a consumer cannot supply more than one primary action. Bare
 * inline empty `<p>` strings can't satisfy this shape, so adopting `EmptyState`
 * upgrades copy by construction.
 *
 * Rule: NN/g empty-state; H8 one primary action; Von Restorff.
 * See change: extend-client-utils-state-feedback-primitives.
 */
import type React from "react";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  testId?: string;
}

export interface EmptyStateProps {
  /** Value-framed heading naming what lives here once populated. */
  title: string;
  /** Optional supporting copy (shape of success). */
  body?: React.ReactNode;
  /** Optional ghost/illustration slot. */
  icon?: React.ReactNode;
  /** At most one primary CTA. */
  action?: EmptyStateAction;
  /** At most one secondary escape-hatch action. */
  secondaryAction?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  title,
  body,
  icon,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-empty-state=""
      className={
        "flex flex-col items-center justify-center text-center gap-2 px-4 py-6 text-[var(--text-tertiary)]" +
        (className ? ` ${className}` : "")
      }
    >
      {icon ? (
        <div aria-hidden="true" className="opacity-60">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
      {body ? <div className="text-xs text-[var(--text-tertiary)] max-w-xs">{body}</div> : null}
      {action || secondaryAction ? (
        <div className="flex items-center gap-2 mt-1">
          {action ? (
            <button
              type="button"
              data-empty-state-action="primary"
              data-testid={action.testId}
              onClick={action.onClick}
              className="focus-ring text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--accent-primary)] text-white hover:opacity-90"
            >
              {action.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button
              type="button"
              data-empty-state-action="secondary"
              data-testid={secondaryAction.testId}
              onClick={secondaryAction.onClick}
              className="focus-ring text-xs font-medium px-3 py-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
