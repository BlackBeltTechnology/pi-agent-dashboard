/**
 * GrammarSettings — settings-section slot contribution for the grammar plugin.
 *
 * Reads/writes the plugin config namespace `plugins.grammar.*` via
 * `GET /api/config` (`data.plugins.grammar`) + `POST /api/config/plugins/grammar`.
 * Persistence flows through the host's unified Save Bar via
 * `useSettingsDraftSource` (id `plugin:grammar`) — the section renders NO own
 * Save/Reload buttons and no "unsaved" chip; `commit` POSTs (rejecting on a
 * non-OK response so the host keeps it dirty + retryable) then re-GETs to
 * surface server clamping; `reset` re-GETs. Fields are grouped into `<details>`
 * accordions; presentation is theme-token utility classes only (no inline
 * styles on plugin-owned elements). LLM-only: no backend selector, no
 * LanguageTool URL/health marker.
 *
 * See changes: add-grammar-settings-plugin, grammar-llm-only-with-explore,
 * align-grammar-settings-design.
 */
import { useSettingsDraftSource, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { GrammarConfig } from "./grammar-config.js";

/** Docs page describing which models are good grammar-check candidates. */
const MODEL_GUIDANCE_DOC = "/docs/grammar-model-guidance.md";

/** Short curated recommended-model set (full tradeoff table lives in the doc). */
const RECOMMENDED_MODELS: Array<{ id: string; recommended?: boolean; noteKey: string; note: string }> = [
  { id: "claude-haiku-4-5", recommended: true, noteKey: "recHaiku", note: "fast, cheap, keeps style — ~2–4 s" },
  { id: "claude-sonnet-4-5", noteKey: "recSonnet", note: "thorough, slower — ~8 s" },
  { id: "claude-opus-4-5", noteKey: "recOpus", note: "most thorough, pricier — ~7 s" },
  { id: "gemini-flash-latest", noteKey: "recGemini", note: "capable non-Anthropic option" },
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
    ...(raw?.llm ? { llm: { provider: raw.llm.provider, model: raw.llm.model } } : {}),
  };
}

// Shared theme-token utility classes (the blackhole/hermes idiom).
const GROUP = "border border-[var(--border-secondary)] rounded-[10px] overflow-hidden mb-2.5 bg-[var(--bg-secondary)]";
const SUMMARY =
  "focus-ring cursor-pointer flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--text-primary)] select-none list-none";
const CARET = "text-[var(--text-tertiary)] motion-safe:transition-transform";
const BODY = "px-3.5 pb-3 pt-1 border-t border-[var(--border-subtle)] flex flex-col gap-2.5";
const FIELD = "flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]";
const CHECK = "flex gap-1.5 items-center text-[12px] text-[var(--text-secondary)]";
const CONTROL =
  "focus-ring bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-[12px] text-[var(--text-primary)]";

