/**
 * ChainEditor — one worker's ordered model fallback chain (design D7).
 *
 * The chain is ONE ranked list: position 0 is the primary (`<worker>Model`),
 * the rest are `<worker>FallbackModels` in resolution order. Reordering is
 * button-driven, never drag-only: drag-only would fail WCAG 2.1.1, and the
 * buttons are keyboard- and screen-reader-operable for free.
 *
 * Boundary controls are DISABLED, not absent, so the control set does not
 * reflow as an entry moves. Every control's accessible name names the model it
 * acts on. A chain of exactly one entry offers no remove control at all — a
 * worker chain cannot be emptied.
 *
 * The resolution tail (`base model → session model`) is displayed but is NOT an
 * entry of the chain: it is shared by every worker and edited elsewhere.
 *
 * See change: add-blackhole-plugin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import type { ModelRef } from "../shared/blackhole-config.js";
import { THINKING_LEVELS } from "../shared/blackhole-config.js";
import { canRemove, moveEntry, normalizeModel, removeEntry } from "../shared/chain-model.js";

const inputCls =
  "font-mono text-[12px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 outline-none focus:border-[var(--accent-primary)]";

/** Stable label for a model entry — the model id is what the user recognises. */
function modelLabel(model: ModelRef): string {
  return model.id || model.provider || "unnamed model";
}

export interface ChainEditorProps {
  worker: string;
  name: string;
  role: string;
  entries: ModelRef[];
  onChange: (next: ModelRef[]) => void;
  /** The base `model` entry, shown as the shared tail. */
  baseModel: ModelRef | null;
  /** When false, the session-model tail is rendered as excluded. */
  sessionFallback: boolean;
}

export function ChainEditor({
  worker,
  name,
  role,
  entries,
  onChange,
  baseModel,
  sessionFallback,
}: ChainEditorProps): React.ReactElement {
  const t = useT();
  const removable = canRemove(entries);

  const patch = (index: number, field: keyof ModelRef, value: unknown) => {
    const next = entries.map((e, i) =>
      i === index ? normalizeModel({ ...(e as unknown as Record<string, unknown>), [field]: value }) : e,
    );
    onChange(next);
  };

  return (
    <section
      className="mb-4"
      aria-labelledby={`blackhole-worker-${worker}`}
      data-testid={`blackhole-chain-${worker}`}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span id={`blackhole-worker-${worker}`} className="text-[13px] font-semibold text-[var(--text-primary)]">
          {name}
        </span>
        <span className="text-[11.5px] text-[var(--text-tertiary)]">{role}</span>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
          {entries.length} {entries.length === 1 ? "model" : "models"}
        </span>
      </div>

      <ol className="list-none m-0 p-0">
        {entries.map((entry, index) => (
          <li
            // Key by INDEX. A content-derived key would change on every
            // keystroke in Provider / Model ID, remounting the <li> — which
            // closes the open <details> and drops focus after one character.
            // The chain is index-addressed everywhere else in this component
            // (test ids, move and remove handlers), so this is consistent.
            key={index}
            className="border border-[var(--border-secondary)] rounded-lg mb-1.5 bg-[var(--bg-secondary)]"
            data-testid={`blackhole-chain-${worker}-entry-${index}`}
          >
            <details>
              <summary className="cursor-pointer flex items-center gap-2 px-3 py-2 list-none select-none">
                <span className="text-[11px] text-[var(--text-tertiary)] w-4" aria-hidden="true">
                  {index + 1}
                </span>
                {index === 0 && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1.5">
                    {t("primary", undefined, "Primary")}
                  </span>
                )}
                <span className="font-mono text-[12px] text-[var(--text-primary)]">{entry.id}</span>
                <span className="text-[11px] text-[var(--text-tertiary)]">{entry.provider}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${modelLabel(entry)} up in the ${worker} chain`}
                    data-testid={`blackhole-chain-${worker}-up-${index}`}
                    className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] disabled:opacity-40"
                    onClick={() => onChange(moveEntry(entries, index, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === entries.length - 1}
                    aria-label={`Move ${modelLabel(entry)} down in the ${worker} chain`}
                    data-testid={`blackhole-chain-${worker}-down-${index}`}
                    className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] disabled:opacity-40"
                    onClick={() => onChange(moveEntry(entries, index, 1))}
                  >
                    ↓
                  </button>
                  {removable && (
                    <button
                      type="button"
                      aria-label={`Remove ${modelLabel(entry)} from the ${worker} chain`}
                      data-testid={`blackhole-chain-${worker}-remove-${index}`}
                      className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--accent-red)]"
                      onClick={() => onChange(removeEntry(entries, index))}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </summary>
              <div className="px-3 pb-3 pt-1 grid gap-2 border-t border-[var(--border-subtle)]">
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                  <span className="w-28">{t("mProvider", undefined, "Provider")}</span>
                  <input
                    type="text"
                    className={inputCls}
                    value={entry.provider ?? ""}
                    aria-label={`Provider for ${modelLabel(entry)}`}
                    onChange={(e) => patch(index, "provider", e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                  <span className="w-28">{t("mModelId", undefined, "Model ID")}</span>
                  <input
                    type="text"
                    className={inputCls}
                    value={entry.id ?? ""}
                    aria-label={`Model ID for ${modelLabel(entry)}`}
                    onChange={(e) => patch(index, "id", e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                  <span className="w-28">{t("mThinking", undefined, "Thinking")}</span>
                  <select
                    className={inputCls}
                    value={entry.thinking ?? ""}
                    aria-label={`Thinking level for ${modelLabel(entry)}`}
                    onChange={(e) => patch(index, "thinking", e.target.value)}
                  >
                    <option value="">{t("inherit", undefined, "(inherit)")}</option>
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                  <span className="w-28">{t("mCooldown", undefined, "Cooldown (hours)")}</span>
                  <input
                    type="number"
                    className={inputCls}
                    value={entry.cooldownHours ?? ""}
                    aria-label={`Cooldown hours for ${modelLabel(entry)}`}
                    onChange={(e) => patch(index, "cooldownHours", e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
                  <span className="w-28">{t("mContextWindow", undefined, "Context window")}</span>
                  <input
                    type="number"
                    className={inputCls}
                    placeholder="inherit from pi"
                    value={entry.contextWindow ?? ""}
                    aria-label={`Context window for ${modelLabel(entry)}`}
                    onChange={(e) => patch(index, "contextWindow", e.target.value)}
                  />
                </label>
              </div>
            </details>
          </li>
        ))}
      </ol>

      {/* The shared resolution tail. Shown so the chain reads completely, but
          NOT an entry of this chain — it belongs to every worker. */}
      <p
        className="text-[11px] text-[var(--text-tertiary)] m-0 pl-1"
        data-testid={`blackhole-chain-${worker}-tail`}
      >
        <span>then </span>
        <span data-testid={`blackhole-chain-${worker}-tail-base`}>
          base model{baseModel ? ` · ${baseModel.id}` : " (unset)"}
        </span>
        <span> → </span>
        <span
          data-testid={`blackhole-chain-${worker}-tail-session`}
          data-excluded={sessionFallback ? "false" : "true"}
          className={sessionFallback ? "" : "line-through opacity-60"}
        >
          session model{sessionFallback ? "" : " (excluded)"}
        </span>
      </p>
    </section>
  );
}
