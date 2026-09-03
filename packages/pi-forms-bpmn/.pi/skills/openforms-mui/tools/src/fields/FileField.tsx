import type { JSX } from "react";
import { useState } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import FormHelperText from "@mui/material/FormHelperText";
import { useController, useFormContext } from "react-hook-form";
import type { FileAnswer, FileField as FileFieldType } from "../schema/types.js";
import { useOpenForms } from "./context.js";
import { FieldShell } from "./FieldShell.js";

const DEFAULT_MAX_MB = 5;

function typeMatches(accepted: string[] | undefined, file: File): boolean {
  if (!accepted || accepted.length === 0) return true;
  return accepted.some((a) => {
    const t = a.trim().toLowerCase();
    if (t.endsWith("/*")) return file.type.toLowerCase().startsWith(t.slice(0, -1));
    if (t.startsWith(".")) return file.name.toLowerCase().endsWith(t);
    return file.type.toLowerCase() === t;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function FileFieldWidget({ field, name }: { field: FileFieldType; name: string }): JSX.Element {
  const { control } = useFormContext();
  const { t, readOnly, state } = useOpenForms();
  const fs = state.fields.get(field.key);
  const {
    field: { value, onChange },
    fieldState,
  } = useController({ name, control, defaultValue: null });
  const [localError, setLocalError] = useState<string | null>(null);

  const maxMb = field.maxFileSizeMB ?? DEFAULT_MAX_MB;
  const current = value as FileAnswer | null;

  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setLocalError(null);

    if (file.size > maxMb * 1024 * 1024) {
      setLocalError(t.ui.fileTooLarge(maxMb));
      return; // NOT encoded into state
    }
    if (!typeMatches(field.acceptedTypes, file)) {
      setLocalError(t.ui.fileTypeRejected((field.acceptedTypes ?? []).join(", ")));
      return; // NOT encoded into state
    }
    const content = await readAsDataUrl(file);
    const answer: FileAnswer = { name: file.name, size: file.size, type: file.type, content };
    onChange(answer);
  };

  const error = localError ?? fieldState.error?.message ?? null;

  return (
    <FieldShell field={field} htmlFor={name} error={fieldState.error?.message}>
      <Stack spacing={1}>
        {!readOnly && (
          <Button variant="outlined" component="label" disabled={fs?.disabled}>
            {current ? current.name : t.ui.selectPlaceholder}
            <input
              id={name}
              type="file"
              hidden
              accept={(field.acceptedTypes ?? []).join(",")}
              onChange={onSelect}
            />
          </Button>
        )}
        {current && (
          <Typography variant="body2" color="text.secondary">
            {current.name} ({Math.round(current.size / 1024)} KB)
          </Typography>
        )}
        {error && <FormHelperText error>{error}</FormHelperText>}
      </Stack>
    </FieldShell>
  );
}
