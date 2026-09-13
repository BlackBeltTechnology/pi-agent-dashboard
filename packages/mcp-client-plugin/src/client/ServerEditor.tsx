/**
 * mcp-client-plugin · schema-driven server editor (tasks 7.4 + 7.5).
 *
 * A modal dialog rendering every `ServerEntry` field from the published
 * schema (`schema.ts` owns widget selection; anything unmapped falls back to a
 * validated JSON editor, so no field is ever hidden). One transport at a time
 * (tabs), rarely-used fields behind an Advanced disclosure, one primary Save
 * that commits a `{ set, unset }` patch computed against the effective
 * baseline — untouched fields (including unknown ones) are never sent.
 *
 * Secrets: schema `x-secret` fields and credential-named record keys render
 * masked with a per-field reveal that resets on reopen; inherited secrets
 * arrive as `{ redacted: true }` sentinels (server-side redaction), render the
 * redaction placeholder with NO reveal, and are excluded from every patch
 * unless the operator types a new value. Inherited `x-atomic` records are
 * replaced wholesale, so overriding one is an explicit per-field action that
 * starts from `{}` and states how many inherited keys / secrets stop applying.
 *
 * See change: extract-mcp-client-plugin (tasks 7.4, 7.5).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ApiError, fetchSchema, patchServer, scopeToWire } from "./api.js";
import { invalidateEffective } from "./hooks.js";
import { transportOf } from "./ServerList.js";
import {
  atomicCounts,
  clone,
  computePatch,
  type FieldSchema,
  fieldsOf,
  getPath,
  isRedacted,
  isSecretKeyName,
  redactedKeys,
  setPath,
  TRANSPORT_FIELDS,
  type Transport,
  validateDraft,
  visibleUnderTransport,
} from "./schema.js";

/** Rarely-used fields live behind the Advanced disclosure; everything else is common. */
const COMMON_FIELDS = new Set([
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "auth",
  "bearerToken",
  "socket",
  "disabled",
  "lifecycle",
  "idleTimeout",
]);
const TABS: Transport[] = ["command", "url", "socket"];

const MASK = "••••••••";
const INPUT_CLS =
  "w-full min-h-11 sm:min-h-0 text-xs bg-transparent border border-[var(--border-secondary)] rounded px-1.5 py-1 text-[var(--text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary,#60a5fa)]";
const BTN_CLS =
  "text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50";
const PRIMARY_BTN_CLS = `${BTN_CLS} border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]`;
const ERROR_CLS = "text-[11px] text-[var(--status-error,#f87171)] m-0";

export interface ServerEditorProps {
  /** `null` → add a new server (the editor asks for the name). */
  name: string | null;
  /** Baseline: the merged effective entry, redaction sentinels included. `{}` for add. */
  entry: Record<string, unknown>;
  /** The Pi-global layer defines the server (edit); `false` → View + Override. */
  editable: boolean;
  /** Page-wide read-only (adapter not ok): fields render as text, Save disabled. */
  readOnly: boolean;
  onClose: () => void;
  /** Called after a successful write so the page re-fetches. */
  onChanged: () => void;
}

interface EditorCtx {
  draft: Record<string, unknown>;
  baseline: Record<string, unknown>;
  write: (path: string[], value: unknown) => void;
  revealed: ReadonlySet<string>;
  toggleReveal: (key: string) => void;
  raw: Record<string, string>;
  setRawText: (key: string, value: string) => void;
  /** Fields render as text, not inputs (View variant, or page-wide read-only). */
  viewOnly: boolean;
  /** Overriding a server the Pi-global layer does not define. */
  overrideMode: boolean;
  atomicNotes: ReadonlySet<string>;
  onAtomicOverride: (field: FieldSchema) => void;
  errors: Record<string, string>;
}

type Translate = ReturnType<typeof useT>;

function computeTarget(name: string | null, serverName: string): string {
  return name ?? serverName.trim();
}

/**
 * When the draft is invalid, the errors + summary to surface; `null` means
 * writable. An empty name wins over the field errors, as before.
 */
function validationIssue(
  t: Translate,
  target: string,
  fieldErrors: Record<string, string>,
): { errors: Record<string, string>; summary: string } | null {
  const nameError =
    target === "" ? t("mcpEditorNameRequired", undefined, "Server name is required.") : null;
  if (!nameError && Object.keys(fieldErrors).length === 0) return null;
  return {
    errors: nameError ? { name: nameError } : fieldErrors,
    summary: t("mcpEditorInvalidSummary", undefined, "Fix the errors before saving."),
  };
}

