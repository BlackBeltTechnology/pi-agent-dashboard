/**
 * Row components of the pi settings page: typed schema rows (segmented control
 * or select, number/text input, theme select with a custom value), link rows
 * and "Edit in JSON" rows. Presentational only — state lives in the page.
 *
 * Every typed row shows its label, the raw dotted key, pi's default inside the
 * control, a text-carrying "Changed" marker and a reset action (never colour
 * alone), and ties its inline error to the control (`aria-describedby`).
 *
 * See change: pi-settings-full-coverage (spec pi-agent-settings-editor,
 * "Form rows for every typed key").
 */
import type { PiSettingDef } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-schema.js";
import type { ReactNode } from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { defaultText, type ExtraRow } from "./pi-settings-form.js";

const FIELD =
  "rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-primary)]";
const BTN = "rounded border border-[var(--border-secondary)] px-2 py-0.5 text-xs text-[var(--text-primary)]";

/** Segmented control for at most three values. */
function Segmented({
  testId,
  label,
  options,
  value,
  onChange,
  describedBy,
}: {
  testId: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  describedBy?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      data-testid={testId}
      className="inline-flex max-w-full flex-wrap overflow-hidden rounded border border-[var(--border-secondary)]"
    >
      {options.map((o) => (
        <button
          key={o.value === "" ? "__default" : o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-testid={`${testId}-${o.value === "" ? "default" : o.value}`}
          onClick={() => onChange(o.value)}
          className={`min-h-7 px-2.5 py-1 text-xs ${
            value === o.value
              ? "bg-[var(--tint-blue-bg)] font-semibold text-[var(--tint-blue-fg)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Option values of a bool / enum / mixed def, with display labels. */
function choiceOptions(def: PiSettingDef): { value: string; label: string }[] {
  const on = i18nT("piSettings.on", undefined, "On");
  const off = i18nT("piSettings.off", undefined, "Off");
  const out: { value: string; label: string }[] = [];
  if (def.kind === "bool") return [{ value: "true", label: on }, { value: "false", label: off }];
  if (def.kind === "mixed") {
    if (def.mixedBool) out.push({ value: "true", label: on }, { value: "false", label: off });
    out.push(...(def.options ?? []).map((o) => ({ value: o, label: o })));
    if (def.mixedFalseOnly) out.push({ value: "false", label: off });
    return out;
  }
  return (def.options ?? []).map((o) => ({ value: o, label: o }));
}

function RowShell({
  testKey,
  label,
  keyText,
  hint,
  changed,
  onReset,
  error,
  children,
}: {
  testKey: string;
  label: string;
  keyText: string;
  hint: string;
  changed?: boolean;
  onReset?: () => void;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div data-testid={`pi-settings-row-${testKey}`} className="grid gap-1 border-b border-[var(--border-primary)] py-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-x-4">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
          {changed && (
            <span
              data-testid={`pi-settings-changed-${testKey}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] px-1.5 text-[10.5px] text-[var(--tint-blue-fg)]"
            >
              <span aria-hidden="true">●</span>
              {i18nT("piSettings.changed", undefined, "Changed")}
            </span>
          )}
        </div>
        <code className="block break-all font-mono text-[10.5px] text-[var(--text-secondary)]">{keyText}</code>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {changed && onReset && (
            <button type="button" data-testid={`pi-settings-reset-${testKey}`} className={BTN} onClick={onReset}>
              {i18nT("piSettings.reset", undefined, "Reset to default")}
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">{hint}</p>
        {error && (
          <p id={`pi-settings-err-${testKey}`} role="alert" data-testid={`pi-settings-error-${testKey}`} className="text-[11px] text-[var(--severity-error-fg)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const CUSTOM = "__custom__";

/** Terminal theme: built-in + resolved names, an unknown stored value kept selected, and "Custom…" free text. */
function ThemeControl({
  value,
  themes,
  onChange,
  testId,
  defaultLabel,
}: {
  value: string;
  themes: string[];
  onChange: (v: string) => void;
  testId: string;
  defaultLabel: string;
}) {
  const [custom, setCustom] = useState(false);
  const known = value === "" || themes.includes(value);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        data-testid={testId}
        aria-label={i18nT("piSettings.field.theme", undefined, "Terminal theme")}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
        className={`${FIELD} w-48`}
      >
        <option value="">{defaultLabel}</option>
        {!known && <option value={value}>{value}</option>}
        {themes.map((th) => (
          <option key={th} value={th}>
            {th}
          </option>
        ))}
        <option value={CUSTOM}>{i18nT("piSettings.customTheme", undefined, "Custom…")}</option>
      </select>
      {custom && (
        <input
          type="text"
          data-testid={`${testId}-custom`}
          aria-label={i18nT("piSettings.customThemeInput", undefined, "Custom theme name (or light/dark pair)")}
          placeholder="light/dark"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD} w-44 font-mono`}
        />
      )}
    </span>
  );
}

export interface SettingRowProps {
  def: PiSettingDef;
  label: string;
  hint: string;
  value: string;
  themes: string[];
  error: string | null;
  onChange: (v: string) => void;
}

export function SettingRow({ def, label, hint, value, themes, error, onChange }: SettingRowProps) {
  const testId = `pi-settings-field-${def.key}`;
  const describedBy = error ? `pi-settings-err-${def.key}` : undefined;
  const defLabel = i18nT("piSettings.defaultValue", { value: defaultText(def) }, `Default (${defaultText(def)})`);
  const reset = () => onChange("");

  let control: ReactNode;
  if (def.key === "theme") {
    control = <ThemeControl value={value} themes={themes} onChange={onChange} testId={testId} defaultLabel={defLabel} />;
  } else if (def.kind === "int") {
    control = (
      <span className="flex items-center gap-2">
        <input
          type="number"
          step={1}
          min={def.min}
          max={def.max}
          data-testid={testId}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={value}
          placeholder={defaultText(def)}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD} w-36`}
        />
        <span className="text-[11px] text-[var(--text-secondary)]">
          {i18nT("piSettings.defaultShort", { value: defaultText(def) }, `Default: ${defaultText(def)}`)}
        </span>
      </span>
    );
  } else if (def.kind === "string") {
    control = (
      <input
        type="text"
        data-testid={testId}
        aria-label={label}
        aria-describedby={describedBy}
        value={value}
        placeholder={defaultText(def)}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} w-64 max-w-full font-mono`}
      />
    );
  } else {
    const options = choiceOptions(def);
    const known = value === "" || options.some((o) => o.value === value);
    const all = known ? options : [...options, { value, label: value }];
    if (options.length <= 3) {
      control = (
        <Segmented
          testId={testId}
          label={label}
          describedBy={describedBy}
          options={[{ value: "", label: defLabel }, ...all]}
          value={value}
          onChange={onChange}
        />
      );
    } else {
      control = (
        <select data-testid={testId} aria-label={label} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} w-48`}>
          <option value="">{defLabel}</option>
          {all.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
  }

  return (
    <RowShell testKey={def.key} label={label} keyText={def.key} hint={hint} changed={value !== ""} onReset={reset} error={error}>
      {control}
    </RowShell>
  );
}

/** Row hosting a custom editor (the model scope editor). */
export function EditorRow({
  rowKey,
  label,
  hint,
  changed,
  onReset,
  children,
}: {
  rowKey: string;
  label: string;
  hint: string;
  changed: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={`pi-settings-row-${rowKey}`} className="space-y-1 border-b border-[var(--border-primary)] py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
        <code className="font-mono text-[10.5px] text-[var(--text-secondary)]">{rowKey}</code>
        {changed && (
          <span data-testid={`pi-settings-changed-${rowKey}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] px-1.5 text-[10.5px] text-[var(--tint-blue-fg)]">
            <span aria-hidden="true">●</span>
            {i18nT("piSettings.changed", undefined, "Changed")}
          </span>
        )}
        {changed && (
          <button type="button" data-testid={`pi-settings-reset-${rowKey}`} className={BTN} onClick={onReset}>
            {i18nT("piSettings.reset", undefined, "Reset to default")}
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-secondary)]">{hint}</p>
      {children}
    </div>
  );
}

export function ExtraSettingRow({
  row,
  label,
  hint,
  isSet,
  valueText,
  onNavigate,
  onEditJson,
}: {
  row: ExtraRow;
  label: string;
  hint: string;
  isSet: boolean;
  /** `default-model`: `provider/model · level` read-only. */
  valueText?: string;
  onNavigate: (page: string) => void;
  onEditJson: () => void;
}) {
  const state = isSet
    ? i18nT("piSettings.setInFile", undefined, "Set in file")
    : i18nT("piSettings.notSet", undefined, "Not set");
  return (
    <RowShell testKey={row.key} label={label} keyText={row.key} hint={hint}>
      {row.kind === "json" ? (
        <>
          <span className="text-[11px] text-[var(--text-secondary)]">{state}</span>
          <button type="button" data-testid={`pi-settings-json-${row.key}`} className={BTN} onClick={onEditJson}>
            {i18nT("piSettings.editInJson", undefined, "Edit in JSON")}
          </button>
        </>
      ) : (
        <>
          {row.kind === "default-model" && (
            <span data-testid="pi-settings-default-model-value" className="font-mono text-xs text-[var(--text-secondary)]">
              {valueText || "—"}
            </span>
          )}
          {row.kind === "link" && <span className="text-[11px] text-[var(--text-secondary)]">{state}</span>}
          <button type="button" data-testid={`pi-settings-link-${row.key}`} className={BTN} onClick={() => row.page && onNavigate(row.page)}>
            {row.linkLabel ?? i18nT("piSettings.open", undefined, "Open")}
          </button>
        </>
      )}
    </RowShell>
  );
}
