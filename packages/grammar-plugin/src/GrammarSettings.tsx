/**
 * GrammarSettings — settings-section slot contribution that edits the CORE
 * `config.grammar` block (NOT the plugins.<id>.* namespace).
 *
 * The composer grammar/spell CHECK is core (change: add-composer-grammar-check);
 * the composer has no plugin slot, so only the SETTINGS live here. This section
 * reads/persists via the existing auth-gated GET/PUT /api/config — the same path
 * the core SettingsPanel uses — so `config.grammar` stays the single source of
 * truth the running feature reads. LanguageTool reachability comes from the
 * existing GET /api/grammar/health.
 *
 * Persistence UX = local Save/Reload with a dirty marker (design Decision 3A,
 * mirroring roles-plugin), NOT the shared settings-draft context. PUT /api/config
 * does not echo the reloaded config, so Save re-GETs to surface server clamping.
 *
 * See change: add-grammar-settings-plugin.
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { GrammarConfig } from "./grammar-config.js";

/**
 * Disabled-default fallback, used only before the first GET resolves or when the
 * config file has no `grammar` block. Mirrors `DEFAULT_GRAMMAR` in
 * `packages/shared/src/config.ts` — the runtime const is NOT imported here
 * because `config.ts` pulls `node:fs` (unsafe in a browser bundle). The server
 * (`parseGrammarConfig`) remains the clamp/validation authority.
 */
const FALLBACK_GRAMMAR: GrammarConfig = {
  enabled: false,
  backend: "languagetool",
  autoCheck: true,
  debounceMs: 1200,
  minChars: 12,
  maxChars: 4000,
  language: "auto",
  capitalizeFirstWord: false,
  languagetool: { url: "http://localhost:8081" },
};

interface Health {
  url?: string;
  reachable?: boolean;
}

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
    languagetool: { ...FALLBACK_GRAMMAR.languagetool, ...(raw?.languagetool ?? {}) },
    ...(raw?.llm ? { llm: { provider: raw.llm.provider, model: raw.llm.model } } : {}),
  };
}

