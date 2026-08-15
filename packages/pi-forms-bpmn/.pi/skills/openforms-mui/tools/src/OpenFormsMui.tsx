import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./fonts.js"; // bundle Roboto so typography never falls back to a system face
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { ThemeProvider, useTheme, type Theme } from "@mui/material/styles";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { FormProvider, useForm } from "react-hook-form";
import type {
  Diagnostic,
  FormAnswers,
  FormSchemaJSON,
  TranslationsDictionary,
} from "./schema/types.js";
import { normalizeSchema } from "./schema/normalize.js";
import { diagnose } from "./schema/diagnose.js";
import { walkFields } from "./schema/walk.js";
import { resolveFormState } from "./logic/state.js";
import { deriveZodSchema, FORM_LEVEL_PATH } from "./validation/zod-from-schema.js";
import { collectFieldDiagnostics } from "./validation/diagnostics.js";
import { emptyValueFor } from "./validation/empty.js";
import { composePayload, type SubmissionMeta } from "./payload.js";
import { createTranslator } from "./i18n/index.js";
import { OpenFormsProvider, type SignatureComponentProps } from "./fields/context.js";
import { FieldRenderer } from "./fields/FieldRenderer.js";
import { ErrorSummary, type ErrorSummaryEntry } from "./fields/ErrorSummary.js";
import { decideMarkerMode } from "./fields/label.js";

export interface OpenFormsMuiProps<C = unknown> {
  schema: FormSchemaJSON | Partial<FormSchemaJSON>;
  answers?: FormAnswers;
  readOnly?: boolean;
  locale?: string;
  translations?: TranslationsDictionary;
  /** Additive: supplementary process data segregated from field answers (D13). */
  submissionContext?: C;
  onSubmit?: (answers: FormAnswers, meta: SubmissionMeta<C>) => void;
  /** Receives COMPLETE form state incl. retained hidden values — not the payload. */
  onFieldChange?: (answers: FormAnswers) => void;
  SignatureComponent?: (props: SignatureComponentProps) => JSX.Element;
  /** Optional theme override; when omitted the host ThemeProvider is inherited. */
  theme?: Theme;
}

function buildInitialValues(schema: FormSchemaJSON, answers?: FormAnswers): FormAnswers {
  const out: FormAnswers = {};
  walkFields(schema, ({ field, repeaterDepth }) => {
    if (repeaterDepth !== 0) return;
    if (field.type === "header" || field.type === "paragraph") return;
    const provided = answers?.[field.key];
    out[field.key] = provided !== undefined ? provided : emptyValueFor(field.type);
  });
  return out;
}

function pageOfFieldMap(schema: FormSchemaJSON): Map<string, number> {
  const map = new Map<string, number>();
  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section) => {
      section.rows.forEach((row) => {
        row.columns.forEach((col) => {
          col.fields.forEach((field) => {
            if (field.type !== "header" && field.type !== "paragraph") map.set(field.key, pi);
          });
        });
      });
    });
  });
  return map;
}

