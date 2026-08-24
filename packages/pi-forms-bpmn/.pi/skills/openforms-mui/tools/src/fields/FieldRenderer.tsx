import type { JSX } from "react";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs from "dayjs";
import { useController, useFormContext } from "react-hook-form";
import type { Field } from "../schema/types.js";
import { useOpenForms } from "./context.js";
import { FieldShell } from "./FieldShell.js";
import { labelWithMarker } from "./label.js";
import { MatrixFieldWidget } from "./MatrixField.js";
import { registerFieldRenderer } from "./renderer-registry.js";
import { RepeaterFieldWidget } from "./RepeaterField.js";
import { FileFieldWidget } from "./FileField.js";
import { SignatureCanvas } from "./SignatureCanvas.js";

/**
 * Module-level render-prop wrapper over `useController`. Defined outside
 * `FieldRenderer` so it is a stable component identity — a nested definition
 * would remount every render and drop input focus.
 */
function Controlled({
  name,
  children,
}: {
  name: string;
  children: (args: {
    value: unknown;
    onChange: (v: unknown) => void;
    onBlur: () => void;
    error?: string;
  }) => JSX.Element;
}): JSX.Element {
  const { control } = useFormContext();
  const { field, fieldState } = useController({ name, control });
  return children({ value: field.value, onChange: field.onChange, onBlur: field.onBlur, error: fieldState.error?.message });
}

export interface FieldRendererProps {
  field: Field;
  /** Name prefix for repeater children (e.g. "people.0."). */
  namePrefix?: string;
  inRepeater?: boolean;
  /** True when the field is only visible because a rule just became satisfied. */
  revealed?: boolean;
}

const DATE_FMT = "YYYY-MM-DD";

