/**
 * pi settings page — edits pi's GLOBAL `~/.pi/agent/settings.json` through
 * `/api/pi-settings*`: a schema-driven typed Form for every simple pi key, the
 * model cycling scope editor, and a JSON editor for the whole file. The three
 * default-model keys are read-only here (owned by the Default model control); a
 * drift-repair action re-applies the dashboard default to pi when they differ.
 * Plain-text API keys left in the file are listed masked, with a queued
 * move/remove cleanup (Form mode only).
 *
 * Commits through the panel's UNIFIED Save (no private Save button), holding a
 * draft for ONE mode at a time — a dirty draft is never converted between
 * modes. `commit()` order (design D9): validate → precompute the patch →
 * legacy cleanup → patch with the cleanup's token. A `409` shows a conflict
 * banner (reload from disk, never auto-merge); a `400` keeps the draft dirty
 * with per-field errors; `413`/`503` are failed commits.
 *
 * See change: pi-settings-full-coverage (design D1, D7–D11); edit-pi-agent-settings.
 */
import { useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PI_MANAGED_SETTINGS_KEYS } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-keys.js";
import { PI_SETTING_CATEGORIES, PI_SETTINGS_SCHEMA, type PiSettingDef } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-schema.js";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { mdiAlert, mdiInformationOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ComponentType, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchScopeCatalogue, type ScopeCatalogueResult } from "../../lib/api/models-api.js";
import {
  getPiSettings,
  migrateLegacyCredentials,
  type PiLegacyCredential,
  type PiLegacyCredentialsResponse,
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
import { buildScopeCatalogue, type ScopeCatalogue, sameScopeEntries } from "../../lib/model-scope.js";
import { ModelScopeEditor, type ScopeDraft } from "./ModelScopeEditor.js";
import { type LegacyAction, type LegacyQueue, PiLegacyCredentialsWarning } from "./PiLegacyCredentialsWarning.js";
import { EditorRow, ExtraSettingRow, SettingRow } from "./PiSettingsRows.js";
import {
  buildFormPatch,
  changedFieldErrors,
  DASHBOARD_MANAGED_KEYS,
  ENABLED_MODELS_DEF,
  EXTRA_ROWS,
  type ExtraRow,
  type FormState,
  getSettingValue,
  toForm,
} from "./pi-settings-form.js";

const DefaultJsonEditor = lazy(() => import("./PiSettingsJsonEditor.js"));

type Mode = "form" | "json";

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

type SaveRequest =
  | { mode: "form"; patch: PiSettingsPatch; baseEtag: string }
  | { mode: "json"; raw: string; baseEtag: string };

interface Props {
  /** Injectable for tests. Default to the REST helpers. */
  load?: () => Promise<PiSettingsReadResponse>;
  save?: (req: SaveRequest) => Promise<PiSettingsWriteResponse>;
  syncDefaults?: () => Promise<PiSettingsSyncResponse>;
  /** Legacy-credential cleanup (move/remove). */
  migrate?: (actions: { key: string; action: LegacyAction }[], baseEtag: string) => Promise<PiLegacyCredentialsResponse>;
  /** Full model catalogue for the scope editor. */
  loadCatalogue?: () => Promise<ScopeCatalogueResult>;
  /** Open another settings page (link rows). */
  onNavigate?: (page: string) => void;
  /** Persisted (saved) dashboard defaults — the drift baseline. */
  dashboardDefaults?: { defaultModel?: string; defaultThinkingLevel?: string };
  /** Bumped by the host after a config save so mirrored keys re-read. */
  refreshKey?: number;
  /** JSON editor component; defaults to a lazy Monaco editor. */
  JsonEditor?: ComponentType<PiSettingsJsonEditorProps>;
}

const defaultSave: NonNullable<Props["save"]> = (req) =>
  req.mode === "form" ? patchPiSettings(req.patch, req.baseEtag) : putPiSettingsRaw(req.raw, req.baseEtag);

type Snapshot = Pick<PiSettingsReadResponse, "settings" | "raw" | "etag" | "parseError"> & {
  themes?: string[];
  legacyCredentials?: PiLegacyCredential[];
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Client-side JSON syntax check of the JSON-mode draft; null when it parses. */
function jsonSyntaxError(text: string): string | null {
  try {
    JSON.parse(stripBom(text));
    return null;
  } catch (e) {
    const detail = errorMessage(e);
    return i18nT("piSettings.invalidJson", { error: detail }, `Invalid JSON: ${detail}`);
  }
}

/** Copy only the mirrored default keys from a fresh read, leaving every other loaded key alone. */
function mergeManagedKeys(settings: Record<string, unknown>, fresh: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...settings };
  for (const k of PI_MANAGED_SETTINGS_KEYS) {
    if (k in fresh) merged[k] = fresh[k];
    else delete merged[k];
  }
  return merged;
}

/** True when a derived dashboard default exists and differs from pi's value. */
function hasDrift(
  defaults: { defaultModel?: string; defaultThinkingLevel?: string } | undefined,
  pi: Record<string, unknown>,
): boolean {
  const d = deriveMirror(defaults ?? {});
  const modelDrift = d.provider !== undefined && (pi.defaultProvider !== d.provider || pi.defaultModel !== d.model);
  return modelDrift || (d.level !== undefined && pi.defaultThinkingLevel !== d.level);
}

/** Managed keys whose value in the JSON draft differs from what was loaded. */
function changedManagedKeys(jsonDraft: string, loaded: Record<string, unknown>): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(jsonDraft));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const draft = parsed as Record<string, unknown>;
  return PI_MANAGED_SETTINGS_KEYS.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(loaded[k]));
}

