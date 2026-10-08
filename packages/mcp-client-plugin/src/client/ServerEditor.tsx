/**
 * mcp-client-plugin · schema-driven server editor.
 *
 * A modal dialog rendering every `ServerEntry` field from the published
 * schema (`schema.ts` owns widget selection; anything unmapped falls back to a
 * validated JSON editor, so no field is ever hidden). ONE transport at a time
 * (tabs; switching clears the other transport's keys). Saving writes the
 * COMPLETE entry (`buildEntry`: unknown fields preserved, redaction sentinels
 * never sent, the inactive transport's keys and project-scope `auth` dropped).
 *
 * The exposure alias `codemode-deferred` displays as `codemode` but is kept
 * unless the operator changes the select. Secret values (schema `x-secret`
 * fields and credential-named env/header keys) render masked with a per-field
 * reveal — except `${NAME}` references and `!` commands, shown as written.
 * A folder override pre-fill arrives with secrets + `auth` already removed and
 * lists them as `omitted` warnings. Renaming or changing the URL of an OAuth
 * HTTP server warns that a new sign-in is needed (pi keys credentials by
 * name + URL). Closing with unsaved changes asks for confirmation.
 *
 * See change: migrate-mcp-to-pi-builtin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { authModeOf, isValidServerName, transportOf } from "../core/pi-rules.js";
import type { Scope } from "../core/types.js";
import { ApiError, fetchSchema, saveServer, scopeToWire } from "./api.js";
import { invalidateEffective } from "./hooks.js";
import {
  buildEntry,
  clone,
  deepEqual,
  type FieldSchema,
  fieldsOf,
  getPath,
  isMaskedValue,
  type RawText,
  setPath,
  TRANSPORT_FIELDS,
  type Transport,
  validateDraft,
  visibleUnderTransport,
} from "./schema.js";

/** Common fields render at the top; the rest sit behind the Advanced disclosure. */
const COMMON_FIELDS = new Set([
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "auth",
  "oauth",
  "description",
  "exposure",
  "enabled",
]);
const TABS: Transport[] = ["command", "url"];

/** The editor tab an entry opens on: the transport pi picks, as a tab. */
function initialTab(entry: Record<string, unknown>): Transport {
  return typeof entry.url === "string" && entry.type !== "stdio" ? "url" : "command";
}

const INPUT_CLS =
  "w-full min-h-11 sm:min-h-0 text-xs bg-transparent border border-[var(--border-secondary)] rounded px-1.5 py-1 text-[var(--text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary,#60a5fa)]";
const BTN_CLS =
  "text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50";
const PRIMARY_BTN_CLS = `${BTN_CLS} border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]`;
const ERROR_CLS = "text-[11px] text-[var(--status-error,#f87171)] m-0";

export interface ServerEditorProps {
  /** `null` → add a new server (the name input starts empty). */
  name: string | null;
  /**
   * The pre-fill: an own-layer entry verbatim for an edit, the global entry
   * minus secrets + `auth` for a folder override, `{}` for add.
   */
  entry: Record<string, unknown>;
  /** Dotted fields an override pre-fill dropped — each renders a warning. */
  omitted?: readonly string[];
  /** Write scope (default global). The folder page passes `{ kind: "project", cwd }`. */
  scope?: Scope;
  /** Folder page: use `mcp-folder-editor` as the dialog testid. */
  dialogTestId?: string;
  onClose: () => void;
  /** Called after a successful write so the page re-fetches. */
  onChanged: () => void;
}

type Translate = ReturnType<typeof useT>;