/** Map a save rejection onto the error state (`ApiError.fields` win over field errors). */
function failureState(
  e: unknown,
  fieldErrors: Record<string, string>,
): { errors?: Record<string, string>; summary: string } {
  if (e instanceof ApiError) {
    const merged = { ...fieldErrors };
    for (const field of e.fields) merged[field] = e.message;
    return { errors: merged, summary: e.message };
  }
  return { summary: String(e) };
}

function editorTitle(t: Translate, mode: "view" | "edit", name: string | null): string {
  if (mode === "view") {
    return t("mcpEditorViewTitle", { name: name ?? "" }, `View server ${name ?? ""}`);
  }
  if (name === null) return t("mcpEditorAddTitle", undefined, "Add server");
  return t("mcpEditorEditTitle", { name }, `Edit server ${name}`);
}

export function ServerEditor({
  name,
  entry,
  editable,
  readOnly,
  onClose,
  onChanged,
}: ServerEditorProps): React.ReactElement {
  const t = useT();
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [schemaError, setSchemaError] = useState<Error | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => clone(entry));
  const [tab, setTab] = useState<Transport>(() => transportOf(entry) ?? "command");
  const [mode, setMode] = useState<"view" | "edit">(editable ? "edit" : "view");
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [atomicNotes, setAtomicNotes] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [serverName, setServerName] = useState(name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSchema().then(setSchema, (e: unknown) =>
      setSchemaError(e instanceof Error ? e : new Error(String(e))),
    );
  }, []);

  // Focus moves into the dialog on open and returns to the trigger on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  useEffect(() => {
    triggerRef.current = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const viewOnly = mode === "view" || readOnly;
  const fields = schema ? fieldsOf(schema) : [];
  const visible = fields.filter((f) => visibleUnderTransport(f.name, tab));

  const write = (path: string[], value: unknown) => setDraft((d) => setPath(d, path, value));
  const toggleReveal = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setRawText = (key: string, value: string) => setRaw((r) => ({ ...r, [key]: value }));

  function switchTab(next: Transport): void {
    if (next === tab || viewOnly) return;
    setDraft((d) => {
      let next0 = d;
      for (const other of TABS) {
        if (other === next) continue;
        for (const field of TRANSPORT_FIELDS[other]) next0 = setPath(next0, [field], undefined);
      }
      return next0;
    });
    setTab(next);
  }

  function activateAtomicOverride(field: FieldSchema): void {
    write(field.path, {});
    setAtomicNotes((prev) => new Set(prev).add(field.name));
  }

  async function save(): Promise<void> {
    const target = computeTarget(name, serverName);
    const fieldErrors = validateDraft(visible, draft, tab, raw);
    const issue = validationIssue(t, target, fieldErrors);
    if (issue) {
      setErrors(issue.errors);
      setSummary(issue.summary);
      return;
    }
    const { set, unset } = computePatch(draft, entry);
    setSaving(true);
    try {
      await patchServer(target, { ...scopeToWire({ kind: "global" }), set, unset });
      invalidateEffective();
      onChanged();
      onClose();
    } catch (e) {
      const failure = failureState(e, fieldErrors);
      if (failure.errors) setErrors(failure.errors);
      setSummary(failure.summary);
    } finally {
      setSaving(false);
    }
  }

  const schemaMessage = schemaError
    ? t(
        "mcpEditorSchemaError",
        undefined,
        `Could not load the field schema: ${schemaError.message}`,
      )
    : null;
  const summaryText = summary ?? schemaMessage;

  const title = editorTitle(t, mode, name);

  const ctx: EditorCtx = {
    draft,
    baseline: entry,
    write,
    revealed,
    toggleReveal,
    raw,
    setRawText,
    viewOnly,
    overrideMode: !editable && mode === "edit",
    atomicNotes,
    onAtomicOverride: activateAtomicOverride,
    errors,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label={t("mcpEditorClose", undefined, "Close")}
        onClick={onClose}
        data-testid="mcp-editor-backdrop"
        className="absolute inset-0 bg-black/40 cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="mcp-editor-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="relative w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded-t-lg sm:rounded-lg p-3 space-y-2 outline-none"
      >
        <h2 className="text-sm font-semibold m-0 text-[var(--text-primary)]">{title}</h2>

        {name === null && !viewOnly && (
          <EditorNameField value={serverName} onChange={setServerName} error={errors.name} />
        )}

        {summaryText && <EditorSummary text={summaryText} errors={errors} />}

        {!schema && <EditorSkeleton />}

        {schema && (
          <>
            <TransportTabs tab={tab} viewOnly={viewOnly} onSelect={switchTab} />
            <div className="space-y-2">
              <FieldRows fields={visible.filter((f) => COMMON_FIELDS.has(f.name))} ctx={ctx} />
            </div>
            <AdvancedFields visible={visible} ctx={ctx} />
          </>
        )}

        <EditorFooter
          mode={mode}
          readOnly={readOnly}
          saving={saving}
          onSave={save}
          onOverride={() => setMode("edit")}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function EditorNameField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}): React.ReactElement {
  const t = useT();
  return (
    <div data-testid="mcp-field-name" className="space-y-1">
      <span className="block text-[11px] text-[var(--text-secondary)]">
        {t("mcpEditorNameLabel", undefined, "Server name")}
      </span>
      <input
        type="text"
        aria-label={t("mcpEditorNameLabel", undefined, "Server name")}
        data-testid="mcp-editor-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      />
      {error && (
        <p data-testid="mcp-editor-name-error" role="alert" className={ERROR_CLS}>
          {error}
        </p>
      )}
    </div>
  );
}

