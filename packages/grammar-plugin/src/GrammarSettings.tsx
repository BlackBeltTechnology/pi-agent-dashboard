/**
 * GrammarSettings — settings-section slot contribution for the grammar plugin.
 *
 * Reads/writes the plugin config namespace `plugins.grammar.*` via
 * `GET /api/config` (`data.plugins.grammar`) + `POST /api/config/plugins/grammar`.
 * Persistence flows through the host's unified Save Bar via
 * `useSettingsDraftSource` (id `plugin:grammar`) — the section renders NO own
 * Save/Reload buttons and no "unsaved" chip; `commit` POSTs (rejecting on a
 * non-OK response so the host keeps it dirty + retryable) then re-GETs to
 * surface server clamping; `reset` re-GETs. Fields use the shared settings
 * field kit in three groups (Checking · Model · Advanced); presentation is
 * theme-token classes only (no inline styles on plugin-owned elements).
 * LLM-only: no backend selector, no LanguageTool URL/health marker.
 *
 * A failed load keeps the section on defaults, disabled, with a notice + Try
 * again, and `commit` refuses until a load succeeds. A save failure throws a
 * plain sentence; the raw status only travels in the notice's "Copy details".
 *
 * See changes: add-grammar-settings-plugin, grammar-llm-only-with-explore,
 * align-grammar-settings-design, retro-ux-plugin-settings-wave-2.
 */