export function FieldRenderer({ field, namePrefix = "", inRepeater, revealed }: FieldRendererProps): JSX.Element | null {
  const { t, readOnly, state, markerMode, SignatureComponent } = useOpenForms();
  const fs = inRepeater ? undefined : state.fields.get(field.key);
  const name = `${namePrefix}${field.key}`;
  const disabled = readOnly || fs?.disabled;
  const label = labelWithMarker(field, fs, t, markerMode);
  const help = t.text(field.helpText);
  const apiUnsupported =
    (field.type === "dropdown" || field.type === "radio" || field.type === "checkbox") &&
    field.optionsType === "api";

  // Static content contributes no control and no answer entry.
  if (field.type === "header") {
    return (
      <FieldShell field={field}>
        <Typography variant="h6" component="h3">
          {t.text(field.label, field.key)}
        </Typography>
        <Divider sx={{ mt: 1 }} />
      </FieldShell>
    );
  }
  if (field.type === "paragraph") {
    return (
      <FieldShell field={field}>
        <Typography variant="body1">{t.text(field.label, field.key)}</Typography>
      </FieldShell>
    );
  }

  // A non-rendered calculated field computes but never renders.
  if (field.type === "number" && field.isCalculated && field.isVisibleOnForm === false) {
    return null;
  }

  // Composite widgets own their own controllers.
  if (field.type === "matrix") return <MatrixFieldWidget field={field} name={name} />;
  if (field.type === "repeater") return <RepeaterFieldWidget field={field} name={name} />;
  if (field.type === "file") return <FileFieldWidget field={field} name={name} />;

  const options = (field.type === "dropdown" || field.type === "radio" || field.type === "checkbox"
    ? apiUnsupported
      ? []
      : field.options ?? []
    : []
  ).map((o) => ({ value: o.value, label: t.text(o.label, o.value) }));

  // -- text / textarea -------------------------------------------------------
  if (field.type === "text" || field.type === "textarea") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, onBlur, error }) => (
            <TextField
              fullWidth
              id={name}
              label={label}
              placeholder={t.text(field.placeholder)}
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              disabled={disabled}
              multiline={field.type === "textarea"}
              minRows={field.type === "textarea" ? field.rows ?? 3 : undefined}
              error={!!error}
              helperText={error ?? help}
              slotProps={{ htmlInput: { "aria-required": fs?.required ?? false } }}
            />
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- number ----------------------------------------------------------------
  if (field.type === "number") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, onBlur, error }) => (
            <TextField
              fullWidth
              id={name}
              type="number"
              label={label}
              value={value === null || value === undefined ? "" : value}
              onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
              onBlur={onBlur}
              disabled={disabled || field.isCalculated}
              error={!!error}
              helperText={error ?? help}
              slotProps={{ htmlInput: { "aria-required": fs?.required ?? false, readOnly: field.isCalculated } }}
            />
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- date ------------------------------------------------------------------
  if (field.type === "date") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, error }) => (
            <DatePicker
              label={label}
              value={value ? dayjs(value as string) : null}
              onChange={(d) => onChange(d ? d.format(DATE_FMT) : "")}
              disabled={disabled}
              slotProps={{
                textField: {
                  fullWidth: true,
                  id: name,
                  error: !!error,
                  helperText: error ?? help,
                },
              }}
            />
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- boolean ---------------------------------------------------------------
  if (field.type === "boolean") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, error }) => (
            <FormControl error={!!error} disabled={disabled} component="fieldset" variant="standard">
              <FormControlLabel
                control={<Switch checked={!!value} onChange={(e) => onChange(e.target.checked)} />}
                label={label}
              />
              {(error ?? help) && <FormHelperText>{error ?? help}</FormHelperText>}
            </FormControl>
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- dropdown --------------------------------------------------------------
  if (field.type === "dropdown") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, onBlur, error }) => (
            <TextField
              select
              fullWidth
              id={name}
              label={label}
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              disabled={disabled || apiUnsupported}
              error={!!error}
              helperText={apiUnsupported ? t.ui.apiUnsupported : error ?? help}
              slotProps={{ htmlInput: { "aria-required": fs?.required ?? false } }}
            >
              {options.length === 0 && (
                <MenuItem value="" disabled>
                  {apiUnsupported ? t.ui.apiUnsupported : t.ui.noOptions}
                </MenuItem>
              )}
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- radio -----------------------------------------------------------------
  if (field.type === "radio") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, error }) => (
            <FormControl error={!!error} disabled={disabled || apiUnsupported} component="fieldset">
              <FormLabel component="legend">{label}</FormLabel>
              <RadioGroup value={value ?? ""} onChange={(_e, v) => onChange(v)}>
                {options.map((o) => (
                  <FormControlLabel key={o.value} value={o.value} control={<Radio />} label={o.label} />
                ))}
              </RadioGroup>
              {(apiUnsupported || error || help) && (
                <FormHelperText>{apiUnsupported ? t.ui.apiUnsupported : error ?? help}</FormHelperText>
              )}
            </FormControl>
          )}
        </Controlled>
      </FieldShell>
    );
  }

  // -- checkbox (multi) ------------------------------------------------------
  if (field.type === "checkbox") {
    return (
      <FieldShell field={field} revealed={revealed}>
        <Controlled name={name}>
          {({ value, onChange, error }) => {
            const arr: string[] = Array.isArray(value) ? value : [];
            const toggle = (v: string, checked: boolean) =>
              onChange(checked ? [...arr, v] : arr.filter((x) => x !== v));
            return (
              <FormControl error={!!error} disabled={disabled || apiUnsupported} component="fieldset">
                <FormLabel component="legend">{label}</FormLabel>
                <FormGroup>
                  {options.map((o) => (
                    <FormControlLabel
                      key={o.value}
                      control={
                        <Checkbox
                          checked={arr.includes(o.value)}
                          onChange={(e) => toggle(o.value, e.target.checked)}
                        />
                      }
                      label={o.label}
                    />
                  ))}
                </FormGroup>
                {(apiUnsupported || error || help) && (
                  <FormHelperText>{apiUnsupported ? t.ui.apiUnsupported : error ?? help}</FormHelperText>
                )}
              </FormControl>
            );
          }}
        </Controlled>
      </FieldShell>
    );
  }

  // -- signature -------------------------------------------------------------
  if (field.type === "signature") {
    const Sig = SignatureComponent ?? SignatureCanvas;
    return (
      <FieldShell field={field} revealed={revealed}>
        <FormLabel component="legend" sx={{ mb: 1, display: "block" }}>
          {label}
        </FormLabel>
        <Controlled name={name}>
          {({ value, onChange, error }) => (
            <>
              <Sig
                value={(value as string) ?? ""}
                onChange={onChange}
                disabled={disabled}
                readOnly={readOnly}
                ariaLabel={label}
                clearLabel={t.ui.clear}
              />
              {(error ?? help) && <FormHelperText error={!!error}>{error ?? help}</FormHelperText>}
            </>
          )}
        </Controlled>
      </FieldShell>
    );
  }

  return null;
}

// Register at module load so container widgets (repeater, matrix) can resolve
// the renderer at RENDER time instead of importing it — see renderer-registry.
registerFieldRenderer(FieldRenderer);