function EditorSummary({
  text,
  errors,
}: {
  text: string;
  errors: Record<string, string>;
}): React.ReactElement {
  return (
    <div
      data-testid="mcp-summary-error"
      role="alert"
      className="text-[11px] text-[var(--status-error,#f87171)] border border-[var(--status-error,#f87171)] rounded px-2 py-1.5 space-y-0.5"
    >
      <p className="m-0">{text}</p>
      {Object.entries(errors).map(([field, message]) => (
        <p key={field} className="m-0">
          {field}: {message}
        </p>
      ))}
    </div>
  );
}

function EditorSkeleton(): React.ReactElement {
  return (
    <div data-testid="mcp-editor-loading" className="space-y-2 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-5 rounded bg-[var(--bg-tertiary,#27272a)] animate-pulse"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

function TransportTabs({
  tab,
  viewOnly,
  onSelect,
}: {
  tab: Transport;
  viewOnly: boolean;
  onSelect: (next: Transport) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div role="tablist" aria-label={t("mcpEditorTransport", undefined, "Transport")} className="flex gap-1">
      {TABS.map((tr) => (
        <button
          key={tr}
          type="button"
          role="tab"
          aria-selected={tab === tr}
          disabled={viewOnly}
          data-testid={`mcp-tab-${tr}`}
          onClick={() => onSelect(tr)}
          className={`${BTN_CLS} ${tab === tr ? "border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]" : ""}`}
        >
          {tr}
        </button>
      ))}
    </div>
  );
}

function FieldRows({ fields, ctx }: { fields: FieldSchema[]; ctx: EditorCtx }): React.ReactElement {
  return (
    <>
      {fields.map((f) => (
        <FieldRow key={f.name} field={f} ctx={ctx} />
      ))}
    </>
  );
}

function AdvancedFields({
  visible,
  ctx,
}: {
  visible: FieldSchema[];
  ctx: EditorCtx;
}): React.ReactElement {
  const t = useT();
  return (
    <details data-testid="mcp-advanced" className="border border-[var(--border-secondary)] rounded p-1.5">
      <summary className="text-[11px] text-[var(--text-secondary)] cursor-pointer min-h-11 sm:min-h-0 flex items-center">
        {t("mcpEditorAdvanced", undefined, "Advanced")}
      </summary>
      <div className="space-y-2 pt-2">
        <FieldRows fields={visible.filter((f) => !COMMON_FIELDS.has(f.name))} ctx={ctx} />
      </div>
    </details>
  );
}

function EditorFooter({
  mode,
  readOnly,
  saving,
  onSave,
  onOverride,
  onClose,
}: {
  mode: "view" | "edit";
  readOnly: boolean;
  saving: boolean;
  onSave: () => Promise<void>;
  onOverride: () => void;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div data-testid="mcp-editor-footer" className="flex items-center justify-end gap-2 pt-1">
      {mode === "view" ? (
        <button
          type="button"
          onClick={onOverride}
          disabled={readOnly}
          data-testid="mcp-editor-override"
          className={PRIMARY_BTN_CLS}
        >
          {t("mcpEditorOverrideAt", undefined, "Override at Pi global")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={readOnly || saving}
          data-testid="mcp-save"
          className={PRIMARY_BTN_CLS}
        >
          {t("mcpEditorSave", undefined, "Save")}
        </button>
      )}
      <button type="button" onClick={onClose} data-testid="mcp-editor-close" className={BTN_CLS}>
        {t("mcpEditorCloseLabel", undefined, "Close")}
      </button>
    </div>
  );
}

// ─── field rendering ─────────────────────────────────────────────────────────

function FieldRow({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const error = ctx.errors[field.name];
  return (
    <div data-testid={`mcp-field-${field.name}`} className="space-y-1">
      <span className="block text-[11px] text-[var(--text-secondary)]">{field.name}</span>
      <FieldControl field={field} ctx={ctx} />
      {ctx.atomicNotes.has(field.name) && <AtomicNote field={field} ctx={ctx} />}
      {error && (
        <p data-testid={`mcp-field-error-${field.name}`} role="alert" className={ERROR_CLS}>
          {error}
        </p>
      )}
    </div>
  );
}

function AtomicNote({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const counts = atomicCounts(getPath(ctx.baseline, field.path));
  return (
    <p data-testid={`mcp-override-note-${field.name}`} className="text-[11px] text-[var(--text-secondary)] m-0">
      {t(
        "mcpAtomicOverrideNote",
        { count: counts.count, secrets: counts.secrets },
        `${counts.count} inherited keys incl. ${counts.secrets} secrets will no longer apply`,
      )}
    </p>
  );
}

function FieldControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  switch (field.widget) {
    case "text":
      return <TextControl field={field} ctx={ctx} />;
    case "number":
      return <NumberControl field={field} ctx={ctx} />;
    case "boolean":
      return <BooleanControl field={field} ctx={ctx} />;
    case "enum":
      return <EnumControl field={field} ctx={ctx} />;
    case "string-list": {
      const rows = asStrings(getPath(ctx.draft, field.path));
      if (ctx.viewOnly)
        return <span className="text-xs text-[var(--text-primary)]">{rows.join(", ")}</span>;
      return (
        <StringListEditor
          field={field}
          rows={rows}
          onRows={(next) => ctx.write(field.path, next.length === 0 ? undefined : next)}
        />
      );
    }
    case "toggle-list":
      return <ToggleListControl field={field} ctx={ctx} />;
    case "record":
      return <RecordControl field={field} ctx={ctx} />;
    case "nested-group":
      return <NestedGroupControl field={field} ctx={ctx} />;
    default:
      return <JsonControl field={field} ctx={ctx} />;
  }
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function RevealButton({ name, shown, ctx }: { name: string; shown: boolean; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  return (
    <button
      type="button"
      data-testid={`mcp-reveal-${name}`}
      aria-pressed={shown}
      aria-label={shown ? t("mcpHide", { name }, `Hide ${name}`) : t("mcpReveal", { name }, `Reveal ${name}`)}
      onClick={() => ctx.toggleReveal(name)}
      className={BTN_CLS}
    >
      {shown ? t("mcpHideLabel", undefined, "Hide") : t("mcpRevealLabel", undefined, "Show")}
    </button>
  );
}

function Placeholder({ field }: { field: FieldSchema }): React.ReactElement {
  const t = useT();
  return (
    <span data-testid={`mcp-redacted-${field.name}`} className="text-xs text-[var(--text-tertiary)]">
      {t("mcpSecretInherited", undefined, "•••••• (inherited)")}
    </span>
  );
}

function TextControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
  if (ctx.viewOnly) return <ViewOnlyText field={field} ctx={ctx} value={value} />;
  if (field.secret) return <SecretTextControl field={field} ctx={ctx} value={value} />;
  return (
    <input
      type="text"
      aria-label={field.name}
      data-testid={`mcp-field-input-${field.name}`}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => ctx.write(field.path, e.target.value)}
      className={INPUT_CLS}
    />
  );
}

function ViewOnlyText({
  field,
  ctx,
  value,
}: {
  field: FieldSchema;
  ctx: EditorCtx;
  value: unknown;
}): React.ReactElement {
  if (isRedacted(value)) return <Placeholder field={field} />;
  if (!field.secret) {
    return <span className="text-xs text-[var(--text-primary)]">{String(value ?? "")}</span>;
  }
  const shown = ctx.revealed.has(field.name);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span data-testid={`mcp-field-value-${field.name}`}>{shown ? String(value ?? "") : MASK}</span>
      <RevealButton name={field.name} shown={shown} ctx={ctx} />
    </span>
  );
}

function SecretTextControl({
  field,
  ctx,
  value,
}: {
  field: FieldSchema;
  ctx: EditorCtx;
  value: unknown;
}): React.ReactElement {
  const t = useT();
  if (isRedacted(value)) {
    return (
      <span className="flex items-center gap-2">
        <Placeholder field={field} />
        <input
          type="text"
          aria-label={`${field.name} ${t("mcpSecretNewValue", undefined, "(new value)")}`}
          placeholder={t("mcpSecretNewValue", undefined, "New value")}
          data-testid={`mcp-field-input-${field.name}`}
          value=""
          onChange={(e) => ctx.write(field.path, e.target.value)}
          className={INPUT_CLS}
        />
      </span>
    );
  }
  const shown = ctx.revealed.has(field.name);
  return (
    <span className="flex items-center gap-1">
      <input
        type={shown ? "text" : "password"}
        aria-label={field.name}
        data-testid={`mcp-field-input-${field.name}`}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => ctx.write(field.path, e.target.value)}
        className={INPUT_CLS}
      />
      <RevealButton name={field.name} shown={shown} ctx={ctx} />
    </span>
  );
}

function NumberControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
  const text = ctx.raw[field.name] ?? (typeof value === "number" ? String(value) : "");
  if (ctx.viewOnly) return <span className="text-xs text-[var(--text-primary)]">{String(value ?? "")}</span>;
  return (
    <input
      type="number"
      aria-label={field.name}
      data-testid={`mcp-field-input-${field.name}`}
      value={text}
      onChange={(e) => {
        ctx.setRawText(field.name, e.target.value);
        if (e.target.value.trim() === "") ctx.write(field.path, undefined);
        else {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) ctx.write(field.path, parsed);
        }
      }}
      className={INPUT_CLS}
    />
  );
}

function BooleanControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
  if (ctx.viewOnly)
    return <span className="text-xs text-[var(--text-primary)]">{String(value === true)}</span>;
  return (
    // The label is the hit area: a 16px box cannot meet the 44px mobile floor.
    <label className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">
      <input
        type="checkbox"
        aria-label={field.name}
        data-testid={`mcp-field-input-${field.name}`}
        checked={value === true}
        onChange={(e) => ctx.write(field.path, e.target.checked)}
        className="w-4 h-4 flex-none"
      />
    </label>
  );
}

function EnumControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const value = getPath(ctx.draft, field.path);
  if (ctx.viewOnly)
    return <span className="text-xs text-[var(--text-primary)]">{String(value ?? "")}</span>;
  const numeric = (field.enumValues ?? []).some((v) => typeof v === "number");
  return (
    <select
      aria-label={field.name}
      data-testid={`mcp-field-input-${field.name}`}
      value={value === undefined ? "" : String(value)}
      onChange={(e) =>
        ctx.write(
          field.path,
          e.target.value === "" ? undefined : numeric ? Number(e.target.value) : e.target.value,
        )
      }
      className={INPUT_CLS}
    >
      <option value="">{t("mcpEnumInherit", undefined, "(inherit)")}</option>
      {(field.enumValues ?? []).map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function StringListEditor({
  field,
  rows,
  onRows,
}: {
  field: FieldSchema;
  rows: string[];
  onRows: (rows: string[]) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            aria-label={`${field.name} ${i + 1}`}
            data-testid={`mcp-list-input-${field.name}-${i}`}
            value={row}
            onChange={(e) => onRows(rows.map((r, j) => (j === i ? e.target.value : r)))}
            className={INPUT_CLS}
          />
          <button
            type="button"
            aria-label={t("mcpRemoveRow", undefined, "Remove row")}
            data-testid={`mcp-list-remove-${field.name}-${i}`}
            onClick={() => onRows(rows.filter((_, j) => j !== i))}
            className={BTN_CLS}
          >
            −
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label={t("mcpAddRow", undefined, "Add row")}
        data-testid={`mcp-list-add-${field.name}`}
        onClick={() => onRows([...rows, ""])}
        className={BTN_CLS}
      >
        + {t("mcpAddRowLabel", undefined, "Add")}
      </button>
    </div>
  );
}

function ToggleListControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const value = getPath(ctx.draft, field.path);
  const checked = value === true || Array.isArray(value);

  if (ctx.viewOnly) {
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "false");
    return <span className="text-xs text-[var(--text-primary)]">{text}</span>;
  }

  return (
    <div className="space-y-1">
      <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">
        <input
          type="checkbox"
          aria-label={field.name}
          data-testid={`mcp-field-input-${field.name}`}
          checked={checked}
          onChange={(e) =>
            ctx.write(field.path, e.target.checked ? (Array.isArray(value) ? value : []) : false)
          }
          className="w-4 h-4 flex-none"
        />
        {t("mcpUseList", undefined, "Use a tool list")}
      </label>
      {checked && (
        <StringListEditor
          field={field}
          rows={Array.isArray(value) ? value.map(String) : []}
          onRows={(rows) => ctx.write(field.path, rows)}
        />
      )}
    </div>
  );
}

