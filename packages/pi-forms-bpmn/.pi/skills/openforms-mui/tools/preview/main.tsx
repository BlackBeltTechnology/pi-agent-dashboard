import type { JSX } from "react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Chip from "@mui/material/Chip";
import { ThemeProvider } from "@mui/material/styles";
import { OpenFormsMui } from "../src/OpenFormsMui.js";
import { normalizeSchema } from "../src/schema/normalize.js";
import { diagnose } from "../src/schema/diagnose.js";
import { resolveFormState, explainRules } from "../src/logic/state.js";
import { deriveZodSchema } from "../src/validation/zod-from-schema.js";
import { defaultTheme } from "../src/theme/from-tokens.js";
import { UPSTREAM_PROVENANCE } from "../src/provenance.js";
import type { FormAnswers, FormSchemaJSON } from "../src/schema/types.js";
import { RenderPanel } from "./RenderPanel.js";

const WIDTHS = { mobile: 375, tablet: 768, desktop: 1440 } as const;
type WidthKey = keyof typeof WIDTHS;

declare global {
  interface Window {
    __OFM_REFERENCE__?: boolean;
  }
}

function Harness(): JSX.Element {
  const [schema, setSchema] = useState<FormSchemaJSON | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [width, setWidth] = useState<WidthKey>("desktop");
  const reference = window.__OFM_REFERENCE__ === true;

  const load = useCallback(async () => {
    const res = await fetch("/__schema.json");
    const raw = await res.json();
    setSchema(normalizeSchema(raw).schema);
  }, []);

  useEffect(() => {
    void load();
    // Live reload on schema change, preserving current answers.
    const hot = (import.meta as unknown as { hot?: { on(e: string, cb: () => void): void } }).hot;
    hot?.on("ofm:schema-changed", () => void load());
  }, [load]);

  const findings = useMemo(() => (schema ? diagnose(schema) : []), [schema]);
  const logicState = useMemo(() => (schema ? resolveFormState(schema, answers) : null), [schema, answers]);
  const validationErrors = useMemo(() => {
    if (!schema || !logicState) return [];
    const res = deriveZodSchema(schema, logicState).safeParse(logicState.effectiveAnswers);
    return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".") || "(form)"}: ${i.message}`);
  }, [schema, logicState]);
  const ruleExplanations = useMemo(
    () => (schema ? explainRules(schema, answers) : []),
    [schema, answers],
  );

  if (!schema) return <Box sx={{ p: 4 }}>Loading schema…</Box>;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          alignItems: "center",
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mr: 2 }}>
          OpenForms MUI Preview
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={width}
          onChange={(_e, v: WidthKey | null) => v && setWidth(v)}
          aria-label="Inspection width"
        >
          {(Object.keys(WIDTHS) as WidthKey[]).map((k) => (
            <ToggleButton key={k} value={k} aria-label={k}>
              {k} · {WIDTHS[k]}px
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          color={findings.some((f) => f.severity === "error") ? "error" : "default"}
          label={`${findings.length} finding${findings.length === 1 ? "" : "s"}`}
        />
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gap: 1,
          p: 1,
          gridTemplateColumns: { xs: "1fr", lg: reference ? "1fr 1fr 22rem 22rem" : "1fr 22rem 22rem" },
          gridAutoRows: { xs: "auto", lg: "1fr" },
          overflow: "auto",
        }}
      >
        {/* Panel 1: rendered form / schema source view switch */}
        <Panel title="Render">
          <Box sx={{ mx: "auto", width: "100%", maxWidth: WIDTHS[width], transition: "max-width .2s" }}>
            <RenderPanel schema={schema}>
              <OpenFormsMui
                schema={schema}
                answers={answers}
                onFieldChange={setAnswers}
                onSubmit={(a) => setAnswers(a)}
              />
            </RenderPanel>
          </Box>
        </Panel>

        {reference && (
          <Panel title={`Reference (upstream ${UPSTREAM_PROVENANCE.version})`}>
            <ReferenceFrame schema={schema} answers={answers} />
          </Panel>
        )}

        {/* Panel 2: live answers + validation errors */}
        <Panel title="Answers & validation">
          <Box sx={{ overflow: "auto" }}>
            <Typography variant="overline">answers</Typography>
            <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: "pre", overflowX: "auto" }}>
              {JSON.stringify(answers, null, 2)}
            </Box>
            <Typography variant="overline" sx={{ mt: 2, display: "block" }}>
              validation errors
            </Typography>
            {validationErrors.length === 0 ? (
              <Typography variant="body2" color="success.main">
                none
              </Typography>
            ) : (
              validationErrors.map((e, i) => (
                <Typography key={i} variant="body2" color="error.main">
                  {e}
                </Typography>
              ))
            )}
          </Box>
        </Panel>

        {/* Panel 3: CNF rule debug */}
        <Panel title="Rule debug">
          <Box sx={{ overflow: "auto" }}>
            {ruleExplanations.length === 0 && <Typography variant="body2">No rules.</Typography>}
            {ruleExplanations.map((r, i) => (
              <Box key={i} sx={{ mb: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.kind} · {r.ownerKey} → {r.evaluation.satisfied ? "satisfied" : "not satisfied"}
                </Typography>
                {r.evaluation.groups.map((g, gi) => (
                  <Box key={gi} sx={{ pl: 1 }}>
                    {g.conditions.map((c, ci) => (
                      <Typography key={ci} variant="caption" sx={{ display: "block", fontFamily: "monospace" }}>
                        {c.condition.dependentFieldKey} {c.resolvedOperator}{" "}
                        {JSON.stringify(c.rightValue)} ⟶ left={JSON.stringify(c.leftValue)} ={" "}
                        {String(c.satisfied)}
                      </Typography>
                    ))}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minHeight: 0, height: { lg: "100%" }, display: "flex", flexDirection: "column" }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Paper>
  );
}

/** Reference frame: loads the pinned upstream vanilla renderer in isolation. */
function ReferenceFrame({ schema, answers }: { schema: FormSchemaJSON; answers: FormAnswers }): JSX.Element {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const srcdoc = useMemo(() => {
    const src = `${UPSTREAM_PROVENANCE.referenceCdnBase}/src/renderer.js`;
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="ref"></div>
<script src="${src}"></script>
<script>
  try {
    var schema = ${JSON.stringify(schema)};
    var answers = ${JSON.stringify(answers)};
    if (window.OpenFormRenderer) {
      var r = new window.OpenFormRenderer(schema, {});
      r.render(document.getElementById('ref'), answers, false);
    } else {
      document.getElementById('ref').textContent = 'Upstream renderer global not found.';
    }
  } catch (e) { document.getElementById('ref').textContent = String(e); }
</script></body></html>`;
  }, [schema, answers]);
  return <Box component="iframe" ref={ref} title="reference" srcDoc={srcdoc} sx={{ width: "100%", height: "100%", border: 0 }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={defaultTheme()}>
      <CssBaseline />
      <Harness />
    </ThemeProvider>
  </StrictMode>,
);