import {
  FieldShell,
  NumberField,
  SelectField,
  SettingsGroup,
  SettingsNotice,
  SettingsStatusPill,
  SettingsTable,
  TextField,
  ToggleField,
  useSettingsDraftSource,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { GrammarConfig } from "./grammar-config.js";

/** Docs page describing which models are good grammar-check candidates. */
const MODEL_GUIDANCE_DOC = "/docs/grammar-model-guidance.md";

/**
 * Short curated recommended-model set from the OpenRouter grammar competition
 * (11 hard cases ×2; full tradeoff table lives in the doc). Model ids are the
 * OpenRouter slugs (provider `openrouter`).
 */
const RECOMMENDED_MODELS: Array<{ id: string; recommended?: boolean; noteKey: string; note: string }> = [
  { id: "openai/gpt-4.1-nano", recommended: true, noteKey: "recNano", note: "100% recall, ~2.5s, zero style churn" },
  { id: "qwen/qwen3-30b-a3b-2507", noteKey: "recQwen30", note: "balanced — ~4.7s, 100% recall" },
  { id: "amazon/nova-lite-v1", noteKey: "recNova", note: "fastest/cheapest (~1s), but adds markdown churn + fails code fences" },
  { id: "openai/gpt-4o-mini", noteKey: "recMini", note: "solid alternative — ~3.5s" },
];

/**
 * Disabled-default fallback, used only before the first GET resolves or when the
 * config file has no `grammar` block. The server (`parseGrammarConfig`) remains
 * the clamp/validation authority.
 */
const FALLBACK_GRAMMAR: GrammarConfig = {
  enabled: false,
  autoCheck: true,
  debounceMs: 1200,
  minChars: 12,
  maxChars: 4000,
  language: "auto",
  correctionView: "redline",
  capitalizeFirstWord: false,
};

/** `/api/models` row shape (only the fields consumed). `id` is `provider/id`. */
interface ModelRow {
  id: string;
  provider: string;
}

/**
 * Map `/api/models` rows → `ModelInfo[]` for the `ui:model-selector` primitive.
 * The route's `id` is the full `"<provider>/<id>"` label; the selector wants a
 * bare `id` plus `provider`, and rebuilds the label itself.
 */
function toModelInfo(rows: ModelRow[]): ModelInfo[] {
  return rows.map((r) => {
    const prefix = `${r.provider}/`;
    return { provider: r.provider, id: r.id.startsWith(prefix) ? r.id.slice(prefix.length) : r.id };
  });
}

function normalize(raw: Partial<GrammarConfig> | undefined): GrammarConfig {
  return {
    ...FALLBACK_GRAMMAR,
    ...(raw ?? {}),
    ...(raw?.llm
      ? { llm: "role" in raw.llm ? { role: raw.llm.role } : { provider: raw.llm.provider, model: raw.llm.model } }
      : {}),
  };
}

export function GrammarSettings(): React.ReactElement {
  const t = useT();
  const [config, setConfig] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [draft, setDraft] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        setModels([]);
        return;
      }
      const json = (await res.json()) as { data?: ModelRow[] };
      setModels(toModelInfo(json.data ?? []));
    } catch {
      setModels([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`grammar config load failed (${res.status})`);
      const json = (await res.json()) as {
        data?: { plugins?: { grammar?: Partial<GrammarConfig> } };
      };
      const next = normalize(json.data?.plugins?.grammar);
      setConfig(next);
      setDraft(next);
      setLoaded(true);
      setLoadFailed(null);
      void loadModels();
    } catch (err) {
      setLoadFailed(err instanceof Error ? err.message : String(err));
    }
  }, [loadModels]);

  useEffect(() => {
    void load();
  }, [load]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }, [load]);

  // Field validation. Empty number inputs are invalid draft values (NaN), never coerced.
  const numberError = (v: number): string | null => (Number.isFinite(v) ? null : t("numberRequired", undefined, "Enter a number."));
  const debounceError = numberError(draft.debounceMs);
  const maxCharsError = numberError(draft.maxChars);
  const minCharsError =
    numberError(draft.minChars) ??
    (Number.isFinite(draft.maxChars) && draft.minChars >= draft.maxChars
      ? t("minCharsError", { max: draft.maxChars }, `Must be less than the longest text (${draft.maxChars}).`)
      : null);
  const invalid = Boolean(debounceError || minCharsError || maxCharsError);

  // Once an Advanced field is invalid, open the group and keep it open while the user fixes it.
  useEffect(() => {
    if (invalid) setAdvancedOpen(true);
  }, [invalid]);

  const isDirty = loaded && JSON.stringify(draft) !== JSON.stringify(config);

  // Persist through the host's unified Save Bar. `commit` MUST reject on a
  // non-OK response so the host keeps the source dirty + retryable.
  const commit = useCallback(async () => {
    if (!loaded) {
      throw new Error(
        t(
          "saveBlockedNotLoaded",
          undefined,
          "The grammar settings have not loaded yet, so saving is off. Use Try again, then save.",
        ),
      );
    }
    if (invalid) {
      setAdvancedOpen(true);
      throw new Error(t("saveBlockedInvalid", undefined, "Fix the invalid fields before saving."));
    }
    let res: Response;
    try {
      res = await fetch("/api/config/plugins/grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
    } catch (err) {
      const message = t("saveError", undefined, "Could not save the grammar settings. Check that the dashboard is running, then save again.");
      setSaveError(err instanceof Error ? err.message : String(err));
      throw new Error(message);
    }
    if (!res.ok) {
      setSaveError(`grammar config save failed (${res.status})`);
      throw new Error(
        t("saveError", undefined, "Could not save the grammar settings. Check that the dashboard is running, then save again."),
      );
    }
    setSaveError(null);
    // POST does not echo the reloaded config; re-GET to surface server clamping.
    await load();
  }, [draft, invalid, load, loaded, t]);

  useSettingsDraftSource({
    id: "plugin:grammar",
    isDirty,
    commit,
    reset: () => {
      setSaveError(null);
      void load();
    },
  });

  const edit = (patch: Partial<GrammarConfig>) => {
    setSaveError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const modelLabel = t("llmModel", undefined, "Model");

  return (
    <section data-testid="grammar-settings" className="space-y-3 pb-4 text-xs text-[var(--text-secondary)]">
      <p className="m-0">{t("desc", undefined, "Grammar and spelling checks for the message composer.")}</p>

      {loadFailed !== null && (
        <SettingsNotice
          tone="error"
          testId="grammar-load-error"
          onRetry={() => void retryLoad()}
          retrying={retrying}
          details={loadFailed}
        >
          {t(
            "loadError",
            undefined,
            "Could not load the grammar settings. Showing defaults; saving is off until they load.",
          )}
        </SettingsNotice>
      )}

      {saveError !== null && (
        <SettingsNotice tone="error" testId="grammar-save-error" details={saveError}>
          {t(
            "saveError",
            undefined,
            "Could not save the grammar settings. Check that the dashboard is running, then save again.",
          )}
        </SettingsNotice>
      )}

      {/* A disabled fieldset switches every control off natively while the config has not loaded. */}
      <fieldset disabled={loadFailed !== null} className="m-0 min-w-0 space-y-3 border-0 p-0">
        <SettingsGroup title={t("groupGeneral", undefined, "Checking")} testId="grammar-group-checking">
          <ToggleField
            label={t("enabled", undefined, "Check grammar in the composer")}
            hint={t(
              "enabledHint",
              undefined,
              "Underlines mistakes in the message box. The check runs on the server with the model below.",
            )}
            value={draft.enabled}
            onChange={(v) => edit({ enabled: v })}
            testIds={{ control: "grammar-enabled" }}
          />
          <ToggleField
            label={t("autoCheck", undefined, "Check while typing")}
            hint={t("autoCheckHint", undefined, "Off = check only when you ask.")}
            value={draft.autoCheck}
            onChange={(v) => edit({ autoCheck: v })}
            testIds={{ control: "grammar-autocheck" }}
          />
          <SelectField
            label={t("correctionView", undefined, "Show corrections as")}
            hint={t(
              "correctionViewHint",
              undefined,
              "Redline marks changes inline; List shows them under the box.",
            )}
            value={draft.correctionView}
            options={[
              { value: "redline", label: t("correctionViewRedline", undefined, "Redline (inline)") },
              { value: "list", label: t("correctionViewList", undefined, "List") },
            ]}
            onChange={(v) => edit({ correctionView: v as GrammarConfig["correctionView"] })}
            testIds={{ control: "grammar-correction-view" }}
          />
          <ToggleField
            label={t("capitalizeFirstWord", undefined, "Capitalise sentence starts")}
            hint={t("capitalizeFirstWordHint", undefined, "Fixes a lowercase first letter at the start of a sentence.")}
            value={draft.capitalizeFirstWord}
            onChange={(v) => edit({ capitalizeFirstWord: v })}
            testIds={{ control: "grammar-capitalize" }}
          />
        </SettingsGroup>

        <SettingsGroup title={t("groupModel", undefined, "Model")} testId="grammar-group-model">
          <FieldShell
            label={modelLabel}
            stacked
            hint={
              <span data-testid="grammar-model-hint">
                {t("modelHint", undefined, "Model choice drives grammar quality, latency, and cost.")}{" "}
                <a
                  data-testid="grammar-model-guidance-link"
                  href={MODEL_GUIDANCE_DOC}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring rounded text-[var(--link)] underline"
                >
                  {t("modelHintLink", undefined, "Which models are good?")}
                </a>
              </span>
            }
            control={({ id, describedBy }) =>
              ModelSelector ? (
                <div
                  id={id}
                  role="group"
                  aria-label={modelLabel}
                  aria-describedby={describedBy}
                  data-testid="grammar-llm-model-selector"
                >
                  <ModelSelector
                    current={
                      draft.llm
                        ? "role" in draft.llm
                          ? draft.llm.role
                          : `${draft.llm.provider}/${draft.llm.model}`
                        : undefined
                    }
                    models={models}
                    allowRoles
                    onSelect={(label: string) => {
                      // Role pick persists as `llm: { role }` (no provider/model) — resolved per check.
                      if (label.startsWith("@")) {
                        edit({ llm: { role: label } });
                        return;
                      }
                      const i = label.indexOf("/");
                      const provider = i >= 0 ? label.slice(0, i) : label;
                      const model = i >= 0 ? label.slice(i + 1) : "";
                      edit({ llm: { provider, model } });
                    }}
                  />
                </div>
              ) : (
                <span
                  id={id}
                  aria-describedby={describedBy}
                  data-testid="grammar-llm-model-selector-unavailable"
                  className="text-[var(--text-secondary)]"
                >
                  {t("modelSelectorUnavailable", undefined, "Model selector unavailable")}
                </span>
              )
            }
          />

          {!draft.llm && (
            <SettingsNotice tone="warning" testId="grammar-model-required" role="status">
              {t("modelRequired", undefined, "Pick a model — the grammar check cannot run until one is set.")}
            </SettingsNotice>
          )}

          {/* Recommended-models disclosure — sibling of the picker (NOT nested in
              a <label>), collapsed by default; a short curated list, full table
              lives in the linked doc. */}
          <SettingsGroup
            title={t("recommendedModels", undefined, "Recommended models")}
            meta={RECOMMENDED_MODELS.length}
            defaultOpen={false}
            testId="grammar-recommended-models"
          >
            <SettingsTable
              caption={t("recommendedModels", undefined, "Recommended models")}
              columns={[
                t("recColModel", undefined, "Model"),
                t("recColStatus", undefined, "Status"),
                t("recColNotes", undefined, "Notes"),
              ]}
              rows={RECOMMENDED_MODELS.map((m) => ({
                key: m.id,
                cells: [
                  <code key="id" className="font-mono">
                    {m.id}
                  </code>,
                  m.recommended ? (
                    <SettingsStatusPill key="s" tone="success">
                      {t("recBadge", undefined, "Recommended")}
                    </SettingsStatusPill>
                  ) : null,
                  t(m.noteKey, undefined, m.note),
                ],
              }))}
            />
            <p className="m-0 text-xs text-[var(--text-secondary)]">
              {t(
                "recAvoid",
                undefined,
                "Avoid reasoning models (e.g. deepseek-v4-flash, ~11.5s), ministral-8b (78% recall), and the retired gemini-2.0-flash-001/-lite-001 (404).",
              )}
            </p>
          </SettingsGroup>
        </SettingsGroup>

        <SettingsGroup
          title={t("groupAdvanced", undefined, "Advanced")}
          defaultOpen={advancedOpen}
          testId="grammar-group-advanced"
        >
          <NumberField
            label={t("debounceMs", undefined, "Wait after typing")}
            unit={t("unitMs", undefined, "ms")}
            hint={t("debounceHint", undefined, "How long to wait after you stop typing before checking. 300–10000.")}
            error={debounceError}
            allowEmpty
            value={draft.debounceMs}
            onChange={(v) => edit({ debounceMs: v })}
            testIds={{ control: "grammar-debounce" }}
          />
          <NumberField
            label={t("minChars", undefined, "Shortest text")}
            unit={t("unitChars", undefined, "chars")}
            hint={t("minCharsHint", undefined, "Shorter messages are not checked.")}
            error={minCharsError}
            allowEmpty
            value={draft.minChars}
            onChange={(v) => edit({ minChars: v })}
            testIds={{ control: "grammar-minchars" }}
          />
          <NumberField
            label={t("maxChars", undefined, "Longest text")}
            unit={t("unitChars", undefined, "chars")}
            hint={t("maxCharsHint", undefined, "Longer messages are not checked.")}
            error={maxCharsError}
            allowEmpty
            value={draft.maxChars}
            onChange={(v) => edit({ maxChars: v })}
            testIds={{ control: "grammar-maxchars" }}
          />
          <TextField
            label={t("language", undefined, "Language")}
            hint={
              <>
                {t("languageHintBefore", undefined, "BCP-47 tag such as ")}
                <code>en-GB</code>
                {t("languageHintMiddle", undefined, ", or ")}
                <code>auto</code>
                {t("languageHintAfter", undefined, ".")}
              </>
            }
            mono
            value={draft.language}
            onChange={(v) => edit({ language: v })}
            testIds={{ control: "grammar-language" }}
          />
        </SettingsGroup>
      </fieldset>
    </section>
  );
}