/** Read-only rows of a record: redacted keys (placeholder per `secret` flag) or verbatim values. */
function RecordViewRows({ field, value, ctx }: { field: FieldSchema; value: unknown; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  if (isRedacted(value)) {
    const keys = redactedKeys(value);
    return (
      <div className="space-y-0.5" data-testid={`mcp-record-${field.name}`}>
        {keys.map((k) => (
          <div key={k.name} data-testid={`mcp-record-row-${field.name}.${k.name}`} className="flex items-center gap-2 text-xs">
            <span className="text-[var(--text-primary)]">{k.name}</span>
            <span className="text-[var(--text-tertiary)]">
              {k.secret ? MASK : t("mcpValueInherited", undefined, "(value not shown)")}
            </span>
          </div>
        ))}
        {keys.length === 0 && <span className="text-xs text-[var(--text-tertiary)]">—</span>}
      </div>
    );
  }
  const entries =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [];
  return (
    <div className="space-y-0.5" data-testid={`mcp-record-${field.name}`}>
      {entries.map(([key, entry]) => (
        <div key={key} data-testid={`mcp-record-row-${field.name}.${key}`} className="flex items-center gap-2 text-xs">
          <span className="text-[var(--text-primary)]">{key}</span>
          <span className="text-[var(--text-tertiary)]">
            {field.secret || isSecretKeyName(key) ? MASK : String(entry)}
          </span>
        </div>
      ))}
      {entries.length === 0 && <span className="text-xs text-[var(--text-tertiary)]">—</span>}
    </div>
  );
}

function RecordControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const value = getPath(ctx.draft, field.path);
  const pending =
    !ctx.viewOnly && field.atomic && !ctx.atomicNotes.has(field.name) && (isRedacted(value) || ctx.overrideMode);

  if (ctx.viewOnly || pending) {
    return (
      <div className="space-y-1">
        <RecordViewRows field={field} value={value} ctx={ctx} />
        {pending && (
          <button
            type="button"
            data-testid={`mcp-override-${field.name}`}
            aria-label={t("mcpOverrideField", { name: field.name }, `Override ${field.name}`)}
            onClick={() => ctx.onAtomicOverride(field)}
            className={BTN_CLS}
          >
            {t("mcpOverrideFieldLabel", undefined, "Override…")}
          </button>
        )}
      </div>
    );
  }

  const rows =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const writeRecord = (next: Record<string, unknown>) => ctx.write(field.path, next);

  return (
    <div className="space-y-1" data-testid={`mcp-record-${field.name}`}>
      {Object.entries(rows).map(([key, entry]) => {
        const rowName = `${field.name}.${key}`;
        const masked = field.secret || isSecretKeyName(key);
        const shown = ctx.revealed.has(rowName);
        return (
          <div key={key} data-testid={`mcp-record-row-${rowName}`} className="flex items-center gap-1">
            <input
              aria-label={`${rowName} key`}
              data-testid={`mcp-record-key-${rowName}`}
              value={key}
              onChange={(e) => {
                const next = { ...rows };
                delete next[key];
                next[e.target.value] = entry;
                writeRecord(next);
              }}
              className={`${INPUT_CLS} w-1/3`}
            />
            {typeof entry === "string" ? (
              <>
                <input
                  type={masked && !shown ? "password" : "text"}
                  aria-label={`${rowName} value`}
                  data-testid={`mcp-record-value-${rowName}`}
                  value={entry}
                  onChange={(e) => writeRecord({ ...rows, [key]: e.target.value })}
                  className={INPUT_CLS}
                />
                {masked && <RevealButton name={rowName} shown={shown} ctx={ctx} />}
              </>
            ) : (
              <textarea
                aria-label={`${rowName} value (JSON)`}
                data-testid={`mcp-record-value-${rowName}`}
                rows={2}
                value={ctx.raw[rowName] ?? JSON.stringify(entry)}
                onChange={(e) => {
                  ctx.setRawText(rowName, e.target.value);
                  try {
                    writeRecord({ ...rows, [key]: JSON.parse(e.target.value) });
                  } catch {
                    /* keep the last parsed value; validation flags the raw text */
                  }
                }}
                className={`${INPUT_CLS} font-mono`}
              />
            )}
            <button
              type="button"
              aria-label={t("mcpRemoveRow", undefined, "Remove row")}
              data-testid={`mcp-record-remove-${rowName}`}
              onClick={() => {
                const next = { ...rows };
                delete next[key];
                writeRecord(next);
              }}
              className={BTN_CLS}
            >
              −
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label={t("mcpAddEntry", { name: field.name }, `Add ${field.name} entry`)}
        data-testid={`mcp-record-add-${field.name}`}
        onClick={() => writeRecord({ ...rows, "": "" })}
        className={BTN_CLS}
      >
        + {t("mcpAddRowLabel", undefined, "Add")}
      </button>
    </div>
  );
}

function NestedGroupControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const value = getPath(ctx.draft, field.path);
  const pending =
    !ctx.viewOnly && field.atomic && !ctx.atomicNotes.has(field.name) && (isRedacted(value) || ctx.overrideMode);

  if (ctx.viewOnly || pending) {
    return (
      <div className="space-y-1">
        {isRedacted(value) ? (
          <Placeholder field={field} />
        ) : (
          <div className="space-y-2 border-l border-[var(--border-secondary)] pl-2">
            {(field.children ?? []).map((child) => (
              <FieldRow key={child.name} field={child} ctx={{ ...ctx, viewOnly: true }} />
            ))}
          </div>
        )}
        {pending && (
          <button
            type="button"
            data-testid={`mcp-override-${field.name}`}
            aria-label={t("mcpOverrideField", { name: field.name }, `Override ${field.name}`)}
            onClick={() => ctx.onAtomicOverride(field)}
            className={BTN_CLS}
          >
            {t("mcpOverrideFieldLabel", undefined, "Override…")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-l border-[var(--border-secondary)] pl-2">
      {field.unionFalse && value === false && (
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">
          <input
            type="checkbox"
            aria-label={t("mcpEnableField", { name: field.name }, `Enable ${field.name}`)}
            data-testid={`mcp-field-input-${field.name}`}
            checked={false}
            onChange={() => ctx.write(field.path, {})}
            className="w-4 h-4 flex-none"
          />
          {t("mcpEnableField", { name: field.name }, `Enable ${field.name}`)}
        </label>
      )}
      {!(field.unionFalse && value === false) &&
        (field.children ?? []).map((child) => <FieldRow key={child.name} field={child} ctx={ctx} />)}
    </div>
  );
}

function JsonControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
  if (ctx.viewOnly)
    return (
      <span className="text-xs text-[var(--text-primary)] break-all">
        {value === undefined ? "" : JSON.stringify(value)}
      </span>
    );
  const text = ctx.raw[field.name] ?? (value === undefined ? "" : JSON.stringify(value, null, 2));
  return (
    <textarea
      aria-label={field.name}
      data-testid={`mcp-field-input-${field.name}`}
      rows={3}
      value={text}
      onChange={(e) => {
        ctx.setRawText(field.name, e.target.value);
        if (e.target.value.trim() === "") ctx.write(field.path, undefined);
        else {
          try {
            ctx.write(field.path, JSON.parse(e.target.value));
          } catch {
            /* keep the last parsed value; validation flags the raw text */
          }
        }
      }}
      className={`${INPUT_CLS} font-mono`}
    />
  );
}