export function GrammarSettings(): React.ReactElement {
  const t = useT();
  const [config, setConfig] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [draft, setDraft] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [models, setModels] = useState<ModelInfo[]>([]);
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
    const res = await fetch("/api/config");
    const json = (await res.json()) as {
      data?: { plugins?: { grammar?: Partial<GrammarConfig> } };
    };
    const next = normalize(json.data?.plugins?.grammar);
    setConfig(next);
    setDraft(next);
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  // Persist through the host's unified Save Bar. `commit` MUST reject on a
  // non-OK response so the host keeps the source dirty + retryable.
  const commit = useCallback(async () => {
    const res = await fetch("/api/config/plugins/grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      throw new Error(`grammar config save failed (${res.status})`);
    }
    // POST does not echo the reloaded config; re-GET to surface server clamping.
    await load();
  }, [draft, load]);

  useSettingsDraftSource({
    id: "plugin:grammar",
    isDirty,
    commit,
    reset: () => {
      void load();
    },
  });

  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <section data-testid="grammar-settings" className="text-[13px] text-[var(--text-secondary)] pb-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] m-0">
          {t("heading", undefined, "Grammar & Spelling")}
        </h3>
        <span className="text-[10px] text-[var(--text-muted)] font-mono">grammar</span>
      </div>

      <p className="text-[11px] text-[var(--text-secondary)] mt-0 mb-3">
        {t(
          "desc",
          undefined,
          "Composer grammar/spell-check behaviour. The check runs server-side via the configured LLM model.",
        )}
      </p>

      {/* General */}
      <details className={GROUP} open>
        <summary className={SUMMARY}>
          <span className={CARET}>▸</span>
          {t("groupGeneral", undefined, "General")}
        </summary>
        <div className={BODY}>
          <label className={CHECK}>
            <input
              type="checkbox"
              className="focus-ring"
              data-testid="grammar-enabled"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            {t("enabled", undefined, "Enabled")}
          </label>

          <label className={CHECK}>
            <input
              type="checkbox"
              className="focus-ring"
              data-testid="grammar-autocheck"
              checked={draft.autoCheck}
              onChange={(e) => setDraft({ ...draft, autoCheck: e.target.checked })}
            />
            {t("autoCheck", undefined, "Auto-check while typing")}
          </label>

          <label className={FIELD}>
            {t("correctionView", undefined, "Correction view")}
            <select
              className={CONTROL}
              data-testid="grammar-correction-view"
              value={draft.correctionView}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  correctionView: e.target.value as GrammarConfig["correctionView"],
                })
              }
            >
              <option value="redline">{t("correctionViewRedline", undefined, "Redline (inline)")}</option>
              <option value="list">{t("correctionViewList", undefined, "List")}</option>
            </select>
          </label>

          <label className={CHECK}>
            <input
              type="checkbox"
              className="focus-ring"
              data-testid="grammar-capitalize"
              checked={draft.capitalizeFirstWord}
              onChange={(e) => setDraft({ ...draft, capitalizeFirstWord: e.target.checked })}
            />
            {t("capitalizeFirstWord", undefined, "Capitalize sentence starts")}
          </label>
        </div>
      </details>

      {/* Model */}
      <details className={GROUP} open>
        <summary className={SUMMARY}>
          <span className={CARET}>▸</span>
          {t("groupModel", undefined, "Model")}
        </summary>
        <div className={BODY}>
          <span className="text-[12px] text-[var(--text-secondary)]">{t("llmModel", undefined, "Model")}</span>
          <span data-testid="grammar-model-hint" className="text-[10px] text-[var(--text-muted)]">
            {t("modelHint", undefined, "Model choice drives grammar quality, latency, and cost.")}{" "}
            <a
              data-testid="grammar-model-guidance-link"
              href={MODEL_GUIDANCE_DOC}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-secondary)] underline"
            >
              {t("modelHintLink", undefined, "Which models are good?")}
            </a>
          </span>

          {ModelSelector ? (
            <div data-testid="grammar-llm-model-selector">
              <ModelSelector
                current={draft.llm ? `${draft.llm.provider}/${draft.llm.model}` : undefined}
                models={models}
                onSelect={(label: string) => {
                  const i = label.indexOf("/");
                  const provider = i >= 0 ? label.slice(0, i) : label;
                  const model = i >= 0 ? label.slice(i + 1) : "";
                  setDraft({ ...draft, llm: { provider, model } });
                }}
              />
            </div>
          ) : (
            <span data-testid="grammar-llm-model-selector-unavailable" className="text-[var(--text-secondary)]">
              {t("modelSelectorUnavailable", undefined, "Model selector unavailable")}
            </span>
          )}

          {!draft.llm && (
            <span data-testid="grammar-model-required" className="text-[10px] text-[var(--severity-warning-fg)]">
              {t("modelRequired", undefined, "Pick a model — the grammar check cannot run until one is set.")}
            </span>
          )}

          {/* Recommended-models disclosure — sibling of the picker (NOT nested in
              a <label>), collapsed by default; a short curated list, full table
              lives in the linked doc. */}
          <details data-testid="grammar-recommended-models" className="mt-0.5 rounded border border-[var(--border-subtle)]">
            <summary className={`${SUMMARY} py-1.5 text-[11px] font-medium`}>
              <span className={CARET}>▸</span>
              {t("recommendedModels", undefined, "Recommended models")}
            </summary>
            <ul className="px-3.5 pb-2 pt-1 m-0 list-none flex flex-col gap-1">
              {RECOMMENDED_MODELS.map((m) => (
                <li key={m.id} className="text-[11px] text-[var(--text-secondary)] flex items-baseline gap-1.5">
                  <code className="font-mono text-[10.5px] text-[var(--text-primary)]">{m.id}</code>
                  {m.recommended && (
                    <span className="text-[9.5px] uppercase tracking-wide text-[var(--severity-success-fg)]">
                      {t("recBadge", undefined, "recommended")}
                    </span>
                  )}
                  <span className="text-[var(--text-tertiary)]">— {t(m.noteKey, undefined, m.note)}</span>
                </li>
              ))}
              <li className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">
                {t("recAvoid", undefined, "Avoid weak/lite models (e.g. gemini-flash-lite-latest) — they leave typos uncorrected.")}
              </li>
            </ul>
          </details>
        </div>
      </details>

      {/* Advanced */}
      <details className={GROUP}>
        <summary className={SUMMARY}>
          <span className={CARET}>▸</span>
          {t("groupAdvanced", undefined, "Advanced")}
        </summary>
        <div className={BODY}>
          <label className={FIELD}>
            {t("debounceMs", undefined, "Debounce (ms)")}
            <input
              type="number"
              className={CONTROL}
              data-testid="grammar-debounce"
              min={300}
              max={10000}
              value={String(draft.debounceMs)}
              onChange={(e) => setDraft({ ...draft, debounceMs: num(e.target.value, draft.debounceMs) })}
            />
          </label>

          <label className={FIELD}>
            {t("minChars", undefined, "Minimum characters")}
            <input
              type="number"
              className={CONTROL}
              data-testid="grammar-minchars"
              min={1}
              max={500}
              value={String(draft.minChars)}
              onChange={(e) => setDraft({ ...draft, minChars: num(e.target.value, draft.minChars) })}
            />
          </label>

          <label className={FIELD}>
            {t("maxChars", undefined, "Maximum characters")}
            <input
              type="number"
              className={CONTROL}
              data-testid="grammar-maxchars"
              min={100}
              max={20000}
              value={String(draft.maxChars)}
              onChange={(e) => setDraft({ ...draft, maxChars: num(e.target.value, draft.maxChars) })}
            />
          </label>

          <label className={FIELD}>
            {t("language", undefined, "Language")}
            <input
              type="text"
              className={CONTROL}
              data-testid="grammar-language"
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            />
          </label>
        </div>
      </details>
    </section>
  );
}
