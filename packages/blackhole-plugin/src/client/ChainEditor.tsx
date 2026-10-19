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
 * Presentation: kit `NumberField`/`ToggleField`/`SettingsStatusPill`/`SettingsNotice`;
 * reorder/remove are 32 px icon buttons (remove = danger ghost) that sit BESIDE the
 * entry's `<details>` rather than inside its `<summary>` (no nested interactive).
 *
 * See changes: add-blackhole-plugin, retro-ux-plugin-settings-wave-2.
 */
import {
  NumberField,
  RoleRef,
  type RoleRefLabels,
  SettingsNotice,
  SettingsStatusPill,
  ToggleField,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertOutline, mdiArrowDown, mdiArrowUp, mdiClose, mdiDeleteOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
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
import { BTN_ICON, BTN_ICON_DANGER, BTN_SECONDARY } from "./settings-buttons.js";

/** Stable label for a model entry — the model id is what the user recognises. */
function modelLabel(model: ModelRef): string {
  return model.role || model.id || model.provider || "unnamed model";
}

/** The ModelSelector `current` for an entry: its role ref when bound, else `provider/id`. */
function entryCurrent(entry: ModelRef): string | undefined {
  if (entry.role) return entry.role;
  return entry.provider && entry.id ? `${entry.provider}/${entry.id}` : entry.id || undefined;
}

/** `provider/id` as last projected (empty when a role was just picked and not yet saved). */
function concreteLabel(entry: ModelRef): string {
  return entry.provider && entry.id ? `${entry.provider}/${entry.id}` : "";
}

/** One status vocabulary across surfaces (spec role-model-bindings): detached / dangling are warning pills; ok shows nothing. */
const ROLE_STATUS_TEXT: Record<string, string> = {
  detached: "Detached",
  dangling: "Role unassigned, keeps its last model",
};

const WARNING_CALLOUT =
  "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]";

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
  /** Re-project the role into a detached slot at `index` (chain position). */
  onReattach?: (index: number) => void;
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
  onReattach?: (index: number) => void;
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
  if (entry.role) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span className="w-28 font-semibold text-[var(--text-primary)]">{t("mThinking", undefined, "Thinking")}</span>
        <span data-testid={`blackhole-entry-${index}-thinking-from-role`}>
          {t("thinkingFromRole", { role: entry.role }, `from ${entry.role}`)}
        </span>
      </div>
    );
  }
  const isOverrideEnabled = entry.thinking !== undefined;
  const picked = models.find((m) => m.provider === entry.provider && m.id === entry.id);
  const supportedLevels =
    picked?.reasoning === false
      ? ["off"]
      : ["off", "minimal", "low", "medium", "high", "xhigh"];

  return (
    <div className="space-y-2">
      <ToggleField
        label={t("overrideThinkingFor", { model: modelLabel(entry) }, `Override thinking level for ${modelLabel(entry)}`)}
        hint={
          isOverrideEnabled ? null : t("inherit", undefined, "(inherit)")
        }
        value={isOverrideEnabled}
        onChange={(on) => onPatch(index, "thinking", on ? "off" : undefined)}
      />
      {isOverrideEnabled ? (
        <ThinkingLevelPrimitive
          current={entry.thinking}
          supportedLevels={supportedLevels}
          onSelect={(lvl: string) => onPatch(index, "thinking", lvl)}
        />
      ) : null}
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
  onReattach,
}: EntryRowProps): React.ReactElement {
  const t = useT();
  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);
  const roleRefLabels: RoleRefLabels = {
    noModel: t("noModelAssigned", undefined, "No model assigned"),
    thinking: t("roleRefThinking", undefined, "thinking"),
  };

  const label = modelLabel(entry);
  return (
    <li
      className="mb-1.5 flex items-start rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
      data-testid={`blackhole-chain-${worker}-entry-${index}`}
    >
      <details className="group min-w-0 flex-1">
        <summary className="focus-ring flex min-h-[44px] cursor-pointer select-none list-none flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 [&::-webkit-details-marker]:hidden">
          <span className="w-4 text-[12px] text-[var(--text-secondary)]" aria-hidden="true">
            {index + 1}
          </span>
          {index === 0 && (
            <SettingsStatusPill tone="neutral" icon={null} interactive>
              {t("primary", undefined, "Primary")}
            </SettingsStatusPill>
          )}
          {entry.role ? (
            <RoleRef
              role={entry.role}
              model={concreteLabel(entry) || undefined}
              level={entry.thinking}
              labels={roleRefLabels}
              testIds={{ token: `blackhole-chain-${worker}-entry-${index}-role` }}
            />
          ) : (
            <>
              <span className="font-mono text-[12px] text-[var(--text-primary)]">{entry.id}</span>
              <span className="text-[12px] text-[var(--text-secondary)]">{entry.provider}</span>
            </>
          )}
          {entry.role && entry.roleStatus && entry.roleStatus !== "ok" && (
            <SettingsStatusPill
              tone="warning"
              interactive
              testId={`blackhole-chain-${worker}-entry-${index}-role-status`}
              status={entry.roleStatus}
            >
              {t(`roleStatus_${entry.roleStatus}`, undefined, ROLE_STATUS_TEXT[entry.roleStatus] ?? entry.roleStatus)}
            </SettingsStatusPill>
          )}
        </summary>
        <div className="grid gap-3 border-t border-[var(--border-subtle)] px-3 pb-3 pt-2">
          <div
            role="group"
            aria-label={t(
              "modelForEntryGroup",
              { worker, index: index + 1 },
              `Model for ${worker} entry ${index + 1}`,
            )}
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
          >
            <span className="w-28 font-semibold text-[var(--text-primary)]">{t("modelLabel", undefined, "Model")}</span>
            <div className="min-w-0 flex-1">
              {registry === "ok" ? (
                <ModelSelectorPrimitive
                  current={entryCurrent(entry)}
                  models={models}
                  allowRoles
                  onSelect={(sel: string) => onSelectModel(index, sel)}
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

          {entry.role && entry.roleStatus === "detached" && onReattach && (
            <div role="status" className={`${WARNING_CALLOUT} flex-wrap items-center`}>
              <Icon path={mdiAlertOutline} size={0.55} className="flex-shrink-0" aria-hidden />
              <span className="flex-1 min-w-0">
                {t(
                  "roleDetachedHelp",
                  { role: entry.role },
                  `This slot was edited outside the dashboard, so it no longer follows ${entry.role}.`,
                )}
              </span>
              <button
                type="button"
                data-testid={`blackhole-chain-${worker}-reattach-${index}`}
                onClick={() => onReattach(index)}
                className="focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px] text-xs font-semibold hover:bg-[var(--bg-hover)]"
              >
                {t("reattachRoleTo", { role: entry.role }, `Reattach to ${entry.role}`)}
              </button>
            </div>
          )}

          {levelDropNotice && (
            <SettingsNotice tone="warning" role="status" testId={`blackhole-chain-${worker}-${index}-level-drop`}>
              {levelDropNotice}
            </SettingsNotice>
          )}

          <ThinkingControl entry={entry} index={index} models={models} onPatch={onPatch} />

          <NumberField
            label={t("cooldownHoursFor", { model: label }, `Cooldown hours for ${label}`)}
            hint={t("cooldownHint", undefined, "How long this model is skipped after a retryable error.")}
            decimal
            allowEmpty
            value={entry.cooldownHours ?? Number.NaN}
            onChange={(v) => onPatch(index, "cooldownHours", v)}
          />

          <NumberField
            label={t("contextWindowFor", { model: label }, `Context window for ${label}`)}
            hint={t("contextWindowHint", undefined, "Leave empty to use pi's own value.")}
            allowEmpty
            value={entry.contextWindow ?? Number.NaN}
            onChange={(v) => onPatch(index, "contextWindow", v)}
          />
        </div>
      </details>
      <span className="flex flex-none items-center gap-0.5 p-1.5">
        <button
          type="button"
          disabled={index === 0}
          aria-label={`Move ${label} up in the ${worker} chain`}
          data-testid={`blackhole-chain-${worker}-up-${index}`}
          className={BTN_ICON}
          onClick={() => onMove(index, -1)}
        >
          <Icon path={mdiArrowUp} size={0.65} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          aria-label={`Move ${label} down in the ${worker} chain`}
          data-testid={`blackhole-chain-${worker}-down-${index}`}
          className={BTN_ICON}
          onClick={() => onMove(index, 1)}
        >
          <Icon path={mdiArrowDown} size={0.65} aria-hidden="true" />
        </button>
        {removable && (
          <button
            type="button"
            aria-label={`Remove ${label} from the ${worker} chain`}
            data-testid={`blackhole-chain-${worker}-remove-${index}`}
            className={BTN_ICON_DANGER}
            onClick={() => onRemove(index)}
          >
            <Icon path={mdiDeleteOutline} size={0.65} aria-hidden="true" />
          </button>
        )}
      </span>
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
  onReattach,
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
    if (label.startsWith("@")) {
      // Role pick: the entry follows the role; the server resolves it on save and
      // writes the concrete model. Concrete fields stay as display until then.
      setLevelDropNotice((prev) => ({ ...prev, [index]: undefined }));
      onChange(entries.map((e, i) => (i === index ? normalizeModel({ ...e, role: label, roleStatus: undefined }) : e)));
      return;
    }
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
          "levelDropped",
          { level: droppedLevel, model: label },
          `Thinking level ${droppedLevel} isn't supported by ${label}, so the level was dropped.`,
        ),
      }));
    } else {
      setLevelDropNotice((prev) => ({ ...prev, [index]: undefined }));
    }

    const nextEntry = normalizeModel({
      ...currentEntry,
      role: undefined,
      roleStatus: undefined,
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
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span id={`blackhole-worker-${worker}`} className="text-sm font-semibold text-[var(--text-primary)]">
          {name}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{role}</span>
        <span className="ml-auto text-xs text-[var(--text-secondary)]">
          {entries.length} {entries.length === 1 ? "model" : "models"}
        </span>
      </div>

      {entries.length === 0 ? (
        <div
          data-testid={`blackhole-chain-${worker}-empty`}
          className="mb-2 rounded-lg border border-dashed border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]"
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
              onReattach={onReattach}
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
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t("addModelToChain", { worker }, `Add model to ${worker} chain`)}
            </span>
            <button
              type="button"
              aria-label={t("cancelAddingModel", undefined, "Cancel adding model")}
              onClick={() => setAdding(false)}
              className={BTN_ICON}
            >
              <Icon path={mdiClose} size={0.65} aria-hidden="true" />
            </button>
          </div>
          <ModelSelectorPrimitive
            models={models}
            allowRoles
            placeholder={t("selectModelToAddPlaceholder", undefined, "Select model to add…")}
            onSelect={(label: string) => {
              if (label.startsWith("@")) {
                onChange(appendEntry(entries, { provider: "", id: "", role: label }));
                setAdding(false);
                return;
              }
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
        className={`${BTN_SECONDARY} mb-2`}
      >
        <Icon path={mdiPlus} size={0.55} aria-hidden="true" />
        {t("addModelToChain", { worker }, `Add model to ${worker} chain`)}
      </button>

      {/* The shared resolution tail. Shown so the chain reads completely, but
          NOT an entry of this chain — it belongs to every worker. */}
      <p
        className="m-0 pl-1 text-xs text-[var(--text-secondary)]"
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
