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
import { useCallback, useEffect, useState } from "react";
import { useModelCatalogue } from "../../hooks/useModelCatalogue.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  getRememberedSpawnChoice,
  type SpawnChoice,
  setRememberedSpawnChoice,
  useSpawnDefaults,
} from "../../lib/spawn/spawn-choice-memory.js";
import { ModelSelector } from "../settings/ModelSelector.js";

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
  const defaults = useSpawnDefaults();
  const { models } = useModelCatalogue({ seedFromCache: true });
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
    <div data-testid={testId} aria-disabled={disabled ? "true" : undefined} className="min-w-0">
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
        onSelectDefaultModel={() => update(withoutField("model"))}
        onSelectDefaultLevel={() => update(withoutField("thinkingLevel"))}
        disabled={disabled}
      />
    </div>
  );
}
