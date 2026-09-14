/**
 * mcp-client-plugin · global settings form (task 7.6).
 *
 * Renders the adapter's global settings (`$defs.McpSettings`, from the published
 * schema) as ONE host draft source (`plugin:mcp-client`): the host Save Bar /
 * dirty dot / rail guard own saving, so this section renders NO Save button and
 * NO section-local footer. A key set in the Pi-global layer is editable; every
 * other key shows the EFFECTIVE fallback (a shared layer's value labelled with
 * its layer, else the adapter default) and clearing a Pi-global key reverts to
 * that fallback. Below, visually separated, the "Dashboard plugin settings"
 * group carries the plugin's own host config (`adapterLoadTimeoutMs`) in the
 * SAME draft source: `commit` awaits both the adapter `PUT /settings` patch and
 * the `plugin_config_write`, advancing each baseline independently so a partial
 * failure stays dirty with the error on the failing group only.
 *
 * Controls are compact re-implementations over `schema.ts`'s `widgetFor` +
 * `computePatch` (server testids + the clear/inherited wrapper differ from the
 * modal editor's, so the two do not share the per-widget control).
 *
 * See change: extract-mcp-client-plugin (task 7.6).
 */
import {
  usePluginConfig,
  usePluginSend,
  useSettingsDraftSource,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { SettingSource } from "../core/effective-view.js";
import { type EffectiveResponse, fetchSchema, patchSettings } from "./api.js";
import { invalidateEffective } from "./hooks.js";
import {
  clone,
  computePatch,
  deepEqual,
  type FieldSchema,
  fieldsForDef,
  setPath,
  validateFields,
} from "./schema.js";

const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 120000;
const TIMEOUT_DEFAULT = 10000;
const TIMEOUT_ID = "mcp-adapter-timeout";
const PLUGIN_ID = "mcp-client";

const INPUT_CLS =
  "w-full min-h-11 sm:min-h-0 text-xs bg-transparent border border-[var(--border-secondary)] rounded px-1.5 py-1 text-[var(--text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary,#60a5fa)] disabled:opacity-50";
const BTN_CLS =
  "text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50";
const ERROR_CLS = "text-[11px] text-[var(--status-error,#f87171)] m-0";

type Draft = Record<string, unknown>;

interface FormCtx {
  view: EffectiveResponse;
  draft: Draft;
  raw: Record<string, string>;
  readOnly: boolean;
  write: (key: string, value: unknown) => void;
  setRawText: (key: string, value: string) => void;
  clear: (key: string) => void;
}

/** The Pi-global layer's own values — the draft/baseline seed. */
function piGlobalValues(view: EffectiveResponse): Draft {
  const out: Draft = {};
  for (const [key, source] of Object.entries(view.settings)) {
    if (source.source === "pi-global") out[key] = clone(source.value);
  }
  return out;
}

/** The effective fallback for a key not set in Pi-global: a lower layer, or the adapter default. */
function fallbackOf(view: EffectiveResponse, field: FieldSchema): SettingSource | null {
  const setting = view.settings[field.name];
  if (setting) return setting;
  const def = field.schema.default;
  return def === undefined ? null : { value: def, source: "default" };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** `null` when the text is an integer inside `[TIMEOUT_MIN, TIMEOUT_MAX]`. */
function parseTimeout(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < TIMEOUT_MIN || value > TIMEOUT_MAX) return null;
  return value;
}

export interface GlobalSettingsFormProps {
  view: EffectiveResponse;
  /** Page-wide read-only (adapter not ok): every input disabled, `commit` a no-op. */
  readOnly: boolean;
  /** Called after a successful adapter patch so the page can re-fetch its view. */
  onChanged?: () => void;
}

export function GlobalSettingsForm({
  view,
  readOnly,
  onChanged,
}: GlobalSettingsFormProps): React.ReactElement {
  const t = useT();
  const config = usePluginConfig<{ adapterLoadTimeoutMs?: number }>();
  const send = usePluginSend();

  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const global = useMemo(() => piGlobalValues(view), [view]);
  const [baseline, setBaseline] = useState<Draft>(global);
  const [draft, setDraft] = useState<Draft>(global);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [adapterError, setAdapterError] = useState<string | null>(null);
  const [pluginError, setPluginError] = useState<string | null>(null);

  const initialTimeout = config.adapterLoadTimeoutMs ?? TIMEOUT_DEFAULT;
  const [pluginBaseline, setPluginBaseline] = useState<number>(initialTimeout);
  const [timeoutText, setTimeoutText] = useState<string>(String(initialTimeout));

  useEffect(() => {
    fetchSchema().then(
      (doc) => setSchema(doc),
      () => setSchema(null),
    );
  }, []);

  const fields = schema ? fieldsForDef(schema, "McpSettings") : [];
  const write = (key: string, value: unknown) => setDraft((d) => setPath(d, [key], value));
  const setRawText = (key: string, value: string) => setRaw((r) => ({ ...r, [key]: value }));
  const clear = (key: string) => {
    setDraft((d) => setPath(d, [key], undefined));
    setRaw((r) => {
      const next = { ...r };
      delete next[key];
      return next;
    });
  };

  const parsedTimeout = parseTimeout(timeoutText);
  const timeoutError =
    parsedTimeout === null
      ? t(
          "mcpTimeoutRange",
          { min: TIMEOUT_MIN, max: TIMEOUT_MAX },
          `Enter a whole number between ${TIMEOUT_MIN} and ${TIMEOUT_MAX}.`,
        )
      : null;
  const adapterDirty = !deepEqual(draft, baseline);
  const pluginDirty = parsedTimeout === null || parsedTimeout !== pluginBaseline;
  const isDirty = adapterDirty || pluginDirty;

  async function commit(): Promise<void> {
    if (readOnly) return;
    if (timeoutError !== null) throw new Error(timeoutError);
    const invalid = commitValidation();
    if (invalid !== null) {
      setAdapterError(invalid);
      throw new Error(invalid);
    }
    const { set, unset } = computePatch(draft, baseline);
    const adapterChanged = Object.keys(set).length > 0 || unset.length > 0;
    const pluginChanged = parsedTimeout !== pluginBaseline;
    if ((!adapterChanged && !pluginChanged) || parsedTimeout === null) return;

    const results = await Promise.allSettled([
      adapterWrite(adapterChanged, set, unset),
      pluginWrite(pluginChanged, parsedTimeout),
    ]);
    const failing = applyResults(results[0], results[1], parsedTimeout, adapterChanged);
    if (failing !== undefined) throw new Error(errorMessage(failing));
  }

  /** The first field-level error, or `null` when the draft is writable. */
  function commitValidation(): string | null {
    const fieldErrors = validateFields(fields, draft, raw);
    const first = Object.keys(fieldErrors)[0];
    return first === undefined ? null : (fieldErrors[first] as string);
  }

  function adapterWrite(changed: boolean, set: Draft, unset: string[]): Promise<void> {
    return changed ? patchSettings(set, unset) : Promise.resolve();
  }

  function pluginWrite(changed: boolean, ms: number): Promise<void> {
    if (!changed) return Promise.resolve();
    return Promise.resolve(
      send({ type: "plugin_config_write", id: PLUGIN_ID, config: { adapterLoadTimeoutMs: ms } }),
    );
  }

  /** Advance each baseline independently; returns the failing reason, or `undefined`. */
  function applyResults(
    adapterResult: PromiseSettledResult<void>,
    pluginResult: PromiseSettledResult<void>,
    committedTimeout: number,
    adapterChanged: boolean,
  ): unknown {
    const adapterOk = adapterResult.status === "fulfilled";
    if (adapterOk) {
      setBaseline(clone(draft));
      setAdapterError(null);
      if (adapterChanged) {
        invalidateEffective();
        onChanged?.();
      }
    } else {
      setAdapterError(errorMessage(adapterResult.reason));
    }

    const pluginOk = pluginResult.status === "fulfilled";
    if (pluginOk) {
      setPluginBaseline(committedTimeout);
      setPluginError(null);
    } else {
      setPluginError(errorMessage(pluginResult.reason));
    }

    if (adapterOk) return pluginOk ? undefined : pluginResult.reason;
    return adapterResult.reason;
  }

  const reset = () => {
    setDraft(clone(baseline));
    setRaw({});
    setTimeoutText(String(pluginBaseline));
    setAdapterError(null);
    setPluginError(null);
  };

  useSettingsDraftSource({ id: "plugin:mcp-client", isDirty, commit, reset });

  const ctx: FormCtx = { view, draft, raw, readOnly, write, setRawText, clear };
  const pluginErrorText = timeoutError ?? pluginError;

  return (
    <div className="space-y-3">
      <div data-testid="mcp-global-settings" className="space-y-3">
        <h4 className="text-[11px] font-semibold m-0 text-[var(--text-primary)]">
          {t("mcpGlobalSettingsHeading", undefined, "Adapter settings")}
        </h4>
        {adapterError && (
          <p data-testid="mcp-adapter-settings-error" role="alert" className={ERROR_CLS}>
            {adapterError}
          </p>
        )}
        {fields.map((field) => (
          <SettingFieldRow key={field.name} field={field} ctx={ctx} />
        ))}
        <p data-testid="mcp-comments-note" className="text-[10px] text-[var(--text-tertiary)] m-0">
          {t(
            "mcpCommentsNote",
            undefined,
            "Comments in the config file are not preserved on save.",
          )}
        </p>
      </div>

      <PluginSettingsGroup
        text={timeoutText}
        error={pluginErrorText}
        readOnly={readOnly}
        onChange={setTimeoutText}
      />
    </div>
  );
}

function PluginSettingsGroup({
  text,
  error,
  readOnly,
  onChange,
}: {
  text: string;
  error: string | null;
  readOnly: boolean;
  onChange: (value: string) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-plugin-settings"
      className="space-y-1 border-t border-[var(--border-secondary)] pt-3 mt-1"
    >
      <h4 className="text-[11px] font-semibold m-0 text-[var(--text-primary)]">
        {t("mcpPluginSettingsHeading", undefined, "Dashboard plugin settings")}
      </h4>
      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block mb-0.5">
          {t("mcpAdapterTimeoutLabel", undefined, "Adapter load timeout (ms)")}
        </span>
        <input
          id={TIMEOUT_ID}
          data-testid="mcp-adapter-timeout"
          type="number"
          min={TIMEOUT_MIN}
          max={TIMEOUT_MAX}
          value={text}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="mcp-adapter-timeout-help"
          className={`${INPUT_CLS} w-32`}
        />
      </label>
      <p
        id="mcp-adapter-timeout-help"
        className="text-[10px] text-[var(--text-tertiary)] m-0"
      >
        {t(
          "mcpAdapterTimeoutHelp",
          undefined,
          "Bounds how long the dashboard waits for the adapter to load configuration. Does not affect pi sessions.",
        )}
      </p>
      {error && (
        <p data-testid="mcp-plugin-error" role="alert" className={ERROR_CLS}>
          {error}
        </p>
      )}
    </div>
  );
}

function SettingFieldRow({ field, ctx }: { field: FieldSchema; ctx: FormCtx }): React.ReactElement {
  const t = useT();
  const key = field.name;
  const isSet = key in ctx.draft;
  const fallback = fallbackOf(ctx.view, field);
  const value = isSet ? ctx.draft[key] : fallback?.value;
  const canClear = isSet || fallback !== null;
  const clearLabel =
    fallback?.source === "shared"
      ? t("mcpUseInherited", undefined, "use inherited")
      : t("mcpResetDefault", undefined, "reset to default");

  return (
    <div data-testid={`mcp-setting-${key}`} className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--text-secondary)]">{key}</span>
        {canClear && (
          <button
            type="button"
            disabled={ctx.readOnly}
            onClick={() => ctx.clear(key)}
            data-testid={`mcp-setting-clear-${key}`}
            className={BTN_CLS}
          >
            {clearLabel}
          </button>
        )}
      </div>
      <SettingControl field={field} value={value} ctx={ctx} />
      {!isSet && fallback && (
        <span
          data-testid={`mcp-setting-inherited-${key}`}
          className="block text-[10px] text-[var(--text-tertiary)]"
        >
          {fallback.source === "shared"
            ? t(
                "mcpInheritedFrom",
                { layer: fallback.path ?? fallback.source },
                `inherited from ${fallback.path ?? fallback.source}`,
              )
            : t("mcpAdapterDefault", undefined, "adapter default")}
        </span>
      )}
    </div>
  );
}

