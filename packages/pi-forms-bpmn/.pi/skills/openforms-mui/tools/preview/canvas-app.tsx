/**
 * Standalone canvas entry: renders the demo OpenForms schema as a self-contained
 * static bundle (relative base) so it works inside the dashboard live-server
 * proxy (/live/<id>/) sandboxed iframe. Schema is imported statically — no
 * runtime fetch of an absolute path.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { ThemeProvider } from "@mui/material/styles";
import { OpenFormsMui } from "../src/OpenFormsMui.js";
import { normalizeSchema } from "../src/schema/normalize.js";
import { defaultTheme } from "../src/theme/from-tokens.js";
import type { FormAnswers } from "../src/schema/types.js";
import rawSchema from "../demo-schema.json";

const schema = normalizeSchema(rawSchema as never).schema;

function App() {
  const [answers, setAnswers] = useState<FormAnswers>({});
  return (
    <Box sx={{ minHeight: "100%", bgcolor: "background.default", py: 4 }}>
      <Container maxWidth="md">
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 } }}>
          <OpenFormsMui
            schema={schema}
            answers={answers}
            onFieldChange={setAnswers}
            onSubmit={(a) => setAnswers(a)}
          />
        </Paper>
        <Divider sx={{ my: 3 }} />
        <Typography variant="overline" color="text.secondary">
          élő answers állapot
        </Typography>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2,
            borderRadius: 1,
            bgcolor: "grey.100",
            fontSize: 12,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(answers, null, 2)}
        </Box>
      </Container>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={defaultTheme()}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