export function OpenFormsMui<C = unknown>(props: OpenFormsMuiProps<C>): JSX.Element {
  const {
    schema: rawSchema,
    answers,
    readOnly = false,
    locale = "en",
    translations,
    submissionContext,
    onSubmit,
    onFieldChange,
    SignatureComponent,
    theme,
  } = props;

  const { schema, normDiagnostics } = useMemo(() => {
    const { schema: norm, diagnostics } = normalizeSchema(rawSchema);
    if (translations) norm.translations = { ...norm.translations, ...translations };
    return { schema: norm, normDiagnostics: diagnostics };
  }, [rawSchema, translations]);

  const staticDiagnostics = useMemo(() => diagnose(schema), [schema]);
  const pageOfField = useMemo(() => pageOfFieldMap(schema), [schema]);
  const labelByKey = useMemo(() => {
    const m = new Map<string, string>();
    walkFields(schema, ({ field, repeaterDepth }) => {
      if (repeaterDepth === 0 && field.type !== "header" && field.type !== "paragraph") {
        m.set(field.key, field.label ?? field.key);
      }
    });
    return m;
  }, [schema]);

  const t = useMemo(() => createTranslator(schema.translations, locale), [schema.translations, locale]);

  const form = useForm<FormAnswers>({
    defaultValues: useMemo(() => buildInitialValues(schema, answers), [schema, answers]),
    mode: "onSubmit",
    shouldUnregister: false, // retain hidden field values (task 7.5)
  });
  const { watch, getValues, setValue, setError, clearErrors } = form;

  const watched = watch();
  const logicState = useMemo(() => resolveFormState(schema, watched), [schema, watched]);
  const markerMode = useMemo(() => decideMarkerMode(logicState), [logicState]);

  // Write calculated values back into form state so controls and payload agree.
  const calcSignature = useMemo(() => {
    const parts: string[] = [];
    for (const [key, fs] of logicState.fields) {
      if (fs.calculated) parts.push(`${key}=${String(logicState.effectiveAnswers[key])}`);
    }
    return parts.join("|");
  }, [logicState]);
  useEffect(() => {
    for (const [key, fs] of logicState.fields) {
      if (fs.calculated && getValues(key) !== logicState.effectiveAnswers[key]) {
        setValue(key, logicState.effectiveAnswers[key] as never, { shouldDirty: false, shouldValidate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcSignature]);

  // onFieldChange receives the COMPLETE state (retained hidden values included).
  const firstChange = useRef(true);
  useEffect(() => {
    if (firstChange.current) {
      firstChange.current = false;
      return;
    }
    onFieldChange?.(logicState.effectiveAnswers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(logicState.effectiveAnswers)]);

  // Reveal tracking for WCAG 4.1.3 announcements (task 7.11).
  const prevVisible = useRef<Map<string, boolean>>(new Map());
  const [announcement, setAnnouncement] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    const newlyRevealed: string[] = [];
    for (const [key, fs] of logicState.fields) {
      const was = prevVisible.current.get(key);
      if (was === false && fs.visible) newlyRevealed.push(key);
      prevVisible.current.set(key, fs.visible);
    }
    if (newlyRevealed.length > 0) {
      setRevealedKeys((s) => new Set([...s, ...newlyRevealed]));
      const labels = newlyRevealed.map((k) => t.text(labelByKey.get(k), k) || k);
      setAnnouncement(t.ui.revealedAnnouncement(labels.join(", ")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicState]);

  const [summary, setSummary] = useState<ErrorSummaryEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const pages = schema.pages;
  const multiPage = pages.length > 1;

  const themeCtx = useTheme();
  const narrow = useMediaQuery(themeCtx.breakpoints.down("md"));

  const collectIssues = useCallback(
    (
      snapshot: FormAnswers,
    ): { blocked: boolean; entries: ErrorSummaryEntry[]; snapState: ReturnType<typeof resolveFormState> } => {
      // ONE snapshot drives validation, cross-field eval and payload (task 7.4d).
      const snapState = resolveFormState(schema, snapshot);
      const effective = snapState.effectiveAnswers;
      const entries: ErrorSummaryEntry[] = [];

      // Duplicate keys block and never reach onSubmit (tasks 7.4f, 7.4j).
      const dup = staticDiagnostics.filter((d) => d.code === "duplicate-key");
      if (dup.length > 0) {
        for (const d of dup) entries.push({ message: d.message });
        return { blocked: true, entries, snapState };
      }

      const zodSchema = deriveZodSchema(schema, snapState);
      const result = zodSchema.safeParse(effective);
      clearErrors();
      if (!result.success) {
        const seen = new Set<string>();
        for (const issue of result.error.issues) {
          if (issue.path[0] === FORM_LEVEL_PATH) {
            if (!seen.has(issue.message)) {
              entries.push({ message: issue.message });
              seen.add(issue.message);
            }
            continue;
          }
          const name = issue.path.join(".");
          setError(name as never, { type: "validate", message: issue.message });
          const dedupeKey = `${name}:${issue.message}`;
          if (!seen.has(dedupeKey)) {
            entries.push({ message: issue.message, fieldName: String(issue.path[0]) });
            seen.add(dedupeKey);
          }
        }
        return { blocked: true, entries, snapState };
      }
      return { blocked: false, entries: [], snapState };
    },
    [schema, staticDiagnostics, clearErrors, setError],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (readOnly) return; // no payload under readOnly (task 7.4g)
      const snapshot = getValues();
      const { blocked, entries, snapState } = collectIssues(snapshot);
      if (blocked) {
        setSummary(entries);
        return; // onSubmit NOT invoked (task 7.4j)
      }
      setSummary([]);
      const payload = composePayload(schema, snapState, snapState.effectiveAnswers);
      const runDiagnostics: Diagnostic[] = [
        ...normDiagnostics,
        ...collectFieldDiagnostics(schema, snapState, snapState.effectiveAnswers),
      ];
      onSubmit?.(payload, { submissionContext, diagnostics: runDiagnostics });
    },
    [readOnly, getValues, collectIssues, schema, normDiagnostics, onSubmit, submissionContext],
  );

  const goNext = useCallback(() => {
    if (readOnly) {
      setCurrentPage((p) => Math.min(p + 1, pages.length - 1));
      return;
    }
    const snapshot = getValues();
    const { entries } = collectIssues(snapshot);
    // Block advance only on errors belonging to the current page (task 7.3).
    const pageErrors = entries.filter((en) => !en.fieldName || pageOfField.get(en.fieldName) === currentPage);
    const blockingHere = entries.filter((en) => en.fieldName && pageOfField.get(en.fieldName) === currentPage);
    if (blockingHere.length > 0) {
      setSummary(pageErrors);
      return;
    }
    setSummary([]);
    setCurrentPage((p) => Math.min(p + 1, pages.length - 1));
  }, [readOnly, getValues, collectIssues, pageOfField, currentPage, pages.length]);

  const goBack = useCallback(() => {
    setSummary([]);
    setCurrentPage((p) => Math.max(p - 1, 0));
  }, []);

  const page = pages[currentPage];

  const inner = (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <OpenFormsProvider
        value={{ t, readOnly, state: logicState, SignatureComponent, markerMode }}
      >
        <FormProvider {...form}>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            {schema.formTitle && (
              <Typography variant="h5" component="h1" gutterBottom>
                {t.text(schema.formTitle, "formTitle")}
              </Typography>
            )}
            {schema.formDescription && (
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                {t.text(schema.formDescription, "formDescription")}
              </Typography>
            )}

            {markerMode === "all-required" && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t.ui.allFieldsRequired}
              </Typography>
            )}

            {!readOnly && <ErrorSummary title={t.ui.errorSummaryTitle} entries={summary} />}

            {multiPage && (
              <Stepper
                activeStep={currentPage}
                alternativeLabel={!narrow}
                orientation={narrow ? "vertical" : "horizontal"}
                sx={{ mb: 3 }}
              >
                {pages.map((p, i) => (
                  <Step key={p.pageId ?? i}>
                    <StepLabel>{t.text(p.title, `page-${i}`) || `Page ${i + 1}`}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {page.sections.map((section, si) => {
              const sid = section.sectionId ?? `p${currentPage}-s${si}`;
              if (logicState.sections.get(sid) === false) return null;
              return (
                <Box key={sid} sx={{ mb: 3 }}>
                  {section.title && (
                    <Typography variant="h6" component="h2" gutterBottom>
                      {t.text(section.title, sid)}
                    </Typography>
                  )}
                  {section.rows.map((row, ri) => (
                    <Grid container spacing={2} key={row.rowId ?? ri}>
                      {row.columns.map((col, ci) => (
                        <Grid key={col.columnId ?? ci} size={{ xs: 12, md: (col.width ?? 12) as number }}>
                          {col.fields.map((field, fi) => {
                            const fs = logicState.fields.get(field.key);
                            const isStatic = field.type === "header" || field.type === "paragraph";
                            if (!isStatic && fs && !fs.visible) return null;
                            return (
                              <FieldRenderer
                                key={field.id ?? `${field.key}-${fi}`}
                                field={field}
                                revealed={revealedKeys.has(field.key)}
                              />
                            );
                          })}
                        </Grid>
                      ))}
                    </Grid>
                  ))}
                </Box>
              );
            })}

            {!readOnly && (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ mt: 2, justifyContent: "space-between" }}
              >
                {multiPage && currentPage > 0 ? (
                  <Button variant="outlined" onClick={goBack}>
                    {t.ui.previous}
                  </Button>
                ) : (
                  <span />
                )}
                {multiPage && currentPage < pages.length - 1 ? (
                  <Button variant="contained" onClick={goNext}>
                    {t.ui.next}
                  </Button>
                ) : (
                  <Button type="submit" variant="contained">
                    {t.ui.submit}
                  </Button>
                )}
              </Stack>
            )}

            {/* Polite live region for conditional reveals (task 7.11). */}
            <Box
              aria-live="polite"
              sx={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
              }}
            >
              {announcement}
            </Box>
          </Box>
        </FormProvider>
      </OpenFormsProvider>
    </LocalizationProvider>
  );

  return theme ? <ThemeProvider theme={theme}>{inner}</ThemeProvider> : inner;
}
