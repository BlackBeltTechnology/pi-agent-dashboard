import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Icon } from "@mdi/react";
import { mdiTranslate, mdiLoading, mdiChevronDown } from "@mdi/js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { translateText } from "../lib/translate-api.js";

const STORAGE_KEY = "pi-dashboard.translateModel"; // value: "<provider>/<modelId>"

interface Props {
  /** Available models from the bridge. May be undefined while loading. */
  models?: ModelInfo[];
  /** Current input text. Empty string disables the button. */
  text: string;
  /** Called with the English translation. */
  onTranslated: (translated: string) => void;
  /** Disabled when the input is busy (sending, pendingPrompt, etc.). */
  disabled?: boolean;
}

interface StoredSelection {
  provider: string;
  model: string;
}

function readStored(): StoredSelection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const slash = raw.indexOf("/");
    if (slash <= 0) return null;
    return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
  } catch {
    return null;
  }
}

function writeStored(provider: string, model: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, `${provider}/${model}`);
  } catch {
    // ignore quota / privacy errors
  }
}

export function TranslateButton({ models, text, onTranslated, disabled }: Props) {
  const [selected, setSelected] = useState<StoredSelection | null>(() => readStored());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Group models by provider for the dropdown. Every model from models_list
  // is selectable — the server picks the right execution path (direct HTTP
  // for providers.json entries, or bridge forwarding for pi OAuth providers
  // like opencode-go whose tokens live inside pi's auth.json).
  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of models ?? []) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [models]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Auto-clear error after 6s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const selectModel = useCallback((provider: string, model: string) => {
    setSelected({ provider, model });
    writeStored(provider, model);
    setOpen(false);
  }, []);

  const handleTranslate = useCallback(async () => {
    if (busy || !text.trim()) return;
    if (!selected) {
      setError("Pick a model first.");
      setOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await translateText({
      provider: selected.provider,
      model: selected.model,
      text,
    });
    setBusy(false);
    if (res.ok) {
      onTranslated(res.translated);
    } else {
      setError(res.error);
    }
  }, [busy, text, selected, onTranslated]);

  const buttonDisabled = disabled || busy || !text.trim();
  const label = selected ? `${selected.provider}/${selected.model}` : "pick model";
  const hasModels = grouped.length > 0;

  return (
    <div className="relative" ref={wrapperRef}>
      {/* Ghost chip matching ModelSelector / ThinkingLevelSelector — no outer box. */}
      <div className="inline-flex h-8 items-stretch overflow-hidden rounded-md">
        <button
          onClick={handleTranslate}
          disabled={buttonDisabled}
          className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={
            selected
              ? `Translate to English (${label})`
              : "Pick a model, then translate to English"
          }
          data-testid="translate-button"
        >
          {busy ? (
            <Icon path={mdiLoading} size={0.65} spin={1} />
          ) : (
            <Icon path={mdiTranslate} size={0.65} />
          )}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || busy}
          className="focus-ring inline-flex h-8 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Pick translation model"
          aria-label="Pick translation model"
          data-testid="translate-model-picker"
        >
          <Icon path={mdiChevronDown} size={0.5} />
        </button>
      </div>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-64 max-h-64 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-md shadow-lg z-20 text-xs">
          {!hasModels && (
            <div className="px-3 py-2 text-[var(--text-tertiary)]">
              No models available yet.
            </div>
          )}
          {grouped.map(([provider, list]) => (
            <div key={provider}>
              <div className="px-3 py-1 text-[var(--text-tertiary)] uppercase tracking-wide text-[10px] sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
                {provider}
              </div>
              {list.map((m) => {
                const active =
                  selected?.provider === m.provider && selected?.model === m.id;
                return (
                  <button
                    key={`${m.provider}/${m.id}`}
                    onClick={() => selectModel(m.provider, m.id)}
                    className={`w-full px-3 py-2 text-left font-mono ${
                      active
                        ? "bg-[var(--bg-tertiary)] text-blue-400"
                        : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {m.id}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="absolute bottom-full right-0 mb-1 w-72 px-3 py-2 bg-red-900/90 border border-red-700 rounded-md text-xs text-red-100 shadow-lg z-30" data-testid="translate-error">
          <div className="font-semibold mb-0.5">Translation failed</div>
          <div className="break-words">{error}</div>
        </div>
      )}
    </div>
  );
}
