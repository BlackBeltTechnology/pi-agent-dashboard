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
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useState } from "react";
import type { ModelRef } from "../shared/blackhole-config.js";
import {
  appendEntry,
  canRemove,
  moveEntry,
  normalizeModel,
  removeEntry,
} from "../shared/chain-model.js";

const inputCls =
  "font-mono text-[12px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 outline-none focus:border-[var(--accent-primary)]";

/** Stable label for a model entry — the model id is what the user recognises. */
function modelLabel(model: ModelRef): string {
  return model.id || model.provider || "unnamed model";
}

export type RegistryState = "pending" | "ok" | "empty" | "unavailable";

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
  models?: ModelInfo[];
  registry?: RegistryState;
  onRetryRegistry?: () => void;
}

interface EntryRowProps {
  entry: ModelRef;
  index: number;
  total: number;
  worker: string;
  models: ModelInfo[];
  registry: RegistryState;
  removable: boolean;
  levelDropNotice?: string;
  onSelectModel: (index: number, label: string) => void;
  onPatch: (index: number, field: keyof ModelRef, value: unknown) => void;
  onMove: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
}

function ThinkingControl({
  entry,
  index,
  models,
  onPatch,
}: {
  entry: ModelRef;
  index: number;
  models: ModelInfo[];
  onPatch: (index: number, field: keyof ModelRef, value: unknown) => void;
}): React.ReactElement {
  const t = useT();
  const ThinkingLevelPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.thinkingLevelSelector);
  const isOverrideEnabled = entry.thinking !== undefined;
  const picked = models.find((m) => m.provider === entry.provider && m.id === entry.id);
  const supportedLevels =
    picked?.reasoning === false
      ? ["off"]
      : ["off", "minimal", "low", "medium", "high", "xhigh"];

  return (
    <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
      <span className="w-28">{t("mThinking", undefined, "Thinking")}</span>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          aria-label={`Override thinking level for ${modelLabel(entry)}`}
          checked={isOverrideEnabled}
          onChange={(e) => {
            if (e.target.checked) {
              onPatch(index, "thinking", "off");
            } else {
              onPatch(index, "thinking", undefined);
            }
          }}
        />
        <span className="text-[11.5px]">
          {t("overrideThinking", undefined, "Override thinking level")}
        </span>
      </label>
      {isOverrideEnabled ? (
        <div className="ml-2">
          <ThinkingLevelPrimitive
            current={entry.thinking}
            supportedLevels={supportedLevels}
            onSelect={(lvl: string) => onPatch(index, "thinking", lvl)}
          />
        </div>
      ) : (
        <span className="text-[11.5px] text-[var(--text-tertiary)] ml-1">
          {t("inherit", undefined, "(inherit)")}
        </span>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  index,
  total,
  worker,
  models,
  registry,
  removable,
  levelDropNotice,
  onSelectModel,
  onPatch,
  onMove,
  onRemove,
}: EntryRowProps): React.ReactElement {
  const t = useT();
  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  return (
    <li
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
              onClick={() => onMove(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === total - 1}
              aria-label={`Move ${modelLabel(entry)} down in the ${worker} chain`}
              data-testid={`blackhole-chain-${worker}-down-${index}`}
              className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] disabled:opacity-40"
              onClick={() => onMove(index, 1)}
            >
              ↓
            </button>
            {removable && (
              <button
                type="button"
                aria-label={`Remove ${modelLabel(entry)} from the ${worker} chain`}
                data-testid={`blackhole-chain-${worker}-remove-${index}`}
                className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--accent-red)]"
                onClick={() => onRemove(index)}
              >
                ✕
              </button>
            )}
          </span>
        </summary>
        <div className="px-3 pb-3 pt-1 grid gap-2 border-t border-[var(--border-subtle)]">
          <div
            role="group"
            aria-label={t(
              "modelForEntryGroup",
              { worker, index: index + 1 },
              `Model for ${worker} entry ${index + 1}`,
            )}
            className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]"
          >
            <span className="w-28">{t("modelLabel", undefined, "Model")}</span>
            <div className="flex-1 min-w-0">
              {registry === "ok" ? (
                <ModelSelectorPrimitive
                  current={
                    entry.provider && entry.id
                      ? `${entry.provider}/${entry.id}`
                      : entry.id || undefined
                  }
                  models={models}
                  onSelect={(label: string) => onSelectModel(index, label)}
                />
              ) : (
                <span
                  data-testid={`blackhole-chain-${worker}-${index}-model`}
                  className="font-mono text-[12px] text-[var(--text-primary)]"
                >
                  {entry.provider && entry.id ? `${entry.provider}/${entry.id}` : entry.id || "—"}
                </span>
              )}
            </div>
          </div>

          {levelDropNotice && (
            <div
              data-testid={`blackhole-chain-${worker}-${index}-level-drop`}
              className="px-2 py-1.5 rounded text-[11px] bg-[var(--severity-warning-bg)] border border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]"
            >
              ⚠️ {levelDropNotice}
            </div>
          )}

          <ThinkingControl
            entry={entry}
            index={index}
            models={models}
            onPatch={onPatch}
          />

          <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
            <span className="w-28">{t("mCooldown", undefined, "Cooldown (hours)")}</span>
            <input
              type="number"
              className={inputCls}
              value={entry.cooldownHours ?? ""}
              aria-label={`Cooldown hours for ${modelLabel(entry)}`}
              onChange={(e) => onPatch(index, "cooldownHours", e.target.value)}
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
              onChange={(e) => onPatch(index, "contextWindow", e.target.value)}
            />
          </label>
        </div>
      </details>
    </li>
  );
}

