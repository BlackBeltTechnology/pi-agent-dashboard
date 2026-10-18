/**
 * Kit field (`FieldShell`: label, hint, error, aria wiring) around a select whose
 * options can be individually disabled with a reason in their text. The runtime
 * kit's `SelectField` has no per-option `disabled`, and the chain picker and the
 * Test backend picker both need it (off-machine while the switch is off, backend
 * not running). KIT GAP: when `SelectField` options gain `disabled`, replace this
 * file with `SelectField` and delete it.
 * See change: retro-ux-plugin-settings-wave-2.
 */
import { type FieldContract, FieldShell } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";

export interface OptionSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const CONTROL =
  "focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed aria-[invalid=true]:border-[var(--severity-error-border)]";

export function OptionSelectField({
  label,
  value,
  options,
  onChange,
  ...rest
}: FieldContract & {
  label: string;
  value: string;
  options: OptionSelectOption[];
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <FieldShell
      label={label}
      {...rest}
      control={({ id, describedBy, invalid }) => (
        <select
          id={id}
          data-testid={rest.testIds?.control}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={rest.disabled}
          className={CONTROL}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    />
  );
}