export function GrammarSettings(): React.ReactElement {
  const t = useT();
  const [config, setConfig] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [draft, setDraft] = useState<GrammarConfig>(FALLBACK_GRAMMAR);
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  const probeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/grammar/health");
      const json = (await res.json()) as { data?: { languagetool?: Health } };
      setHealth(json.data?.languagetool ?? null);
    } catch {
      setHealth(null);
    }
  }, []);

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
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      const json = (await res.json()) as {
        data?: { plugins?: { grammar?: Partial<GrammarConfig> } };
      };
      const next = normalize(json.data?.plugins?.grammar);
      setConfig(next);
      setDraft(next);
    } finally {
      setLoading(false);
    }
    void probeHealth();
    void loadModels();
  }, [probeHealth, loadModels]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/config/plugins/grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      // POST does not echo the reloaded config; re-GET to surface server clamping.
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <section
      data-testid="grammar-settings"
      style={{
        padding: "12px",
        border: "1px solid rgba(82, 82, 91, 0.5)",
        borderRadius: "6px",
        marginBottom: "12px",
        fontSize: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <h3 style={{ fontSize: "13px", fontWeight: 600, margin: 0 }}>
          {t("heading", undefined, "Grammar & Spelling")}
        </h3>
        <span style={{ fontSize: "10px", color: "#71717a" }}>grammar</span>
      </div>

      <p style={{ fontSize: "11px", color: "#a1a1aa", margin: "0 0 10px 0" }}>
        {t(
          "desc",
          undefined,
          "Composer grammar/spell-check behaviour. The check runs server-side against the selected backend.",
        )}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid="grammar-enabled"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          {t("enabled", undefined, "Enabled")}
        </label>

        <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid="grammar-autocheck"
            checked={draft.autoCheck}
            onChange={(e) => setDraft({ ...draft, autoCheck: e.target.checked })}
          />
          {t("autoCheck", undefined, "Auto-check while typing")}
        </label>

        <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid="grammar-capitalize"
            checked={draft.capitalizeFirstWord}
            onChange={(e) => setDraft({ ...draft, capitalizeFirstWord: e.target.checked })}
          />
          {t("capitalizeFirstWord", undefined, "Capitalize sentence starts")}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {t("backend", undefined, "Backend")}
          <select
            data-testid="grammar-backend"
            value={draft.backend}
            onChange={(e) =>
              setDraft({ ...draft, backend: e.target.value as GrammarConfig["backend"] })
            }
          >
            <option value="languagetool">
              {t("backendLanguagetool", undefined, "LanguageTool (local, offline)")}
            </option>
            <option value="llm">{t("backendLlm", undefined, "LLM (configured provider)")}</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {t("debounceMs", undefined, "Debounce (ms)")}
          <input
            type="number"
            data-testid="grammar-debounce"
            min={300}
            max={10000}
            value={String(draft.debounceMs)}
            onChange={(e) => setDraft({ ...draft, debounceMs: num(e.target.value, draft.debounceMs) })}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {t("minChars", undefined, "Minimum characters")}
          <input
            type="number"
            data-testid="grammar-minchars"
            min={1}
            max={500}
            value={String(draft.minChars)}
            onChange={(e) => setDraft({ ...draft, minChars: num(e.target.value, draft.minChars) })}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {t("maxChars", undefined, "Maximum characters")}
          <input
            type="number"
            data-testid="grammar-maxchars"
            min={100}
            max={20000}
            value={String(draft.maxChars)}
            onChange={(e) => setDraft({ ...draft, maxChars: num(e.target.value, draft.maxChars) })}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {t("language", undefined, "Language")}
          <input
            type="text"
            data-testid="grammar-language"
            value={draft.language}
            onChange={(e) => setDraft({ ...draft, language: e.target.value })}
          />
        </label>

        {draft.backend === "languagetool" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {t("ltUrl", undefined, "LanguageTool server URL")}
              <span
                data-testid="grammar-lt-health"
                data-reachable={String(health?.reachable === true)}
                style={{
                  fontSize: "10px",
                  color: health?.reachable ? "#34d399" : "#fbbf24",
                }}
              >
                {health?.reachable
                  ? `● ${t("ltReachable", undefined, "reachable")}`
                  : `● ${t("ltUnreachable", undefined, "unreachable")}`}
              </span>
              <button
                type="button"
                data-testid="grammar-lt-test"
                onClick={() => void probeHealth()}
                style={{ fontSize: "10px", padding: "1px 8px" }}
              >
                {t("ltTest", undefined, "Test")}
              </button>
            </span>
            <input
              type="text"
              data-testid="grammar-lt-url"
              value={draft.languagetool.url}
              onChange={(e) =>
                setDraft({ ...draft, languagetool: { ...draft.languagetool, url: e.target.value } })
              }
            />
          </label>
        )}

        {draft.backend === "llm" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {t("llmModel", undefined, "Model")}
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
              <span data-testid="grammar-llm-model-selector-unavailable" style={{ color: "#a1a1aa" }}>
                {t("modelSelectorUnavailable", undefined, "Model selector unavailable")}
              </span>
            )}
          </label>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "10px" }}>
        <button
          type="button"
          data-testid="grammar-save"
          onClick={() => void save()}
          disabled={saving || loading || !dirty}
          style={{ fontSize: "11px", padding: "3px 10px" }}
        >
          {saving ? t("saving", undefined, "Saving…") : t("save", undefined, "Save")}
        </button>
        <button
          type="button"
          data-testid="grammar-reload"
          onClick={() => void load()}
          disabled={saving || loading}
          style={{ fontSize: "11px", padding: "3px 10px" }}
        >
          {t("reload", undefined, "Reload")}
        </button>
        {dirty && (
          <span data-testid="grammar-dirty" style={{ fontSize: "10px", color: "#fbbf24" }}>
            {t("unsaved", undefined, "unsaved")}
          </span>
        )}
      </div>
    </section>
  );
}