function editorTitle(t: Translate, name: string | null): string {
  if (name === null) return t("mcpEditorAddTitle", undefined, "Add server");
  return t("mcpEditorEditTitle", { name }, `Edit server ${name}`);
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

/** Client-side save blockers: the visible fields' widgets, unknown-field JSON, the name. */
function collectSaveErrors(
  target: string,
  nameErrorEmpty: string,
  nameErrorInvalid: string,
  fields: FieldSchema[],
  draft: Record<string, unknown>,
  tab: Transport,
  raw: RawText,
  unknownKeys: string[],
): Record<string, string> {
  const errors = validateDraft(fields, draft, tab, raw);
  for (const key of unknownKeys) {
    const text = raw[key] ?? JSON.stringify(draft[key]);
    if (text.trim() === "") continue;
    try {
      JSON.parse(text);
    } catch {
      errors[key] = "Invalid JSON";
    }
  }
  if (target === "") errors.name = nameErrorEmpty;
  else if (!isValidServerName(target)) errors.name = nameErrorInvalid;
  return errors;
}

export function ServerEditor({
  name,
  entry,
  omitted,
  scope = { kind: "global" },
  dialogTestId,
  onClose,
  onChanged,
}: ServerEditorProps): React.ReactElement {
  const t = useT();
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [schemaError, setSchemaError] = useState<Error | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => clone(entry));
  const [tab, setTab] = useState<Transport>(() => initialTab(entry));
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [raw, setRaw] = useState<RawText>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [serverName, setServerName] = useState(name ?? "");
  const [saving, setSaving] = useState(false);
  // Dirty tracking for the discard guard: against the INITIAL pre-fill.
  const initialDraft = useRef(clone(entry));
  const initialName = name ?? "";

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

  const fields = schema ? fieldsOf(schema) : [];
  const schemaFieldNames = new Set(fields.map((f) => f.name));
  const visible = fields.filter((f) => visibleUnderTransport(f.name, tab));
  const unknownKeys = Object.keys(draft).filter(
    (k) => !schemaFieldNames.has(k) && getPath(draft, [k]) !== undefined,
  );

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
    if (next === tab) return;
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

  const dirty = !deepEqual(draft, initialDraft.current) || serverName !== initialName;

  function attemptClose(): void {
    if (dirty && !window.confirm(t("mcpDiscardConfirm", undefined, "Discard unsaved changes?"))) return;
    onClose();
  }

  // Renaming or re-pointing an OAuth HTTP server needs a fresh sign-in.
  const oauthWarning =
    name !== null &&
    transportOf(entry) === "http" &&
    authModeOf(entry)?.kind === "oauth" &&
    (serverName.trim() !== name || draft.url !== entry.url);

  async function save(): Promise<void> {
    const target = serverName.trim();
    const allErrors = collectSaveErrors(
      target,
      t("mcpEditorNameRequired", undefined, "Server name is required."),
      t("mcpEditorNameInvalid", undefined, 'Invalid server name (use letters, digits, "_" and "-").'),
      visible,
      draft,
      tab,
      raw,
      unknownKeys,
    );
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      setSummary(t("mcpEditorInvalidSummary", undefined, "Fix the errors before saving."));
      return;
    }
    setSaving(true);
    try {
      await saveServer(target, {
        ...scopeToWire(scope),
        entry: buildEntry(draft, tab, scope),
        ...(name !== null && target !== name ? { previousName: name } : {}),
        ...(name === null ? { create: true } : {}),
      });
      invalidateEffective(scope.kind === "project" ? scope.cwd : undefined);
      onChanged();
      onClose();
    } catch (e) {
      const failure = failureState(e, {});
      if (failure.errors) setErrors(failure.errors);
      setSummary(failure.summary);
    } finally {
      setSaving(false);
    }
  }

  const summaryText = summary ?? (schemaError ? `Could not load the field schema: ${schemaError.message}` : null);
  const title = editorTitle(t, name);
  const projectScope = scope.kind === "project";

  const ctx: EditorCtx = {
    draft,
    write,
    revealed,
    toggleReveal,
    raw,
    setRawText,
    errors,
    projectScope,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label={t("mcpEditorClose", undefined, "Close")}
        onClick={attemptClose}
        data-testid="mcp-editor-backdrop"
        className="absolute inset-0 bg-black/40 cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={dialogTestId ?? "mcp-editor-dialog"}
        onKeyDown={(e) => {
          if (e.key === "Escape") attemptClose();
        }}
        className="relative w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded-t-lg sm:rounded-lg p-3 space-y-2 outline-none"
      >
        <h2 className="text-sm font-semibold m-0 text-[var(--text-primary)]">{title}</h2>

        <EditorNameField value={serverName} onChange={setServerName} error={errors.name} />
        {summaryText && <EditorSummary text={summaryText} errors={errors} />}
        {!schema && <EditorSkeleton />}
        {schema && (
          <>
            {omitted && omitted.length > 0 && <OmittedWarnings omitted={omitted} />}
            {oauthWarning && (
              <p
                data-testid="mcp-oauth-warning"
                role="alert"
                className="text-[11px] text-amber-500 border border-amber-500 rounded px-2 py-1.5 m-0"
              >
                {t(
                  "mcpOauthReloginWarning",
                  { name: serverName.trim() },
                  "Changing the name or URL requires a new sign-in: pi keys OAuth credentials by server name + URL. Run /mcp login after saving.",
                )}
              </p>
            )}
            <TransportTabs tab={tab} onSelect={switchTab} />
            <div className="space-y-2">
              <FieldRows fields={visible.filter((f) => COMMON_FIELDS.has(f.name))} ctx={ctx} />
            </div>
            <AdvancedFields visible={visible} ctx={ctx} />
            {unknownKeys.length > 0 && <UnknownFields keys={unknownKeys} ctx={ctx} />}
          </>
        )}
        <EditorFooter saving={saving} onSave={save} onClose={attemptClose} />
      </div>
    </div>
  );
}

