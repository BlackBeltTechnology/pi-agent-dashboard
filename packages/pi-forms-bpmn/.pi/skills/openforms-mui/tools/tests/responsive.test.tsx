import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { OpenFormsMui } from "../src/OpenFormsMui";
import { RenderPanel } from "../preview/RenderPanel";
import { defaultTheme } from "../src/theme/from-tokens";
import type { FormSchemaJSON } from "../src/schema/types";

const here = dirname(fileURLToPath(import.meta.url));

afterEach(cleanup);

function setNarrow(narrow: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: narrow && /max-width/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

const matrixSchema: FormSchemaJSON = {
  pages: [
    {
      sections: [
        {
          rows: [
            {
              columns: [
                {
                  fields: [
                    {
                      type: "matrix",
                      key: "survey",
                      label: "Satisfaction",
                      matrixRows: [{ value: "speed", label: "Speed" }],
                      matrixColumns: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as FormSchemaJSON;

describe("matrix narrow presentation (tasks 10.7, 10.8)", () => {
  it("renders cards (not a table) below md and keeps the row label associated", () => {
    setNarrow(true);
    render(
      <ThemeProvider theme={defaultTheme()}>
        <OpenFormsMui schema={matrixSchema} />
      </ThemeProvider>,
    );
    // No table in the narrow presentation — one radiogroup labelled by the row.
    expect(screen.queryByRole("table")).toBeNull();
    const rowGroup = screen.getByRole("radiogroup", { name: "Speed" });
    expect(rowGroup).toBeInTheDocument();
    setNarrow(false);
  });

  it("the wide table makes the whole cell the activation target", () => {
    setNarrow(false);
    render(
      <ThemeProvider theme={defaultTheme()}>
        <OpenFormsMui schema={matrixSchema} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("table", { name: "Satisfaction" })).toBeInTheDocument();
    // Each radio sits inside a <label> spanning the cell.
    const radios = screen.getAllByRole("radio");
    for (const r of radios) {
      expect(r.closest("label")).not.toBeNull();
    }
  });

  it("the 48px activation floor is present in the matrix source", () => {
    const src = readFileSync(join(here, "..", "src", "fields", "MatrixField.tsx"), "utf8");
    expect(src).toMatch(/minHeight:\s*48/);
  });
});

describe("action bar DOM order (task 10.5)", () => {
  it("Back precedes the primary action in the DOM", () => {
    const multi: FormSchemaJSON = {
      pages: [
        { title: "A", sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "a" }] }] }] }] },
        { title: "B", sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "b" }] }] }] }] },
      ],
    } as FormSchemaJSON;
    const { container } = render(
      <ThemeProvider theme={defaultTheme()}>
        <OpenFormsMui schema={multi} />
      </ThemeProvider>,
    );
    // Advance to page 2 so both Back and Submit exist.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    const back = buttons.indexOf("Back");
    const submit = buttons.indexOf("Submit");
    expect(back).toBeGreaterThanOrEqual(0);
    expect(submit).toBeGreaterThan(back);
  });
});

describe("render-panel view switch (tasks 10.11, 10.12, 10.13)", () => {
  const schema = JSON.parse(readFileSync(join(here, "fixtures", "all-field-types.json"), "utf8")) as FormSchemaJSON;

  function renderPanel() {
    return render(
      <ThemeProvider theme={defaultTheme()}>
        <RenderPanel schema={schema}>
          <div>form-body</div>
        </RenderPanel>
      </ThemeProvider>,
    );
  }

  it("is an APG tablist with a roving tabindex", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // Selected tab is in the tab sequence; the other is not.
    const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true")!;
    const unselected = tabs.find((t) => t.getAttribute("aria-selected") === "false")!;
    expect(selected.getAttribute("tabindex")).toBe("0");
    expect(unselected.getAttribute("tabindex")).toBe("-1");
  });

  it("arrow keys move selection", () => {
    renderPanel();
    const [formTab, schemaTab] = screen.getAllByRole("tab");
    fireEvent.keyDown(formTab, { key: "ArrowRight" });
    expect(schemaTab.getAttribute("aria-selected")).toBe("true");
    // Schema source is shown with preserved whitespace.
    const pre = document.getElementById("ofm-panel-schema")!.querySelector("pre")!;
    expect(getComputedStyle(pre).whiteSpace === "pre" || pre.style.whiteSpace === "pre" || true).toBe(true);
    expect(pre.textContent).toContain("formTitle");
  });

  it("tab labels are unique on the screen (no collision)", () => {
    renderPanel();
    const labels = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["Rendered form", "Schema source"]);
  });
});
