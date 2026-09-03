import type { JSX } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useController, useFormContext } from "react-hook-form";
import type { MatrixAnswer, MatrixField as MatrixFieldType } from "../schema/types.js";
import { useOpenForms } from "./context.js";
import { FieldShell } from "./FieldShell.js";

/**
 * Matrix: a table with one single-choice row group per matrix row. Collapses to
 * one card per row below the `md` breakpoint (renderer spec). The row label
 * stays programmatically associated with its options in both presentations, and
 * only one presentation exists as a control at a time.
 */
export function MatrixFieldWidget({ field, name }: { field: MatrixFieldType; name: string }): JSX.Element {
  const { control } = useFormContext();
  const { t, readOnly, state } = useOpenForms();
  const fs = state.fields.get(field.key);
  const disabled = readOnly || fs?.disabled;
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));

  const {
    field: { value, onChange },
  } = useController({ name, control, defaultValue: {} as MatrixAnswer });
  const answer = (value ?? {}) as MatrixAnswer;
  const rows = field.matrixRows ?? [];
  const cols = field.matrixColumns ?? [];

  const setRow = (rowKey: string, colValue: string) => {
    onChange({ ...answer, [rowKey]: colValue });
  };

  const groupLabel = t.text(field.label, field.key) || field.key;

  return (
    <FieldShell field={field}>
      <FormLabel component="legend" sx={{ mb: 1, display: "block" }}>
        {groupLabel}
      </FormLabel>

      {narrow ? (
        <Stack spacing={2} role="group" aria-label={groupLabel}>
          {rows.map((row) => {
            const rowId = `${name}-${row.value}`;
            return (
              <Card key={row.value} variant="outlined">
                <CardContent>
                  <FormControl disabled={disabled}>
                    <FormLabel id={rowId}>{t.text(row.label, row.value)}</FormLabel>
                    <RadioGroup
                      aria-labelledby={rowId}
                      value={answer[row.value] ?? ""}
                      onChange={(_e, v) => setRow(row.value, v)}
                    >
                      {cols.map((col) => (
                        <FormControlLabel
                          key={col.value}
                          value={col.value}
                          control={<Radio />}
                          label={t.text(col.label, col.value)}
                        />
                      ))}
                    </RadioGroup>
                  </FormControl>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      ) : (
        <Table size="small" aria-label={groupLabel}>
          <TableHead>
            <TableRow>
              <TableCell />
              {cols.map((col) => (
                <TableCell key={col.value} align="center">
                  {t.text(col.label, col.value)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const rowId = `${name}-${row.value}`;
              return (
                <TableRow key={row.value}>
                  <TableCell component="th" scope="row" id={rowId}>
                    {t.text(row.label, row.value)}
                  </TableCell>
                  {cols.map((col) => {
                    const selected = answer[row.value] === col.value;
                    return (
                      <TableCell key={col.value} align="center" sx={{ p: 0 }}>
                        {/* Whole cell is the activation target (task 10.8). */}
                        <Box
                          component="label"
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minHeight: 48,
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          <Radio
                            checked={selected}
                            disabled={disabled}
                            value={col.value}
                            name={`${name}.${row.value}`}
                            onChange={() => setRow(row.value, col.value)}
                            slotProps={{
                              input: {
                                "aria-label": `${t.text(row.label, row.value)}: ${t.text(col.label, col.value)}`,
                              },
                            }}
                          />
                        </Box>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length === 0 && <Typography variant="body2">{t.ui.noOptions}</Typography>}
    </FieldShell>
  );
}
