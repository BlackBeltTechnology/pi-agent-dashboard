/**
 * pi settings section — edits pi's GLOBAL `~/.pi/agent/settings.json` through
 * `/api/pi-settings*`: a typed Form for the curated keys and a JSON editor for
 * the whole file. The three default-model keys are read-only here (owned by the
 * Default model control); a drift-repair action re-applies the dashboard
 * default to pi when the two differ.
 *
 * Commits through the panel's UNIFIED Save (no private Save button), holding a
 * draft for ONE mode at a time — a dirty draft is never converted between
 * modes. A `409` shows a conflict banner (reload from disk, never auto-merge);
 * a `400` keeps the draft dirty with per-field errors; `413`/`503` are failed
 * commits. Saving reloads running sessions server-side.
 *
 * See change: edit-pi-agent-settings (design D8, spec
 * `pi-agent-settings-editor`).
 */
import { useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PI_MANAGED_SETTINGS_KEYS } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-keys.js";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { mdiAlert, mdiInformationOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ComponentType, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  getPiSettings,
  PiSettingsApiError,
  type PiSettingsFieldError,
  type PiSettingsPatch,
  type PiSettingsReadResponse,
  type PiSettingsSyncResponse,
  type PiSettingsWriteResponse,
  patchPiSettings,
  putPiSettingsRaw,
  syncPiDefaults,
} from "../../lib/api/pi-settings-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const DefaultJsonEditor = lazy(() => import("./PiSettingsJsonEditor.js"));

type Mode = "form" | "json";

type FieldKind = "bool" | "int" | "choice";

interface FieldDef {
  /** Dotted pi key, e.g. `compaction.reserveTokens`. */
  key: string;
  kind: FieldKind;
  label: string;
  hint: string;
  /** `choice` options (string form of the stored value). */
  options?: string[];
}

const MODES = ["all", "one-at-a-time"];

/** Curated typed keys (design D3). Order = render order. */
const FIELDS: FieldDef[] = [
  { key: "compaction.enabled", kind: "bool", label: "Auto-compaction", hint: "Compact long conversations automatically" },
  { key: "compaction.reserveTokens", kind: "int", label: "Compaction reserve tokens", hint: "Tokens kept free for the reply" },
  { key: "compaction.keepRecentTokens", kind: "int", label: "Compaction keep-recent tokens", hint: "Recent tokens never summarised" },
  { key: "branchSummary.reserveTokens", kind: "int", label: "Branch summary reserve tokens", hint: "Tokens kept free for a branch summary" },
  { key: "branchSummary.skipPrompt", kind: "bool", label: "Skip branch summary prompt", hint: "Do not ask before summarising a branch" },
  { key: "steeringMode", kind: "choice", options: MODES, label: "Steering mode", hint: "How queued steering messages are delivered" },
  { key: "followUpMode", kind: "choice", options: MODES, label: "Follow-up mode", hint: "How queued follow-ups are delivered" },
  { key: "defaultProjectTrust", kind: "choice", options: ["ask", "always", "never"], label: "Default project trust", hint: "Trust applied to a new project" },
  { key: "hideThinkingBlock", kind: "bool", label: "Hide thinking blocks", hint: "Collapse model reasoning in pi's TUI" },
  { key: "quietStartup", kind: "choice", options: ["true", "false", "header"], label: "Quiet startup", hint: "Reduce pi's startup output" },
];

type FormState = Record<string, string>;

const getPath = (obj: Record<string, unknown>, key: string): unknown => {
  const [head, leaf] = key.split(".");
  if (leaf === undefined) return obj[head];
  const block = obj[head];
  return block && typeof block === "object" ? (block as Record<string, unknown>)[leaf] : undefined;
};

function toForm(settings: Record<string, unknown>): FormState {
  const f: FormState = {};
  for (const def of FIELDS) {
    const v = getPath(settings, def.key);
    f[def.key] = v === undefined || v === null ? "" : String(v);
  }
  return f;
}

