/**
 * Small shared bits for the Vault settings panels: a titled panel, an error line
 * and the one input style. Theme tokens only.
 * See change: add-credential-vault.
 */
import type { ReactNode } from "react";

export function Panel({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section data-testid={`vault-panel-${id}`} className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {hint && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function ErrorLine({ error, testId }: { error: string | null; testId: string }) {
  if (!error) return null;
  return (
    <div data-testid={testId} role="alert" className="text-xs text-[var(--accent-red-text)]">
      {error}
    </div>
  );
}

export const INPUT_CLASS =
  "bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-xs text-[var(--text-primary)] min-w-0";
export const BUTTON_CLASS =
  "text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50";
export const DANGER_BUTTON_CLASS =
  "text-xs px-2 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--accent-red-text)]";
export const ROW_CLASS = "flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-[var(--border-secondary)] last:border-0";
export const LIST_CLASS = "bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)]";
