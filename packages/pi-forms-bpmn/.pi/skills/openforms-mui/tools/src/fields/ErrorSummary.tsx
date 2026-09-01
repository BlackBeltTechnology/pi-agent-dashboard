import type { JSX } from "react";
import { useEffect, useRef } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Typography from "@mui/material/Typography";

export interface ErrorSummaryEntry {
  message: string;
  /** Field name/id to focus on activation; absent for form-level problems. */
  fieldName?: string;
}

/**
 * Linked error summary shown above the form on a blocked submit/advance. It
 * receives focus when it appears (so a keyboard/AT user is told why the form did
 * not advance), each linked entry moves focus to its field, and an entry with no
 * reachable control reads as a form-level problem rather than a dead link.
 */
export function ErrorSummary({
  title,
  entries,
}: {
  title: string;
  entries: ErrorSummaryEntry[];
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (entries.length > 0) ref.current?.focus();
  }, [entries]);

  if (entries.length === 0) return null;

  const focusField = (fieldName: string) => {
    const el =
      document.getElementById(fieldName) ??
      document.querySelector<HTMLElement>(`[data-field-key="${fieldName}"] input, [data-field-key="${fieldName}"] textarea, [data-field-key="${fieldName}"] [tabindex]`);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  return (
    <Alert severity="error" ref={ref} tabIndex={-1} sx={{ mb: 3 }} role="alert">
      <AlertTitle>{title}</AlertTitle>
      <List dense disablePadding>
        {entries.map((e, i) => (
          <ListItem key={i} disablePadding sx={{ display: "list-item", listStyle: "disc", ml: 3 }}>
            {e.fieldName ? (
              <Link
                component="button"
                type="button"
                underline="always"
                onClick={() => focusField(e.fieldName!)}
                sx={{ textAlign: "left" }}
              >
                {e.message}
              </Link>
            ) : (
              <Typography component="span" variant="body2">
                {e.message}
              </Typography>
            )}
          </ListItem>
        ))}
      </List>
    </Alert>
  );
}