export function ChainEditor({
  worker,
  name,
  role,
  entries,
  onChange,
  baseModel,
  sessionFallback,
  models = [],
  registry = "ok",
  onRetryRegistry: _onRetryRegistry,
}: ChainEditorProps): React.ReactElement {
  const t = useT();
  const removable = canRemove(entries);
  const [adding, setAdding] = useState(false);
  const [levelDropNotice, setLevelDropNotice] = useState<Record<number, string | undefined>>({});

  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  const patch = (index: number, field: keyof ModelRef, value: unknown) => {
    const next = entries.map((e, i) =>
      i === index ? normalizeModel({ ...(e as unknown as Record<string, unknown>), [field]: value }) : e,
    );
    onChange(next);
  };

  const handleSelectModel = (index: number, label: string) => {
    const picked = models.find((m) => `${m.provider}/${m.id}` === label);
    let newProvider = "";
    let newId = "";
    const reasoning = picked?.reasoning;

    if (picked) {
      newProvider = picked.provider;
      newId = picked.id;
    } else {
      const slashIdx = label.indexOf("/");
      if (slashIdx >= 0) {
        newProvider = label.slice(0, slashIdx);
        newId = label.slice(slashIdx + 1);
      } else {
        newProvider = "";
        newId = label;
      }
    }

    const currentEntry = entries[index];
    let nextThinking = currentEntry.thinking;

    if (reasoning === false && nextThinking && nextThinking !== "off") {
      const droppedLevel = nextThinking;
      nextThinking = undefined;
      setLevelDropNotice((prev) => ({
        ...prev,
        [index]: t(
          "levelDropNotice",
          { level: droppedLevel },
          `Thinking level override '${droppedLevel}' dropped: selected model does not support reasoning.`,
        ),
      }));
    } else {
      setLevelDropNotice((prev) => ({ ...prev, [index]: undefined }));
    }

    const nextEntry = normalizeModel({
      ...currentEntry,
      provider: newProvider,
      id: newId,
      thinking: nextThinking,
      contextWindow: undefined,
    });

    onChange(entries.map((e, i) => (i === index ? nextEntry : e)));
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

      {entries.length === 0 ? (
        <div
          data-testid={`blackhole-chain-${worker}-empty`}
          className="border border-dashed border-[var(--border-secondary)] rounded-lg p-3 mb-2 text-[12px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)]"
        >
          {t("chainEmpty", undefined, "Worker currently resolves to base / session tail only.")}
        </div>
      ) : (
        <ol className="list-none m-0 p-0">
          {entries.map((entry, index) => (
            <EntryRow
              key={index}
              entry={entry}
              index={index}
              total={entries.length}
              worker={worker}
              models={models}
              registry={registry}
              removable={removable}
              levelDropNotice={levelDropNotice[index]}
              onSelectModel={handleSelectModel}
              onPatch={patch}
              onMove={(idx, delta) => onChange(moveEntry(entries, idx, delta))}
              onRemove={(idx) => onChange(removeEntry(entries, idx))}
            />
          ))}
        </ol>
      )}

      {adding && (
        <div
          data-testid={`blackhole-chain-${worker}-adding`}
          className="border border-[var(--border-secondary)] rounded-lg p-3 mb-2 bg-[var(--bg-secondary)]"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setAdding(false);
            }
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              {t("addModelToChain", { worker }, `Add model to ${worker} chain`)}
            </span>
            <button
              type="button"
              aria-label={t("cancelAddingModel", undefined, "Cancel adding model")}
              onClick={() => setAdding(false)}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          </div>
          <ModelSelectorPrimitive
            models={models}
            placeholder={t("selectModelToAddPlaceholder", undefined, "Select model to add…")}
            onSelect={(label: string) => {
              const picked = models.find((m) => `${m.provider}/${m.id}` === label);
              let newProvider = "";
              let newId = "";
              if (picked) {
                newProvider = picked.provider;
                newId = picked.id;
              } else {
                const slashIdx = label.indexOf("/");
                if (slashIdx >= 0) {
                  newProvider = label.slice(0, slashIdx);
                  newId = label.slice(slashIdx + 1);
                } else {
                  newId = label;
                }
              }
              onChange(appendEntry(entries, { provider: newProvider, id: newId }));
              setAdding(false);
            }}
          />
        </div>
      )}

      <button
        type="button"
        disabled={registry !== "ok"}
        aria-label={`Add model to ${worker} chain`}
        data-testid={`blackhole-chain-${worker}-add`}
        onClick={() => setAdding(true)}
        className="mb-3 px-2 py-1 text-[11px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + {t("addModelToChain", { worker }, `Add model to ${worker} chain`)}
      </button>

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