function SettingControl({
  field,
  value,
  ctx,
}: {
  field: FieldSchema;
  value: unknown;
  ctx: FormCtx;
}): React.ReactElement {
  const t = useT();
  const testid = `mcp-setting-input-${field.name}`;
  const key = field.name;

  switch (field.widget) {
    case "boolean":
      return (
        // The label is the hit area: a 16px box cannot meet the 44px mobile floor.
        <label className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">
          <input
            type="checkbox"
            aria-label={key}
            data-testid={testid}
            checked={value === true}
            disabled={ctx.readOnly}
            onChange={(e) => ctx.write(key, e.target.checked)}
            className="w-4 h-4"
          />
        </label>
      );
    case "number":
      return <NumberSetting field={field} value={value} ctx={ctx} testid={testid} />;
    case "enum": {
      const numeric = (field.enumValues ?? []).some((v) => typeof v === "number");
      return (
        <select
          aria-label={key}
          data-testid={testid}
          value={value === undefined ? "" : String(value)}
          disabled={ctx.readOnly}
          onChange={(e) =>
            ctx.write(
              key,
              e.target.value === "" ? undefined : numeric ? Number(e.target.value) : e.target.value,
            )
          }
          className={INPUT_CLS}
        >
          <option value="">{t("mcpSettingInherit", undefined, "(inherit)")}</option>
          {(field.enumValues ?? []).map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    }
    case "string-list":
      return <StringListSetting field={field} value={value} ctx={ctx} testid={testid} />;
    case "toggle-list":
      return <ToggleListSetting field={field} value={value} ctx={ctx} testid={testid} />;
    case "text":
      return (
        <input
          type="text"
          aria-label={key}
          data-testid={testid}
          value={typeof value === "string" ? value : ""}
          disabled={ctx.readOnly}
          onChange={(e) => ctx.write(key, e.target.value)}
          className={INPUT_CLS}
        />
      );
    default:
      return <JsonSetting field={field} value={value} ctx={ctx} testid={testid} />;
  }
}

function NumberSetting({
  field,
  value,
  ctx,
  testid,
}: {
  field: FieldSchema;
  value: unknown;
  ctx: FormCtx;
  testid: string;
}): React.ReactElement {
  const text = ctx.raw[field.name] ?? (typeof value === "number" ? String(value) : "");
  return (
    <input
      type="number"
      aria-label={field.name}
      data-testid={testid}
      value={text}
      disabled={ctx.readOnly}
      onChange={(e) => {
        ctx.setRawText(field.name, e.target.value);
        const parsed = Number(e.target.value);
        ctx.write(
          field.name,
          e.target.value.trim() === "" || !Number.isFinite(parsed) ? undefined : parsed,
        );
      }}
      className={INPUT_CLS}
    />
  );
}

function StringListSetting({
  field,
  value,
  ctx,
  testid,
}: {
  field: FieldSchema;
  value: unknown;
  ctx: FormCtx;
  testid: string;
}): React.ReactElement {
  const t = useT();
  const rows = Array.isArray(value) ? value.map(String) : [];
  return (
    <div data-testid={testid} className="space-y-1">
      {rows.map((row, i) => (
        <input
          key={i}
          aria-label={`${field.name} ${i + 1}`}
          value={row}
          disabled={ctx.readOnly}
          onChange={(e) =>
            ctx.write(field.name, rows.map((r, j) => (j === i ? e.target.value : r)))
          }
          className={INPUT_CLS}
        />
      ))}
      <button
        type="button"
        disabled={ctx.readOnly}
        data-testid={`mcp-setting-add-${field.name}`}
        onClick={() => ctx.write(field.name, [...rows, ""])}
        className={BTN_CLS}
      >
        {t("mcpAddRowLabel", undefined, "Add")}
      </button>
    </div>
  );
}

function ToggleListSetting({
  field,
  value,
  ctx,
  testid,
}: {
  field: FieldSchema;
  value: unknown;
  ctx: FormCtx;
  testid: string;
}): React.ReactElement {
  const t = useT();
  const checked = value === true || Array.isArray(value);
  const rows = Array.isArray(value) ? value.map(String) : [];
  return (
    <div className="space-y-1">
      <label className="inline-flex items-center gap-1.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          aria-label={field.name}
          data-testid={testid}
          checked={checked}
          disabled={ctx.readOnly}
          onChange={(e) =>
            ctx.write(field.name, e.target.checked ? (Array.isArray(value) ? value : []) : false)
          }
          className="w-4 h-4 flex-none"
        />
        {t("mcpUseList", undefined, "Use a tool list")}
      </label>
      {checked && (
        <StringListSetting field={field} value={rows} ctx={ctx} testid={`${testid}-list`} />
      )}
    </div>
  );
}

function JsonSetting({
  field,
  value,
  ctx,
  testid,
}: {
  field: FieldSchema;
  value: unknown;
  ctx: FormCtx;
  testid: string;
}): React.ReactElement {
  const text = ctx.raw[field.name] ?? (value === undefined ? "" : JSON.stringify(value, null, 2));
  return (
    <textarea
      aria-label={field.name}
      data-testid={testid}
      rows={3}
      value={text}
      disabled={ctx.readOnly}
      onChange={(e) => {
        ctx.setRawText(field.name, e.target.value);
        if (e.target.value.trim() === "") {
          ctx.write(field.name, undefined);
          return;
        }
        try {
          ctx.write(field.name, JSON.parse(e.target.value));
        } catch {
          /* keep the last parsed value; validation flags the raw text */
        }
      }}
      className={`${INPUT_CLS} font-mono`}
    />
  );
}
