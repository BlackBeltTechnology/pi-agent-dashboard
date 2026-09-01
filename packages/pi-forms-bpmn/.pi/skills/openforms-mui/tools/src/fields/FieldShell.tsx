import type { JSX } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { Field } from "../schema/types.js";
import { useOpenForms } from "./context.js";

/**
 * Wraps a widget with the shared affordances the renderer spec requires:
 * a computed/derived hint for calculated fields, a "shown because…" reason for
 * conditionally-revealed fields, and a non-colour disabled cue. The label and
 * error live on the widget itself so screen readers get one association.
 */
export function FieldShell({
  field,
  children,
  revealed,
}: {
  field: Field;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
  /** True when this field is only visible because a rule became satisfied. */
  revealed?: boolean;
}): JSX.Element {
  const { t, state } = useOpenForms();
  const fs = state.fields.get(field.key);
  const calculated = fs?.calculated;

  return (
    <Box sx={{ mb: 2 }} data-field-key={field.key}>
      {children}
      {calculated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t.ui.computedHint}
        </Typography>
      )}
      {!calculated && fs?.disabled && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t.ui.disabledHint}
        </Typography>
      )}
      {revealed && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t.ui.revealedReason}
        </Typography>
      )}
    </Box>
  );
}