interface EditorCtx {
  draft: Record<string, unknown>;
  write: (path: string[], value: unknown) => void;
  revealed: ReadonlySet<string>;
  toggleReveal: (key: string) => void;
  raw: RawText;
  setRawText: (key: string, value: string) => void;
  errors: Record<string, string>;
  projectScope: boolean;
}

function OmittedWarnings({ omitted }: { omitted: readonly string[] }): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-omitted-warnings"
      role="alert"
      className="text-[11px] text-amber-500 border border-amber-500 rounded px-2 py-1.5 space-y-0.5"
    >
      <p className="m-0 font-medium">
        {t("mcpOmittedHeading", undefined, "Not inherited — re-enter or the folder entry will lack them:")}
      </p>
      {omitted.map((dotted) => (
        <p key={dotted} data-testid={`mcp-omitted-${dotted}`} className="m-0">
          {dotted}
          {dotted === "auth"
            ? t("mcpOmittedAuth", undefined, " — provider auth is global-only; a folder entry cannot carry it.")
            : t("mcpOmittedField", undefined, " — will be absent unless re-entered.")}
        </p>
      ))}
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
  onSelect,
}: {
  tab: Transport;
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

function EditorFooter({
  saving,
  onSave,
  onClose,
}: {
  saving: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div data-testid="mcp-editor-footer" className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={saving}
        data-testid="mcp-save"
        className={PRIMARY_BTN_CLS}
      >
        {t("mcpEditorSave", undefined, "Save")}
      </button>
      <button type="button" onClick={onClose} data-testid="mcp-editor-close" className={BTN_CLS}>
        {t("mcpEditorCloseLabel", undefined, "Close")}
      </button>
    </div>
  );
}

// ─── field rendering ─────────────────────────────────────────────────────────

function FieldRows({ fields, ctx }: { fields: FieldSchema[]; ctx: EditorCtx }): React.ReactElement {
  return (
    <>
      {fields.map((f) => (
        <FieldRow key={f.name} field={f} ctx={ctx} />
      ))}
    </>
  );
}

function AdvancedFields({ visible, ctx }: { visible: FieldSchema[]; ctx: EditorCtx }): React.ReactElement {
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

function FieldRow({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  return (
    <div data-testid={`mcp-field-${field.name}`} className="space-y-1">
      <span className="block text-[11px] text-[var(--text-secondary)]">{field.name}</span>
      {field.globalOnly && ctx.projectScope ? (
        <p data-testid="mcp-global-only-auth" className="text-[11px] text-[var(--text-secondary)] m-0">
          provider auth is global-only: pi reads auth only from ~/.pi/agent/mcp.json, so a folder
          entry cannot set it.
        </p>
      ) : (
        <FieldControl field={field} ctx={ctx} />
      )}
      {ctx.errors[field.name] && (
        <p data-testid={`mcp-field-error-${field.name}`} role="alert" className={ERROR_CLS}>
          {ctx.errors[field.name]}
        </p>
      )}
    </div>
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
      return (
        <StringListEditor
          field={field}
          rows={rows}
          onRows={(next) => ctx.write(field.path, next.length === 0 ? undefined : next)}
        />
      );
    }
    case "record":
      return <RecordControl field={field} ctx={ctx} />;
    case "nested-group":
      return (
        <div className="space-y-2 border-l border-[var(--border-secondary)] pl-2">
          {(field.children ?? []).map((child) => (
            <FieldRow key={child.name} field={child} ctx={ctx} />
          ))}
        </div>
      );
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

function TextControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
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

function SecretTextControl({
  field,
  ctx,
  value,
}: {
  field: FieldSchema;
  ctx: EditorCtx;
  value: unknown;
}): React.ReactElement {
  const shown = ctx.revealed.has(field.name);
  // A ${NAME} reference or !command is a pointer, not a secret: show as written.
  const inputType = shown || !isMaskedValue(true, field.name, value) ? "text" : "password";
  return (
    <span className="flex items-center gap-1">
      <input
        type={inputType}
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
  // The stored alias displays resolved (`codemode-deferred` → `codemode`) but
  // is kept unless the operator picks another option.
  const display =
    value !== undefined && field.displayResolver ? field.displayResolver(value) : value;
  return (
    <select
      aria-label={field.name}
      data-testid={`mcp-field-input-${field.name}`}
      value={value === undefined ? "" : String(display)}
      onChange={(e) => ctx.write(field.path, e.target.value === "" ? undefined : e.target.value)}
      className={INPUT_CLS}
    >
      <option value="">{t("mcpEnumInherit", undefined, "(inherit)")}</option>
      {(field.enumValues ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
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

function RecordControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  const value = getPath(ctx.draft, field.path);
  const rows =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const writeRecord = (next: Record<string, unknown>) => ctx.write(field.path, next);

  return (
    <div className="space-y-1" data-testid={`mcp-record-${field.name}`}>
      {Object.entries(rows).map(([key, entry]) => {
        const rowName = `${field.name}.${key}`;
        const masked = isMaskedValue(field.secret, key, entry);
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
            {field.valueEnum ? (
              <select
                aria-label={`${rowName} exposure`}
                data-testid={`mcp-record-value-${rowName}`}
                value={field.displayResolver ? field.displayResolver(entry) : String(entry)}
                onChange={(e) => {
                  const next = { ...rows };
                  if (e.target.value === "") delete next[key];
                  else next[key] = e.target.value;
                  writeRecord(next);
                }}
                className={`${INPUT_CLS}`}
              >
                <option value="">{t("mcpEnumInherit", undefined, "(inherit)")}</option>
                {field.valueEnum.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : typeof entry === "string" ? (
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
        onClick={() => writeRecord({ ...rows, "": field.valueEnum ? "" : "" })}
        className={BTN_CLS}
      >
        + {t("mcpAddRowLabel", undefined, "Add")}
      </button>
    </div>
  );
}

function JsonControl({ field, ctx }: { field: FieldSchema; ctx: EditorCtx }): React.ReactElement {
  const value = getPath(ctx.draft, field.path);
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

/** Top-level keys with no schema field: a validated JSON editor each, preserved on save. */
function UnknownFields({ keys, ctx }: { keys: string[]; ctx: EditorCtx }): React.ReactElement {
  const t = useT();
  return (
    <div data-testid="mcp-unknown-fields" className="space-y-2 border border-[var(--border-secondary)] rounded p-1.5">
      <span className="block text-[11px] text-[var(--text-secondary)]">
        {t("mcpUnknownFields", undefined, "Other fields (JSON)")}
      </span>
      {keys.map((key) => {
        const value = ctx.draft[key];
        const text = ctx.raw[key] ?? (value === undefined ? "" : JSON.stringify(value, null, 2));
        return (
          <div key={key} className="space-y-1">
            <span className="block text-[11px] text-[var(--text-secondary)]">{key}</span>
            <textarea
              aria-label={key}
              data-testid={`mcp-unknown-field-input-${key}`}
              rows={3}
              value={text}
              onChange={(e) => {
                ctx.setRawText(key, e.target.value);
                if (e.target.value.trim() === "") ctx.write([key], undefined);
                else {
                  try {
                    ctx.write([key], JSON.parse(e.target.value));
                  } catch {
                    /* keep the last parsed value; save validation flags the raw text */
                  }
                }
              }}
              className={`${INPUT_CLS} font-mono`}
            />
            {ctx.errors[key] && (
              <p data-testid={`mcp-unknown-field-error-${key}`} role="alert" className={ERROR_CLS}>
                {ctx.errors[key]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