// ── enabledModels draft ───────────────────────────────────────────────

const SCOPE_ALL: ScopeDraft = { mode: "all", entries: [] };

/** Stored `enabledModels` → draft. A stored empty array is "All models" (pi treats it so). */
function toScopeDraft(settings: Record<string, unknown>): ScopeDraft {
  const raw = settings.enabledModels;
  const entries = Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string" && e !== "") : [];
  return entries.length > 0 ? { mode: "selected", entries } : SCOPE_ALL;
}

/** The mode switch counts as a change; "Selected only" compares as a set of entries. */
function scopeChanged(draft: ScopeDraft, base: ScopeDraft): boolean {
  if (draft.mode !== base.mode) return true;
  return draft.mode === "selected" && !sameScopeEntries(draft.entries, base.entries);
}

// ── Legacy queue ──────────────────────────────────────────────────────

/** Drop queued actions whose key is gone or whose key's auth state no longer allows them. */
function reconcileQueue(queue: LegacyQueue, list: readonly PiLegacyCredential[]): LegacyQueue {
  const next: Record<string, LegacyAction> = {};
  for (const [key, action] of Object.entries(queue)) {
    const item = list.find((i) => i.key === key);
    if (!item) continue;
    if (action === "move" ? item.auth === "none" && item.provider !== null : item.auth === "same") next[key] = action;
  }
  return next;
}

// ── Small presentational pieces ───────────────────────────────────────

