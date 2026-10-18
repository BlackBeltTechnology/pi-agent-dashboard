/**
 * Model cycling scope editor — the `enabledModels` row of the pi settings page.
 *
 * "All models" leaves the key unset; "Selected only" edits a list of provider
 * globs, single-model picks and free patterns against the full model catalogue
 * (including providers without credentials). Pure editing logic lives in
 * `lib/model-scope.ts`; this component only renders it. Catalogue failure shows
 * a notice and no toggles (the page leaves the key out of every patch).
 *
 * See change: pi-settings-full-coverage (design D7).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  addPattern,
  countInScope,
  modelState,
  parseScope,
  providerState,
  removeEntry,
  type ScopeCatalogue,
  type ScopeModel,
  toggleModel,
  toggleProvider,
} from "../../lib/model-scope.js";

export interface ScopeDraft {
  mode: "all" | "selected";
  entries: string[];
}

interface Props {
  draft: ScopeDraft;
  /** `null` while the catalogue loads. */
  catalogue: ScopeCatalogue | null;
  unavailable: boolean;
  /** At-least-one-selection error (page-level validation). */
  error: string | null;
  onChange: (next: ScopeDraft) => void;
}

function ProviderCheckbox({
  provider,
  state,
  count,
  onToggle,
}: {
  provider: string;
  state: "all" | "some" | "none";
  count: number;
  onToggle: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className="flex min-h-7 items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
      <input
        ref={ref}
        type="checkbox"
        data-testid={`pi-settings-scope-provider-${provider}`}
        checked={state === "all"}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span>{provider}</span>
      <span className="font-normal text-[var(--text-tertiary)]">({count})</span>
    </label>
  );
}

function ModelCheckbox({ model, selected, viaPattern, onToggle }: { model: ScopeModel; selected: boolean; viaPattern: boolean; onToggle: (on: boolean) => void }) {
  return (
    <label className="flex min-h-7 items-center gap-2 pl-6 text-xs text-[var(--text-secondary)]">
      <input
        type="checkbox"
        data-testid={`pi-settings-scope-model-${model.full}`}
        checked={selected}
        disabled={viaPattern}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="font-mono">{model.id}</span>
      {viaPattern && <span className="text-[var(--text-tertiary)]">{i18nT("piSettings.scope.viaPattern", undefined, "(covered by a pattern)")}</span>}
    </label>
  );
}

