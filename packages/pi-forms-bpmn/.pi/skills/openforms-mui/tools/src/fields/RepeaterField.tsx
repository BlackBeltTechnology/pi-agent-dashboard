import type { JSX } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormLabel from "@mui/material/FormLabel";
import Stack from "@mui/material/Stack";
import { useFieldArray, useFormContext } from "react-hook-form";
import type { Field, RepeaterField as RepeaterFieldType } from "../schema/types.js";
import { emptyValueFor } from "../validation/empty.js";
import { useOpenForms } from "./context.js";
import { FieldShell } from "./FieldShell.js";
import { FieldRenderer } from "./FieldRenderer.js";

/** Build one empty row object with every child key present (payload contract). */
export function emptyRepeaterRow(field: RepeaterFieldType): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const r of field.rows ?? []) {
    for (const col of r.columns) {
      for (const child of col.fields) {
        if (child.type === "header" || child.type === "paragraph") continue;
        row[child.key] = emptyValueFor(child.type);
      }
    }
  }
  return row;
}

export function RepeaterFieldWidget({ field, name }: { field: RepeaterFieldType; name: string }): JSX.Element {
  const { control } = useFormContext();
  const { t, readOnly, state } = useOpenForms();
  const fs = state.fields.get(field.key);
  const disabled = readOnly || fs?.disabled;
  const { fields, append, remove } = useFieldArray({ control, name });

  const min = field.minItems ?? 0;
  const max = field.maxItems ?? Infinity;
  const canAdd = !disabled && fields.length < max;
  const canRemove = (index: number) => !disabled && fields.length > min && fields.length - 1 >= min && index >= 0;

  const childFields: Field[] = (field.rows ?? []).flatMap((r) =>
    r.columns.flatMap((c) => c.fields),
  );

  return (
    <FieldShell field={field}>
      <FormLabel component="legend" sx={{ mb: 1, display: "block" }}>
        {t.text(field.label, field.key) || field.key}
      </FormLabel>
      <Stack spacing={2}>
        {fields.map((item, index) => (
          <Card key={item.id} variant="outlined">
            <CardContent>
              {childFields.map((child, ci) => (
                <FieldRenderer key={`${child.key}-${ci}`} field={child} namePrefix={`${name}.${index}.`} inRepeater />
              ))}
              {!readOnly && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => remove(index)}
                    disabled={!canRemove(index)}
                  >
                    {t.text(field.removeLabel) || t.ui.removeItem}
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>
        ))}
        {!readOnly && (
          <Box>
            <Button variant="outlined" onClick={() => append(emptyRepeaterRow(field))} disabled={!canAdd}>
              {t.text(field.addLabel) || t.ui.addItem}
            </Button>
          </Box>
        )}
      </Stack>
    </FieldShell>
  );
}