/** Form value → typed patch value (`null` = delete). Throws a message on bad input. */
function parseField(def: FieldDef, raw: string): unknown {
  if (raw === "") return null;
  if (def.kind === "int") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${def.label} must be a non-negative integer`);
    return n;
  }
  if (def.kind === "bool" || def.key === "quietStartup") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return raw;
}

/** Leaf diff of the form against its baseline, as a nested patch. */
function buildPatch(form: FormState, base: FormState): PiSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const def of FIELDS) {
    if (form[def.key] === base[def.key]) continue;
    const value = parseField(def, form[def.key]);
    const [head, leaf] = def.key.split(".");
    if (leaf === undefined) patch[head] = value;
    else {
      const block = (patch[head] ?? {}) as Record<string, unknown>;
      block[leaf] = value;
      patch[head] = block;
    }
  }
  return patch as PiSettingsPatch;
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** What the dashboard default would write to pi (mirrors the server's D1 rules). */
export function deriveMirror(d: { defaultModel?: string; defaultThinkingLevel?: string }): {
  provider?: string;
  model?: string;
  level?: string;
} {
  const out: { provider?: string; model?: string; level?: string } = {};
  const model = (d.defaultModel ?? "").trim();
  const slash = model.indexOf("/");
  if (slash > 0 && slash < model.length - 1) {
    out.provider = model.slice(0, slash);
    out.model = model.slice(slash + 1);
  }
  const level = (d.defaultThinkingLevel ?? "").trim();
  // Only a valid level is ever mirrored (server rule); anything else is not drift.
  if ((THINKING_LEVELS as readonly string[]).includes(level)) out.level = level;
  return out;
}

export interface PiSettingsJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
}

interface Props {
  /** Injectable for tests. Default to the REST helpers. */
  load?: () => Promise<PiSettingsReadResponse>;
  save?: (
    req: { mode: "form"; patch: PiSettingsPatch; baseEtag: string } | { mode: "json"; raw: string; baseEtag: string },
  ) => Promise<PiSettingsWriteResponse>;
  syncDefaults?: () => Promise<PiSettingsSyncResponse>;
  /** Persisted (saved) dashboard defaults — the drift baseline. */
  dashboardDefaults?: { defaultModel?: string; defaultThinkingLevel?: string };
  /** Bumped by the host after a config save so mirrored keys re-read. */
  refreshKey?: number;
  /** JSON editor component; defaults to a lazy Monaco editor. */
  JsonEditor?: ComponentType<PiSettingsJsonEditorProps>;
}

const defaultSave: NonNullable<Props["save"]> = (req) =>
  req.mode === "form" ? patchPiSettings(req.patch, req.baseEtag) : putPiSettingsRaw(req.raw, req.baseEtag);

const SELECT_CLASS =
  "w-44 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs";

export function PiSettingsSection({
  load = getPiSettings,
  save = defaultSave,
  syncDefaults = syncPiDefaults,
  dashboardDefaults,
  refreshKey = 0,
  JsonEditor = DefaultJsonEditor,
}: Props) {
  const [loaded, setLoaded] = useState<PiSettingsReadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("form");
  const [form, setForm] = useState<FormState>({});
  const [formBase, setFormBase] = useState<FormState>({});
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonBase, setJsonBase] = useState("");
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PiSettingsFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Replace the whole baseline + both drafts with a server snapshot. */
  const adopt = useCallback((s: Pick<PiSettingsReadResponse, "settings" | "raw" | "etag" | "parseError">) => {
    setLoaded({ success: true, ...s });
    const f = toForm(s.settings);
    setForm(f);
    setFormBase(f);
    const text = s.raw === "" ? "{}\n" : s.raw;
    setJsonDraft(text);
    setJsonBase(text);
  }, []);

  const clearMessages = useCallback(() => {
    setError(null);
    setFieldErrors([]);
    setConflict(false);
    setStatus(null);
  }, []);

  useEffect(() => {
    let alive = true;
    load()
      .then((s) => {
        if (!alive) return;
        adopt(s);
        if (s.parseError) setMode("json");
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load, adopt]);

  const formDirty = loaded !== null && JSON.stringify(form) !== JSON.stringify(formBase);
  const jsonDirty = loaded !== null && jsonDraft !== jsonBase;
  const isDirty = mode === "form" ? formDirty : jsonDirty;

  /** Re-read only what the config save / drift repair can change: the mirrored keys. */
  const refreshManaged = useCallback(
    (s: Pick<PiSettingsReadResponse, "settings" | "raw" | "etag" | "parseError">) => {
      if (!formDirty && !jsonDirty) {
        adopt(s);
        return;
      }
      setLoaded((prev) => {
        if (!prev) return prev;
        const settings = { ...prev.settings };
        for (const k of PI_MANAGED_SETTINGS_KEYS) {
          if (k in s.settings) settings[k] = s.settings[k];
          else delete settings[k];
        }
        return { ...prev, settings };
      });
    },
    [adopt, formDirty, jsonDirty],
  );

  useEffect(() => {
    if (refreshKey === 0) return;
    load()
      .then(refreshManaged)
      .catch(() => {
        /* advisory refresh only */
      });
    // refreshManaged intentionally omitted: only a host-side bump should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const commit = useCallback(async () => {
    if (!loaded) throw new Error("pi settings not loaded");
    clearMessages();
    try {
      let res: PiSettingsWriteResponse;
      if (mode === "form") {
        res = await save({ mode: "form", patch: buildPatch(form, formBase), baseEtag: loaded.etag });
      } else {
        try {
          JSON.parse(stripBom(jsonDraft));
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          throw new Error(i18nT("piSettings.invalidJson", { error: detail }, `Invalid JSON: ${detail}`));
        }
        res = await save({ mode: "json", raw: jsonDraft, baseEtag: loaded.etag });
      }
      adopt(res);
      setStatus(
        i18nT("piSettings.saved", { n: res.reloadedSessions }, `Saved. Reloaded ${res.reloadedSessions} connected session(s).`),
      );
    } catch (e) {
      if (e instanceof PiSettingsApiError) {
        if (e.status === 409) setConflict(true);
        else if (e.fieldErrors.length > 0) setFieldErrors(e.fieldErrors);
        else setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
  }, [loaded, mode, form, formBase, jsonDraft, save, adopt, clearMessages]);

  const reset = useCallback(() => {
    setForm(formBase);
    setJsonDraft(jsonBase);
    clearMessages();
  }, [formBase, jsonBase, clearMessages]);

  // page: "sessions" — must match the tab this section renders on.
  useSettingsDraftSource({ id: "pi-settings", page: "sessions", isDirty, commit, reset });

  const reloadFromDisk = useCallback(async () => {
    clearMessages();
    try {
      const s = await load();
      adopt(s);
      if (s.parseError) setMode("json");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load, adopt, clearMessages]);

  const requestMode = (next: Mode) => {
    if (next === mode) return;
    if (isDirty) setPendingMode(next);
    else {
      clearMessages();
      setMode(next);
    }
  };

  const confirmSwitch = () => {
    reset();
    if (pendingMode) setMode(pendingMode);
    setPendingMode(null);
  };

  const applyDefaults = useCallback(async () => {
    clearMessages();
    try {
      const res = await syncDefaults();
      refreshManaged(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [syncDefaults, refreshManaged, clearMessages]);

  // ── Derived display state ─────────────────────────────────────────
  const piSettings = loaded?.settings ?? {};
  const drift = useMemo(() => {
    const d = deriveMirror(dashboardDefaults ?? {});
    const modelDrift = d.provider !== undefined && (piSettings.defaultProvider !== d.provider || piSettings.defaultModel !== d.model);
    const levelDrift = d.level !== undefined && piSettings.defaultThinkingLevel !== d.level;
    return modelDrift || levelDrift;
  }, [dashboardDefaults, piSettings]);

  const changedManaged = useMemo(() => {
    if (mode !== "json" || !loaded) return [] as string[];
    let parsed: Record<string, unknown>;
    try {
      const p: unknown = JSON.parse(stripBom(jsonDraft));
      if (!p || typeof p !== "object" || Array.isArray(p)) return [];
      parsed = p as Record<string, unknown>;
    } catch {
      return [];
    }
    return PI_MANAGED_SETTINGS_KEYS.filter((k) => JSON.stringify(parsed[k]) !== JSON.stringify(loaded.settings[k]));
  }, [mode, jsonDraft, loaded]);

  const setField = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const renderField = (def: FieldDef) => {
    const label = i18nT(`piSettings.field.${def.key}`, undefined, def.label);
    const hint = i18nT(`piSettings.hint.${def.key}`, undefined, def.hint);
    const value = form[def.key] ?? "";
    const options = def.kind === "bool" ? ["true", "false"] : (def.options ?? []);
    const withCurrent = value !== "" && !options.includes(value) ? [...options, value] : options;
    return (
      <label key={def.key} className="flex items-center gap-2 text-xs">
        <span className="w-52 text-[var(--text-primary)]">{label}</span>
        {def.kind === "int" ? (
          <input
            type="number"
            min={0}
            step={1}
            data-testid={`pi-settings-field-${def.key}`}
            value={value}
            placeholder={i18nT("piSettings.piDefault", undefined, "pi default")}
            onChange={(e) => setField(def.key, e.target.value)}
            className="w-44 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1"
          />
        ) : (
          <select
            data-testid={`pi-settings-field-${def.key}`}
            value={value}
            onChange={(e) => setField(def.key, e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{i18nT("piSettings.piDefault", undefined, "pi default")}</option>
            {withCurrent.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <span className="text-[var(--text-muted)]">{hint}</span>
      </label>
    );
  };

  const banner = (testId: string, tone: "warning" | "info" | "error", children: React.ReactNode) => (
    <div
      data-testid={testId}
      className={`flex items-start gap-2 rounded border px-3 py-2 text-xs border-[var(--severity-${tone}-border)] bg-[var(--severity-${tone}-bg)] text-[var(--severity-${tone}-fg)]`}
    >
      <Icon path={tone === "info" ? mdiInformationOutline : mdiAlert} size={0.6} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );

  return (
    <section data-testid="pi-settings-section" className="space-y-3">
      <p className="text-xs text-[var(--text-tertiary)]">
        {i18nT("piSettings.subtitle", undefined, "pi's own global settings file (~/.pi/agent/settings.json).")}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <Icon path={mdiLoading} size={0.6} className="animate-spin" />
          {i18nT("common.loading", undefined, "Loading…")}
        </div>
      ) : loadError ? (
        <div data-testid="pi-settings-load-error" className="text-xs text-[var(--severity-error-fg)]">
          {loadError}
        </div>
      ) : (
        <>
          <div role="group" aria-label="pi settings mode" className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)] text-xs">
            {(["form", "json"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`pi-settings-mode-${m}`}
                aria-pressed={mode === m}
                onClick={() => requestMode(m)}
                className={`px-3 py-1 ${mode === m ? "bg-[var(--bg-tertiary)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
              >
                {m === "form" ? i18nT("piSettings.modeForm", undefined, "Form") : i18nT("piSettings.modeJson", undefined, "JSON")}
              </button>
            ))}
          </div>

          {pendingMode && (
            <div data-testid="pi-settings-switch-prompt" className="flex items-center gap-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]">
              <span>{i18nT("piSettings.switchPrompt", undefined, "Switching mode discards your unsaved changes.")}</span>
              <button type="button" data-testid="pi-settings-switch-stay" onClick={() => setPendingMode(null)} className="rounded border px-2 py-0.5">
                {i18nT("piSettings.stay", undefined, "Stay")}
              </button>
              <button type="button" data-testid="pi-settings-switch-discard" onClick={confirmSwitch} className="rounded border px-2 py-0.5">
                {i18nT("piSettings.discard", undefined, "Discard and switch")}
              </button>
            </div>
          )}

          {loaded?.parseError &&
            banner(
              "pi-settings-parse-error",
              "warning",
              i18nT(
                "piSettings.parseError",
                { error: loaded.parseError },
                `settings.json is not valid JSON (${loaded.parseError}). Repair it in JSON mode.`,
              ),
            )}

          {mode === "form" ? (
            <div className="space-y-2">
              {FIELDS.map(renderField)}
              <div className="space-y-1 border-t border-[var(--border-primary)] pt-2">
                {PI_MANAGED_SETTINGS_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-52 text-[var(--text-primary)]">{k}</span>
                    <span data-testid={`pi-settings-managed-${k}`} className="font-mono text-[var(--text-secondary)]">
                      {piSettings[k] === undefined ? "—" : String(piSettings[k])}
                    </span>
                  </div>
                ))}
                <p data-testid="pi-settings-managed-note" className="text-[10.5px] text-[var(--text-muted)]">
                  {i18nT("piSettings.managedNote", undefined, "Mirrored from the Default model control above — change them there.")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Suspense fallback={<div className="p-4 text-xs text-[var(--text-tertiary)]">Loading editor…</div>}>
                <JsonEditor value={jsonDraft} onChange={setJsonDraft} />
              </Suspense>
              {changedManaged.length > 0 &&
                banner(
                  "pi-settings-managed-notice",
                  "warning",
                  i18nT(
                    "piSettings.managedNotice",
                    { keys: changedManaged.join(", ") },
                    `${changedManaged.join(", ")} ${changedManaged.length === 1 ? "is" : "are"} managed by the Default model control and will not be written.`,
                  ),
                )}
            </div>
          )}

          {drift &&
            banner(
              "pi-settings-drift",
              "info",
              <span className="flex flex-wrap items-center gap-2">
                {i18nT("piSettings.drift", undefined, "pi's default model differs from the dashboard default.")}
                <button type="button" data-testid="pi-settings-sync-defaults" onClick={() => void applyDefaults()} className="rounded border px-2 py-0.5">
                  {i18nT("piSettings.applyDefaults", undefined, "Apply dashboard default to pi")}
                </button>
              </span>,
            )}

          {conflict && (
            <div data-testid="pi-settings-conflict" className="flex items-center gap-2 rounded border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] px-3 py-2 text-xs text-[var(--severity-error-fg)]">
              <span>{i18nT("piSettings.conflict", undefined, "settings.json changed on disk since you opened it. Your edits were not written.")}</span>
              <button type="button" data-testid="pi-settings-reload" onClick={() => void reloadFromDisk()} className="rounded border px-2 py-0.5">
                {i18nT("piSettings.reloadFromDisk", undefined, "Reload from disk")}
              </button>
            </div>
          )}

          {fieldErrors.length > 0 && (
            <ul data-testid="pi-settings-errors" className="list-disc pl-5 text-xs text-[var(--severity-error-fg)]">
              {fieldErrors.map((e) => (
                <li key={`${e.field}:${e.message}`}>{e.message}</li>
              ))}
            </ul>
          )}
          {error && (
            <div data-testid="pi-settings-error" className="text-xs text-[var(--severity-error-fg)]">
              {error}
            </div>
          )}

          {banner(
            "pi-settings-notes",
            "info",
            <>
              <span data-testid="pi-settings-reload-note">
                {i18nT("piSettings.reloadNote", undefined, "Saving reloads running sessions so changes take effect right away.")}
              </span>{" "}
              <span data-testid="pi-settings-scope-note">
                {i18nT("piSettings.scopeNote", undefined, "Edits the global file only — a project .pi/settings.json may override these values at runtime.")}
              </span>
            </>,
          )}

          {status && (
            <div data-testid="pi-settings-save-status" className="text-xs text-[var(--severity-success-fg)]">
              {status}
            </div>
          )}
        </>
      )}
    </section>
  );
}