export function ModelScopeEditor({ draft, catalogue, unavailable, error, onChange }: Props) {
  const [filter, setFilter] = useState("");
  const [pattern, setPattern] = useState("");
  const parsed = useMemo(() => (catalogue ? parseScope(draft.entries, catalogue) : null), [draft.entries, catalogue]);

  const setEntries = (entries: string[]) => onChange({ mode: "selected", entries });

  const modeButton = (mode: ScopeDraft["mode"], label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={draft.mode === mode}
      data-testid={`pi-settings-scope-mode-${mode}`}
      onClick={() => onChange({ mode, entries: draft.entries })}
      className={`px-3 py-1 text-xs ${draft.mode === mode ? "bg-[var(--bg-tertiary)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
    >
      {label}
    </button>
  );

  const q = filter.trim().toLowerCase();

  return (
    <div data-testid="pi-settings-scope-editor" className="space-y-2">
      <div role="radiogroup" aria-label={i18nT("piSettings.scope.modeLabel", undefined, "Model cycling scope")} className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)]">
        {modeButton("all", i18nT("piSettings.scope.all", undefined, "All models"))}
        {modeButton("selected", i18nT("piSettings.scope.selected", undefined, "Selected only"))}
      </div>

      {draft.mode === "selected" && unavailable && (
        <div data-testid="pi-settings-scope-unavailable" className="rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]">
          {i18nT("piSettings.scope.unavailable", undefined, "The model catalogue could not be loaded, so the scope cannot be edited here. Edit enabledModels in JSON mode.")}
        </div>
      )}
      {draft.mode === "selected" && !unavailable && !catalogue && (
        <div data-testid="pi-settings-scope-loading" className="text-xs text-[var(--text-tertiary)]">
          {i18nT("piSettings.scope.loading", undefined, "Loading models…")}
        </div>
      )}

      {draft.mode === "selected" && catalogue && parsed && (
        <>
          <input
            type="search"
            aria-label={i18nT("piSettings.scope.filter", undefined, "Filter models")}
            placeholder={i18nT("piSettings.scope.filter", undefined, "Filter models")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs"
          />
          <div className="max-h-80 space-y-1 overflow-auto rounded border border-[var(--border-primary)] p-2">
            {[...catalogue.providers.entries()].map(([provider, models]) => {
              const shown = q ? models.filter((m) => `${provider}/${m.id}`.toLowerCase().includes(q)) : models;
              if (q && shown.length === 0) return null;
              return (
                <div key={provider}>
                  <ProviderCheckbox
                    provider={provider}
                    state={providerState(parsed, provider, catalogue)}
                    count={models.length}
                    onToggle={(on) => setEntries(toggleProvider(draft.entries, catalogue, provider, on))}
                  />
                  <details open={q !== ""}>
                    <summary className="cursor-pointer pl-6 text-[11px] text-[var(--text-tertiary)]">
                      {i18nT("piSettings.scope.models", undefined, "Models")}
                    </summary>
                    {shown.map((m) => {
                      const st = modelState(parsed, m);
                      return (
                        <ModelCheckbox
                          key={m.full}
                          model={m}
                          selected={st.selected}
                          viaPattern={st.viaPattern}
                          onToggle={(on) => setEntries(toggleModel(draft.entries, catalogue, m, on))}
                        />
                      );
                    })}
                  </details>
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <div className="text-xs text-[var(--text-secondary)]">{i18nT("piSettings.scope.patterns", undefined, "Patterns (globs such as *sonnet* or openrouter/*)")}</div>
            <div className="flex flex-wrap items-center gap-1">
              {parsed.patterns.map((p) => (
                <span key={p.raw} className="inline-flex items-center gap-1 rounded border border-[var(--tint-green-border)] bg-[var(--tint-green-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--tint-green-fg)]">
                  {p.raw}
                  <button
                    type="button"
                    data-testid={`pi-settings-scope-pattern-remove-${p.raw}`}
                    aria-label={i18nT("piSettings.scope.removePattern", { pattern: p.raw }, `Remove pattern ${p.raw}`)}
                    onClick={() => setEntries(removeEntry(draft.entries, p.raw))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                data-testid="pi-settings-scope-pattern-input"
                aria-label={i18nT("piSettings.scope.patternInput", undefined, "Add pattern")}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEntries(addPattern(draft.entries, pattern));
                    setPattern("");
                  }
                }}
                className="w-56 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                data-testid="pi-settings-scope-pattern-add"
                onClick={() => {
                  setEntries(addPattern(draft.entries, pattern));
                  setPattern("");
                }}
                className="rounded border border-[var(--border-secondary)] px-2 py-1 text-xs"
              >
                {i18nT("piSettings.scope.addPattern", undefined, "Add")}
              </button>
            </div>
          </div>
        </>
      )}

      {draft.mode === "selected" && catalogue && (
        <div data-testid="pi-settings-scope-count" className="text-xs text-[var(--text-secondary)]" aria-live="polite">
          {i18nT(
            "piSettings.scope.count",
            { n: countInScope(draft.entries, catalogue), total: catalogue.models.length },
            `${countInScope(draft.entries, catalogue)} of ${catalogue.models.length} catalogue models in scope (pi further limits this to models with credentials).`,
          )}
        </div>
      )}
      {draft.mode === "selected" && catalogue && (
        <pre data-testid="pi-settings-scope-preview" className="overflow-auto rounded bg-[var(--bg-tertiary)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
          {`"enabledModels": ${JSON.stringify(draft.entries)}`}
        </pre>
      )}
      {error && (
        <div role="alert" data-testid="pi-settings-scope-error" className="text-xs text-[var(--severity-error-fg)]">
          {error}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-tertiary)]">
        {i18nT("piSettings.scope.rolesNote", undefined, "This does not restrict roles or subagents.")}{" "}
        {i18nT("piSettings.scope.autoAppendNote", undefined, "pi adds the current default model to the list when it is missing, so the saved file may gain an entry.")}
      </p>
    </div>
  );
}
