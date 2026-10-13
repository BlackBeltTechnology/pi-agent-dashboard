/**
 * RoleRef — the one shared display of an `@role[:level]` reference.
 *
 * Presentational only (strings in, markup out, no fetch, no client import).
 * `follows` renders the role token, the resolved model id and a level chip;
 * `once` renders the model id and "from @role" (a pick resolved once, which
 * does not follow later role changes). The provider prefix stays in the DOM as
 * visually hidden text, so `textContent` and the accessible name keep the full
 * `provider/id` while the visible text stays short. No `aria-label` override.
 *
 * Hosts pass translated strings through `labels`; English defaults apply.
 *
 * See change: retro-ux-model-selector (design D2).
 */

export interface RoleRefLabels {
  /** Warning pill shown when no model value exists. */
  noModel?: string;
  /** Prefix of the once-mode text: "from @role". */
  from?: string;
  /** Visually hidden word after the level chip. */
  thinking?: string;
}

export interface RoleRefProps {
  /** `@name` (the leading `@` is added when missing). */
  role: string;
  /** `provider/id` the role resolves to (or the last model kept by a dangling slot). */
  model?: string;
  /** Thinking level. */
  level?: string;
  /** `follows` (default): persisted role ref. `once`: resolved at pick time. */
  mode?: "follows" | "once";
  labels?: RoleRefLabels;
  /** The resolution is still loading: with no model, show the token alone instead of the unassigned pill. */
  resolving?: boolean;
  /** Optional `data-testid`s so hosts keep their existing hooks. */
  testIds?: { token?: string; model?: string; unassigned?: string; from?: string };
  /** Extra classes for the root. */
  className?: string;
}

const MONO = "font-mono";

/** Splits `provider/id` at the first slash; a bare id has no provider. */
function splitModel(model: string): { provider: string; id: string } {
  const i = model.indexOf("/");
  return i < 0 ? { provider: "", id: model } : { provider: model.slice(0, i + 1), id: model.slice(i + 1) };
}

export function RoleRef({ role, model, level, mode = "follows", labels, resolving, testIds, className }: RoleRefProps) {
  const token = role.startsWith("@") ? role : `@${role}`;
  const noModel = labels?.noModel ?? "No model assigned";
  const from = labels?.from ?? "from";
  const thinking = labels?.thinking ?? "thinking";
  const parts = model ? splitModel(model) : null;
  return (
    <span data-role-ref={mode} className={`inline-flex items-center gap-1.5 min-w-0 text-xs ${className ?? ""}`}>
      {mode === "follows" && (
        <span
          data-role-ref-token
          data-testid={testIds?.token}
          className={`${MONO} flex-none font-semibold text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-1.5 leading-[18px]`}
        >
          {token}
        </span>
      )}
      {parts ? (
        <span data-role-ref-model data-testid={testIds?.model} className={`${MONO} min-w-0 truncate ${mode === "once" ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}>
          {parts.provider && <span className="sr-only">{parts.provider}</span>}
          {parts.id}
        </span>
      ) : resolving ? null : (
        <span
          data-role-ref-unassigned
          data-testid={testIds?.unassigned}
          className="flex-none rounded-full border px-1.5 py-0.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]"
        >
          {noModel}
        </span>
      )}
      {mode === "once" && (
        <span data-role-ref-from data-testid={testIds?.from} className="flex-none text-[var(--text-secondary)]">
          {from} {token}
        </span>
      )}
      {parts && level && (
        <span
          data-role-ref-level
          className="flex-none text-xs font-semibold text-[var(--text-secondary)] border border-[var(--border-secondary)] rounded-full px-1.5 leading-4"
        >
          {level}
          <span className="sr-only"> {thinking}</span>
        </span>
      )}
    </span>
  );
}