function Banner({ testId, tone, children }: { testId: string; tone: "warning" | "info"; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className={`flex items-start gap-2 rounded border px-3 py-2 text-xs border-[var(--severity-${tone}-border)] bg-[var(--severity-${tone}-bg)] text-[var(--severity-${tone}-fg)]`}
    >
      <Icon path={tone === "info" ? mdiInformationOutline : mdiAlert} size={0.6} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** JSON mode: the whole-file editor plus the pre-save managed-key notice. */
function JsonPane({
  Editor,
  value,
  onChange,
  changedManaged,
}: {
  Editor: ComponentType<PiSettingsJsonEditorProps>;
  value: string;
  onChange: (v: string) => void;
  changedManaged: string[];
}) {
  return (
    <div className="space-y-2">
      <Suspense fallback={<div className="p-4 text-xs text-[var(--text-tertiary)]">{i18nT("piSettings.loadingEditor", undefined, "Loading editor…")}</div>}>
        <Editor value={value} onChange={onChange} />
      </Suspense>
      {changedManaged.length > 0 && (
        <Banner testId="pi-settings-managed-notice" tone="warning">
          {i18nT(
            "piSettings.managedNotice",
            { keys: changedManaged.join(", ") },
            `${changedManaged.join(", ")} ${changedManaged.length === 1 ? "is" : "are"} managed by the Default model control and will not be written.`,
          )}
        </Banner>
      )}
    </div>
  );
}

function ModeSwitch({ mode, onSelect }: { mode: Mode; onSelect: (m: Mode) => void }) {
  return (
    <div
      role="group"
      aria-label={i18nT("piSettings.modeLabel", undefined, "pi settings mode")}
      className="inline-flex overflow-hidden rounded border border-[var(--border-secondary)] text-xs"
    >
      {(["form", "json"] as const).map((m) => (
        <button
          key={m}
          type="button"
          data-testid={`pi-settings-mode-${m}`}
          aria-pressed={mode === m}
          onClick={() => onSelect(m)}
          className={`px-3 py-1 ${mode === m ? "bg-[var(--bg-tertiary)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
        >
          {m === "form" ? i18nT("piSettings.modeForm", undefined, "Form") : i18nT("piSettings.modeJson", undefined, "JSON")}
        </button>
      ))}
    </div>
  );
}

function SwitchPrompt({ onStay, onDiscard }: { onStay: () => void; onDiscard: () => void }) {
  return (
    <div
      data-testid="pi-settings-switch-prompt"
      className="flex items-center gap-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-xs text-[var(--severity-warning-fg)]"
    >
      <span>{i18nT("piSettings.switchPrompt", undefined, "Switching mode discards your unsaved changes.")}</span>
      <button type="button" data-testid="pi-settings-switch-stay" onClick={onStay} className="rounded border px-2 py-0.5">
        {i18nT("piSettings.stay", undefined, "Stay")}
      </button>
      <button type="button" data-testid="pi-settings-switch-discard" onClick={onDiscard} className="rounded border px-2 py-0.5">
        {i18nT("piSettings.discard", undefined, "Discard and switch")}
      </button>
    </div>
  );
}

/** Conflict / validation / transport messages for the last failed action. */
function Feedback({
  conflict,
  fieldErrors,
  error,
  status,
  onReload,
}: {
  conflict: boolean;
  fieldErrors: PiSettingsFieldError[];
  error: string | null;
  status: string | null;
  onReload: () => void;
}) {
  return (
    <>
      {conflict && (
        <div
          data-testid="pi-settings-conflict"
          className="flex items-center gap-2 rounded border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] px-3 py-2 text-xs text-[var(--severity-error-fg)]"
        >
          <span>{i18nT("piSettings.conflict", undefined, "settings.json changed on disk since you opened it. Your edits were not written.")}</span>
          <button type="button" data-testid="pi-settings-reload" onClick={onReload} className="rounded border px-2 py-0.5">
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
      {status && (
        <div data-testid="pi-settings-save-status" className="text-xs text-[var(--severity-success-fg)]">
          {status}
        </div>
      )}
    </>
  );
}

// ── Row model ─────────────────────────────────────────────────────────

type RowModel =
  | { kind: "typed"; key: string; def: PiSettingDef }
  | { kind: "scope"; key: string }
  | { kind: "extra"; key: string; row: ExtraRow };

interface CategoryModel {
  id: string;
  label: string;
  rows: RowModel[];
}

/** Rows per category: schema order (the scope row sits where `enabledModels` is), extras after, Default model first. */
function buildCategories(): CategoryModel[] {
  return PI_SETTING_CATEGORIES.map((c) => {
    const typed: RowModel[] = PI_SETTINGS_SCHEMA.filter((d) => d.category === c.id).map((d) =>
      d.key === ENABLED_MODELS_DEF.key ? { kind: "scope", key: d.key } : { kind: "typed", key: d.key, def: d },
    );
    const extras: RowModel[] = EXTRA_ROWS.filter((r) => r.category === c.id).map((row) => ({ kind: "extra", key: row.key, row }));
    const lead = extras.filter((r) => r.kind === "extra" && r.row.kind === "default-model");
    const rest = extras.filter((r) => !(r.kind === "extra" && r.row.kind === "default-model"));
    return { id: c.id, label: c.label, rows: [...lead, ...typed, ...rest] };
  });
}

const CATEGORIES = buildCategories();

const labelFor = (key: string, fallback: string): string => i18nT(`piSettings.field.${key}`, undefined, fallback);
const hintFor = (key: string, fallback: string): string => i18nT(`piSettings.hint.${key}`, undefined, fallback);

export function PiSettingsPage({
  load = getPiSettings,
  save = defaultSave,
  syncDefaults = syncPiDefaults,
  migrate = migrateLegacyCredentials,
  loadCatalogue = fetchScopeCatalogue,
  onNavigate = () => {},
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
  const [scope, setScope] = useState<ScopeDraft>(SCOPE_ALL);
  const [scopeBase, setScopeBase] = useState<ScopeDraft>(SCOPE_ALL);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonBase, setJsonBase] = useState("");
  const [queue, setQueue] = useState<LegacyQueue>({});
  const [catalogue, setCatalogue] = useState<ScopeCatalogue | null>(null);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PiSettingsFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Replace the whole baseline + both drafts with a server snapshot. */
  const adopt = useCallback((s: Snapshot) => {
    setLoaded((prev) => ({
      success: true,
      settings: s.settings,
      raw: s.raw,
      etag: s.etag,
      ...(s.parseError ? { parseError: s.parseError } : {}),
      themes: s.themes ?? prev?.themes ?? [],
      legacyCredentials: s.legacyCredentials ?? prev?.legacyCredentials ?? [],
    }));
    const f = toForm(s.settings);
    setForm(f);
    setFormBase(f);
    const sc = toScopeDraft(s.settings);
    setScope(sc);
    setScopeBase(sc);
    const text = s.raw === "" ? "{}\n" : s.raw;
    setJsonDraft(text);
    setJsonBase(text);
    setQueue({});
    // An unparseable file can only be repaired in JSON mode.
    if (s.parseError) setMode("json");
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
      .then((s) => alive && adopt(s))
      .catch((e) => alive && setLoadError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load, adopt]);

  // Catalogue for the scope editor: fetched once when the page opens.
  useEffect(() => {
    let alive = true;
    loadCatalogue()
      .then((r) => {
        if (!alive) return;
        if (r.status === "ok") setCatalogue(buildScopeCatalogue(r.rows));
        else setCatalogueFailed(true);
      })
      .catch(() => alive && setCatalogueFailed(true));
    return () => {
      alive = false;
    };
  }, [loadCatalogue]);

  const legacy = loaded?.legacyCredentials ?? [];
  const themes = loaded?.themes ?? [];
  const queueSize = Object.keys(queue).length;
  const scopeActive = catalogue !== null;

  const labelOf = useCallback((def: PiSettingDef) => labelFor(def.key, def.label), []);
  const errors = useMemo(() => changedFieldErrors(form, formBase, labelOf), [form, formBase, labelOf]);
  const scopeDirty = scopeActive && scopeChanged(scope, scopeBase);
  const scopeError =
    scopeActive && scopeDirty && scope.mode === "selected" && scope.entries.length === 0
      ? i18nT("piSettings.scope.needOne", undefined, "Select at least one provider, model or pattern, or choose All models.")
      : null;

  const formDirty = loaded !== null && (JSON.stringify(form) !== JSON.stringify(formBase) || scopeDirty || queueSize > 0);
  const jsonDirty = loaded !== null && jsonDraft !== jsonBase;
  const isDirty = mode === "form" ? formDirty : jsonDirty;

  /** Re-read only what the config save / drift repair can change: the mirrored keys. */
  const refreshManaged = useCallback(
    (s: Snapshot) => {
      if (!formDirty && !jsonDirty) adopt(s);
      else setLoaded((prev) => (prev ? { ...prev, settings: mergeManagedKeys(prev.settings, s.settings) } : prev));
    },
    [adopt, formDirty, jsonDirty],
  );

  // Latest callbacks for the host-driven refresh below: only a `refreshKey`
  // bump should refetch, not a change of `load` / `refreshManaged` identity.
  const latest = useRef({ load, refreshManaged });
  latest.current = { load, refreshManaged };
  useEffect(() => {
    if (refreshKey === 0) return;
    latest.current
      .load()
      .then(latest.current.refreshManaged)
      .catch(() => {
        /* advisory refresh only */
      });
  }, [refreshKey]);

  /** Form-mode commit (design D9): validate → precompute → cleanup → patch. */
  const commitForm = useCallback(
    async (state: { etag: string }) => {
      // 1. Validate. Any error throws and nothing is sent.
      const blocking = [...Object.values(errors), ...(scopeError ? [scopeError] : [])];
      if (blocking.length > 0) throw new Error(blocking[0]);
      // 2. Precompute the patch against the CURRENT baseline (cleanup never changes typed values).
      const patch = buildFormPatch(form, formBase) as Record<string, unknown>;
      if (scopeActive && scopeDirty) patch.enabledModels = scope.mode === "all" ? null : scope.entries;

      let etag = state.etag;
      let reloaded = 0;

      // 3. Legacy cleanup, then rebase on its snapshot WITHOUT wiping the user's form.
      if (queueSize > 0) {
        try {
          const res = await migrate(
            Object.entries(queue).map(([key, action]) => ({ key, action })),
            etag,
          );
          etag = res.etag;
          reloaded += res.reloadedSessions;
          setLoaded((prev) => ({
            ...(prev as PiSettingsReadResponse),
            settings: res.settings,
            raw: res.raw,
            etag: res.etag,
            legacyCredentials: res.legacyCredentials,
          }));
          setFormBase(toForm(res.settings));
          const text = res.raw === "" ? "{}\n" : res.raw;
          setJsonBase(text);
          setJsonDraft(text);
          setQueue({});
        } catch (e) {
          if (e instanceof PiSettingsApiError && e.legacyCredentials) {
            const list = e.legacyCredentials;
            setLoaded((prev) => (prev ? { ...prev, legacyCredentials: list } : prev));
            setQueue((q) => reconcileQueue(q, list));
          }
          throw e;
        }
      }

      // 4. The precomputed patch, with the cleanup's token. When the cleanup succeeded and this
      //    fails, the queue is already empty, so a retry re-sends only the patch.
      if (Object.keys(patch).length > 0) {
        const res = await save({ mode: "form", patch: patch as PiSettingsPatch, baseEtag: etag });
        adopt(res);
        reloaded += res.reloadedSessions;
      }
      return reloaded;
    },
    [errors, scopeActive, scope, scopeDirty, scopeError, form, formBase, queue, queueSize, migrate, save, adopt],
  );

  const commit = useCallback(async () => {
    if (!loaded) throw new Error("pi settings not loaded");
    clearMessages();
    try {
      let reloaded: number;
      if (mode === "form") {
        reloaded = await commitForm({ etag: loaded.etag });
      } else {
        const syntax = jsonSyntaxError(jsonDraft);
        if (syntax) throw new Error(syntax);
        const res = await save({ mode: "json", raw: jsonDraft, baseEtag: loaded.etag });
        adopt(res);
        reloaded = res.reloadedSessions;
      }
      setStatus(i18nT("piSettings.saved", { n: reloaded }, `Saved. Reloaded ${reloaded} connected session(s).`));
    } catch (e) {
      // Only a stale token is "the file changed on disk"; a legacy-credential 409 (a credential
      // appeared in Providers meanwhile) carries its own message, shown as an ordinary error.
      if (e instanceof PiSettingsApiError && e.status === 409 && e.payload.error === "stale") setConflict(true);
      else if (e instanceof PiSettingsApiError && e.fieldErrors.length > 0) setFieldErrors(e.fieldErrors);
      else setError(errorMessage(e));
      throw e;
    }
  }, [loaded, mode, commitForm, jsonDraft, save, adopt, clearMessages]);

  const reset = useCallback(() => {
    setForm(formBase);
    setScope(scopeBase);
    setJsonDraft(jsonBase);
    setQueue({});
    clearMessages();
  }, [formBase, scopeBase, jsonBase, clearMessages]);

  // page: "pi-settings" — must match the rail item this page renders on.
  useSettingsDraftSource({ id: "pi-settings", page: "pi-settings", isDirty, commit, reset });

  const reloadFromDisk = useCallback(async () => {
    clearMessages();
    try {
      adopt(await load());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [load, adopt, clearMessages]);

  const requestMode = (next: Mode) => {
    if (next === mode) return;
    if (isDirty) {
      setPendingMode(next);
      return;
    }
    clearMessages();
    setMode(next);
  };

  const confirmSwitch = () => {
    reset();
    if (pendingMode) setMode(pendingMode);
    setPendingMode(null);
  };

  const applyDefaults = useCallback(async () => {
    clearMessages();
    try {
      refreshManaged(await syncDefaults());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [syncDefaults, refreshManaged, clearMessages]);

  const queueAction = (key: string, action: LegacyAction | null) =>
    setQueue((q) => {
      const next = { ...q };
      if (action) next[key] = action;
      else delete next[key];
      return next;
    });

  const piSettings = loaded?.settings ?? {};
  const drift = useMemo(() => hasDrift(dashboardDefaults, piSettings), [dashboardDefaults, piSettings]);
  const changedManaged = useMemo(
    () => (mode === "json" && loaded ? changedManagedKeys(jsonDraft, loaded.settings) : []),
    [mode, jsonDraft, loaded],
  );

  // ── Filtering ──
  const q = query.trim().toLowerCase();
  const filtering = q !== "" || changedOnly;

  const visibleCategories = useMemo(() => {
    const matchesQuery = (label: string, key: string, hint: string) =>
      q === "" || [label, key, hint].some((s) => s.toLowerCase().includes(q));
    const isSetOrChanged = (r: RowModel): boolean => {
      if (r.kind === "typed") return form[r.key] !== "" || form[r.key] !== formBase[r.key];
      if (r.kind === "scope") return scopeBase.mode === "selected" || scopeDirty;
      return getSettingValue(piSettings, r.row.probe) !== undefined;
    };
    return CATEGORIES.map((c) => {
      const rows = c.rows.filter((r) => {
        const def = r.kind === "typed" ? r.def : r.kind === "scope" ? ENABLED_MODELS_DEF : null;
        const label = def ? labelFor(def.key, def.label) : labelFor((r as { row: ExtraRow }).row.key, (r as { row: ExtraRow }).row.label);
        const hint = def ? hintFor(def.key, def.hint) : hintFor((r as { row: ExtraRow }).row.key, (r as { row: ExtraRow }).row.hint);
        if (!matchesQuery(label, r.key, hint)) return false;
        return !changedOnly || isSetOrChanged(r);
      });
      return { ...c, matching: rows.length, total: c.rows.length, rows };
    }).filter((c) => c.matching > 0);
  }, [q, changedOnly, form, formBase, scopeBase, scopeDirty, piSettings]);

  const jumpTo = (id: string) => {
    document.getElementById(`pi-settings-cat-${id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <section data-testid="pi-settings-page" className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Icon path={mdiLoading} size={0.6} className="animate-spin" />
        {i18nT("common.loading", undefined, "Loading…")}
      </section>
    );
  }
  if (loadError) {
    return (
      <section data-testid="pi-settings-page">
        <div data-testid="pi-settings-load-error" className="text-xs text-[var(--severity-error-fg)]">
          {loadError}
        </div>
      </section>
    );
  }

  const defaultModelText = [
    [piSettings.defaultProvider, piSettings.defaultModel].filter((s): s is string => typeof s === "string").join("/"),
    typeof piSettings.defaultThinkingLevel === "string" ? piSettings.defaultThinkingLevel : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const renderRow = (r: RowModel): ReactNode => {
    if (r.kind === "typed") {
      return (
        <SettingRow
          key={r.key}
          def={r.def}
          label={labelFor(r.def.key, r.def.label)}
          hint={hintFor(r.def.key, r.def.hint)}
          value={form[r.key] ?? ""}
          themes={themes}
          error={errors[r.key] ?? null}
          onChange={(v) => setForm((f) => ({ ...f, [r.key]: v }))}
        />
      );
    }
    if (r.kind === "scope") {
      return (
        <EditorRow
          key={r.key}
          rowKey={r.key}
          label={labelFor(ENABLED_MODELS_DEF.key, ENABLED_MODELS_DEF.label)}
          hint={hintFor(ENABLED_MODELS_DEF.key, ENABLED_MODELS_DEF.hint)}
          changed={scopeBase.mode === "selected" || scopeDirty}
          onReset={() => setScope(SCOPE_ALL)}
        >
          <ModelScopeEditor
            draft={scope}
            catalogue={catalogue}
            unavailable={catalogueFailed}
            error={scopeError}
            onChange={setScope}
          />
        </EditorRow>
      );
    }
    return (
      <ExtraSettingRow
        key={r.key}
        row={r.row}
        label={labelFor(r.row.key, r.row.label)}
        hint={hintFor(r.row.key, r.row.hint)}
        isSet={getSettingValue(piSettings, r.row.probe) !== undefined}
        valueText={r.row.kind === "default-model" ? defaultModelText : undefined}
        onNavigate={onNavigate}
        onEditJson={() => requestMode("json")}
      />
    );
  };

  return (
    <section data-testid="pi-settings-page" className="space-y-3">
      <p className="text-xs text-[var(--text-tertiary)]">
        {i18nT("piSettings.subtitle", undefined, "pi's own global settings file (~/.pi/agent/settings.json).")}
      </p>
      <ModeSwitch mode={mode} onSelect={requestMode} />
      {pendingMode && <SwitchPrompt onStay={() => setPendingMode(null)} onDiscard={confirmSwitch} />}
      {loaded?.parseError && (
        <Banner testId="pi-settings-parse-error" tone="warning">
          {i18nT(
            "piSettings.parseError",
            { error: loaded.parseError },
            `settings.json is not valid JSON (${loaded.parseError}). Repair it in JSON mode.`,
          )}
        </Banner>
      )}
      <PiLegacyCredentialsWarning items={legacy} queue={queue} mode={mode} onQueue={queueAction} />

      {mode === "form" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              data-testid="pi-settings-filter"
              aria-label={i18nT("piSettings.filterLabel", undefined, "Filter settings")}
              placeholder={i18nT("piSettings.filterPlaceholder", undefined, "Filter settings by name, key or description")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-72 max-w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs"
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" data-testid="pi-settings-changed-only" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
              {i18nT("piSettings.changedOnly", undefined, "Set or changed only")}
            </label>
          </div>
          {visibleCategories.length > 0 && (
            <nav aria-label={i18nT("piSettings.jumpLabel", undefined, "Jump to category")} className="flex flex-wrap gap-1.5">
              {visibleCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`pi-settings-jump-${c.id}`}
                  onClick={() => jumpTo(c.id)}
                  className="rounded-full border border-[var(--border-secondary)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
                >
                  {i18nT(`piSettings.category.${c.id}`, undefined, c.label)}
                </button>
              ))}
            </nav>
          )}
          {visibleCategories.length === 0 && (
            <p data-testid="pi-settings-empty" role="status" className="text-xs text-[var(--text-secondary)]">
              {q !== ""
                ? i18nT("piSettings.noMatch", { query: query.trim() }, `No settings match "${query.trim()}".`)
                : i18nT("piSettings.noneChanged", undefined, "No settings are set or changed.")}
            </p>
          )}
          {visibleCategories.map((c) => (
            <section key={c.id} id={`pi-settings-cat-${c.id}`} data-testid={`pi-settings-category-${c.id}`} className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <h3 className="flex items-baseline gap-2 text-xs font-semibold text-[var(--text-primary)]">
                {i18nT(`piSettings.category.${c.id}`, undefined, c.label)}
                {filtering && (
                  <span data-testid={`pi-settings-category-count-${c.id}`} className="font-normal text-[var(--text-tertiary)]">
                    {i18nT("piSettings.matchCount", { n: c.matching, total: c.total }, `${c.matching} of ${c.total}`)}
                  </span>
                )}
              </h3>
              {c.rows.map(renderRow)}
            </section>
          ))}
          <details data-testid="pi-settings-managed-list" className="rounded border border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <summary className="cursor-pointer">{i18nT("piSettings.managedTitle", undefined, "Managed by the dashboard (read-only)")}</summary>
            <ul className="mt-1 space-y-0.5">
              {DASHBOARD_MANAGED_KEYS.map((k) => (
                <li key={k} className="flex gap-2">
                  <code className="font-mono">{k}</code>
                  <span data-testid={`pi-settings-managed-${k}`} className="font-mono text-[var(--text-tertiary)]">
                    {piSettings[k] === undefined ? "—" : JSON.stringify(piSettings[k])}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <JsonPane Editor={JsonEditor} value={jsonDraft} onChange={setJsonDraft} changedManaged={changedManaged} />
      )}
      {drift && (
        <Banner testId="pi-settings-drift" tone="info">
          <span className="flex flex-wrap items-center gap-2">
            {i18nT("piSettings.drift", undefined, "pi's default model differs from the dashboard default.")}
            <button type="button" data-testid="pi-settings-sync-defaults" onClick={() => void applyDefaults()} className="rounded border px-2 py-0.5">
              {i18nT("piSettings.applyDefaults", undefined, "Apply dashboard default to pi")}
            </button>
          </span>
        </Banner>
      )}
      <Feedback conflict={conflict} fieldErrors={fieldErrors} error={error} status={status} onReload={() => void reloadFromDisk()} />
      <Banner testId="pi-settings-notes" tone="info">
        <span data-testid="pi-settings-reload-note">
          {i18nT("piSettings.reloadNote", undefined, "Saving reloads running sessions so changes take effect right away.")}
        </span>{" "}
        <span data-testid="pi-settings-scope-note">
          {i18nT("piSettings.scopeNote", undefined, "Edits the global file only — a project .pi/settings.json may override these values at runtime.")}
        </span>
      </Banner>
    </section>
  );
}
