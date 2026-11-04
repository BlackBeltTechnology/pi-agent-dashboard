/**
 * SpawnChoiceChip — the merged model · thinking chip (with Role tab) for spawn
 * surfaces (worktree dialog, folder New Session menu). It edits the folder's
 * remembered spawn choice; it never spawns. Shows the Settings default tagged
 * `default` per field while nothing is remembered; the `default` entries clear
 * a remembered field. `@role` is stored verbatim (resolved once by the server).
 *
 * Not a session picker (`model-selector` "resolve a role once" governs pickers
 * of a RUNNING session). See change: add-spawn-model-choice (design D6, D7).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useModelCatalogue } from "../../hooks/useModelCatalogue.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  getRememberedSpawnChoice,
  getSpawnDefaults,
  type SpawnChoice,
  setRememberedSpawnChoice,
  subscribeSpawnDefaults,
} from "../../lib/spawn/spawn-choice-memory.js";
import { ModelSelector } from "../settings/ModelSelector.js";

/** Dashed `default` entry (clears a remembered field), per the adopted mockup. */
const DEFAULT_ENTRY_CLASS =
  "focus-ring tap-target px-2.5 rounded-md border border-dashed border-[var(--border-secondary)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]";

interface Props {
  /** Folder whose remembered choice the chip edits. */
  cwd: string;
  /** Disabled while an ACP agent is selected (ACP takes no pi model). */
  disabled?: boolean;
  /** Fired with the EFFECTIVE choice (remembered ?? Settings default, per field) after every edit. */
  onChange?: (effective: SpawnChoice) => void;
  testId?: string;
}

export function SpawnChoiceChip({ cwd, disabled, onChange, testId = "spawn-choice-chip" }: Props) {
  const defaults = useSyncExternalStore(subscribeSpawnDefaults, getSpawnDefaults, getSpawnDefaults);
  const { models } = useModelCatalogue({ seedFromCache: true });
  const rootRef = useRef<HTMLDivElement>(null);
  // Lazy-loaded inside a menu item that may already hold focus: hand focus to
  // the trigger so Enter/Space open the popover (APG menu keyboard contract).
  useEffect(() => {
    const root = rootRef.current;
    if (root?.parentElement && root.parentElement === document.activeElement) root.querySelector("button")?.focus();
  }, []);
  const [remembered, setRemembered] = useState<SpawnChoice>(() => getRememberedSpawnChoice(cwd));
  useEffect(() => setRemembered(getRememberedSpawnChoice(cwd)), [cwd]);

  const update = useCallback(
    (next: SpawnChoice) => {
      setRememberedSpawnChoice(cwd, next);
      const stored = getRememberedSpawnChoice(cwd);
      // Storage may be unavailable: keep the in-memory pick for this mount.
      const effective = stored.model || stored.thinkingLevel || (!next.model && !next.thinkingLevel) ? stored : next;
      setRemembered(effective);
      const model = effective.model ?? defaults.model;
      const thinkingLevel = effective.thinkingLevel ?? defaults.thinkingLevel;
      onChange?.({ ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) });
    },
    [cwd, onChange, defaults],
  );

  const model = remembered.model ?? defaults.model;
  const level = remembered.thinkingLevel ?? defaults.thinkingLevel;
  const withoutField = (field: keyof SpawnChoice): SpawnChoice => {
    const { [field]: _dropped, ...rest } = remembered;
    return rest;
  };
  const piDefault = i18nT("spawnChoice.piDefault", undefined, "pi default");

  return (
    <div ref={rootRef} data-testid={testId} aria-disabled={disabled ? "true" : undefined} className="min-w-0">
      <ModelSelector
        current={model}
        models={models}
        allowRoles
        placeholder={piDefault}
        tag={!remembered.model && defaults.model ? "default" : undefined}
        onSelect={(m) => update({ ...remembered, model: m })}
        level={level}
        levelPlaceholder={piDefault}
        levelTag={!remembered.thinkingLevel && defaults.thinkingLevel ? "default" : undefined}
        supportedLevels={models.find((m) => `${m.provider}/${m.id}` === model)?.supportedThinkingLevels}
        onSelectLevel={(l) => update({ ...remembered, thinkingLevel: l })}
        renderPanelHeader={(close) => (
          <div className="flex-none border-b border-[var(--border-secondary)] px-2 py-1.5">
            <button
              type="button"
              data-testid="model-default-entry"
              aria-pressed={!remembered.model}
              onClick={() => {
                update(withoutField("model"));
                close();
              }}
              className={DEFAULT_ENTRY_CLASS}
            >
              {i18nT("spawnChoice.defaultModel", undefined, "default model")}
            </button>
          </div>
        )}
        renderLevelPrefix={(close) => (
          <button
            type="button"
            role="radio"
            aria-checked={!remembered.thinkingLevel}
            tabIndex={-1}
            data-level="default"
            data-testid="level-default-entry"
            onClick={() => {
              update(withoutField("thinkingLevel"));
              close();
            }}
            className={`${DEFAULT_ENTRY_CLASS} font-mono`}
          >
            {i18nT("spawnChoice.default", undefined, "default")}
          </button>
        )}
        disabled={disabled}
      />
    </div>
  );
}
