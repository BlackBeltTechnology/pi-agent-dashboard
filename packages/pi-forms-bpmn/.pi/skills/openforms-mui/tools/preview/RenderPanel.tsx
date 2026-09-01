import type { JSX, ReactNode } from "react";
import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import type { FormSchemaJSON } from "../src/schema/types.js";

type View = "form" | "schema";
const VIEWS: { id: View; label: string }[] = [
  { id: "form", label: "Rendered form" },
  { id: "schema", label: "Schema source" },
];

/**
 * Wraps the rendered form with an APG tablist view switch (rendered form ↔
 * schema source): roving tabindex, arrow-key navigation, and only the selected
 * tab in the tab sequence. The schema source keeps its indentation and confines
 * horizontal scrolling to its own block. Tab labels are scoped ("Rendered form"
 * / "Schema source") so they cannot collide with surrounding navigation.
 */
export function RenderPanel({ schema, children }: { schema: FormSchemaJSON; children: ReactNode }): JSX.Element {
  const [view, setView] = useState<View>("form");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + dir + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box role="tablist" aria-label="Render panel view" sx={{ display: "flex", gap: 1, mb: 1 }}>
        {VIEWS.map((v, i) => {
          const selected = view === v.id;
          return (
            <Box
              key={v.id}
              component="button"
              type="button"
              role="tab"
              id={`ofm-tab-${v.id}`}
              aria-selected={selected}
              aria-controls={`ofm-panel-${v.id}`}
              tabIndex={selected ? 0 : -1}
              ref={(el: HTMLButtonElement | null) => {
                tabRefs.current[i] = el;
              }}
              onClick={() => setView(v.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              sx={{
                px: 1.5,
                py: 0.5,
                border: 1,
                borderColor: selected ? "primary.main" : "divider",
                bgcolor: selected ? "primary.main" : "background.paper",
                color: selected ? "primary.contrastText" : "text.primary",
                borderRadius: 1,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {v.label}
            </Box>
          );
        })}
      </Box>

      <Box
        role="tabpanel"
        id="ofm-panel-form"
        aria-labelledby="ofm-tab-form"
        hidden={view !== "form"}
        sx={{ flex: 1, minHeight: 0, overflow: "auto", display: view === "form" ? "block" : "none" }}
      >
        {children}
      </Box>

      <Box
        role="tabpanel"
        id="ofm-panel-schema"
        aria-labelledby="ofm-tab-schema"
        hidden={view !== "schema"}
        sx={{ flex: 1, minHeight: 0, display: view === "schema" ? "block" : "none" }}
      >
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            fontSize: 12,
            whiteSpace: "pre", // preserve indentation; do not reflow
            overflow: "auto", // horizontal scroll confined to this block
            height: "100%",
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
          {JSON.stringify(schema, null, 2)}
        </Box>
      </Box>
    </Box>
  );
}
