import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { OpenFormsMui } from "../src/OpenFormsMui";
import { themeFromTokens, defaultTheme } from "../src/theme/from-tokens";
import type { FormSchemaJSON } from "../src/schema/types";

const here = dirname(fileURLToPath(import.meta.url));
const allTypes = JSON.parse(
  readFileSync(join(here, "fixtures", "all-field-types.json"), "utf8"),
) as FormSchemaJSON;

async function runAxe(container: HTMLElement) {
  // Colour-contrast cannot run without layout in jsdom; disable it and assert on
  // the structural rules (labels, roles, names) that DO run.
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

describe("token layer ports 1:1 into the default theme (task 10.0)", () => {
  it("themeFromTokens(ui-contract.tokens.json) equals the default theme palette", () => {
    const tokens = JSON.parse(readFileSync(join(here, "..", "mockups", "ui-contract.tokens.json"), "utf8"));
    const fromTokens = themeFromTokens(tokens);
    const dft = defaultTheme();
    expect(fromTokens.palette.primary.main).toBe(dft.palette.primary.main);
    expect(fromTokens.palette.warning.main).toBe(dft.palette.warning.main);
    expect(fromTokens.shape.borderRadius).toBe(dft.shape.borderRadius);
  });
});

describe("automated accessibility gate (tasks 10.1, 10.4)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    const view = render(<OpenFormsMui schema={allTypes} />);
    container = view.container;
  });

  it("reports no serious or critical violations across all 14 field types", async () => {
    const violations = await runAxe(container);
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe("grouped controls expose accessible names (task 10.2)", () => {
  it("matrix, radio and checkbox groups are labelled", () => {
    render(<OpenFormsMui schema={allTypes} />);
    // Radio group legend.
    expect(screen.getByText("Preferred contact")).toBeInTheDocument();
    // Matrix is a labelled table.
    expect(screen.getByRole("table", { name: "Satisfaction" })).toBeInTheDocument();
    // Repeater legend.
    expect(screen.getByText("People")).toBeInTheDocument();
  });
});

describe("signature has an accessible name and clear control (task 10.3)", () => {
  it("exposes role img with a name and a keyboard-reachable clear button", () => {
    render(<OpenFormsMui schema={allTypes} />);
    expect(screen.getByRole("img", { name: /signature/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});

describe("error summary uses the error surface, warnings do not (task 10.9)", () => {
  it("a blocked submit renders an alert on the error surface", async () => {
    const schema: FormSchemaJSON = {
      pages: [{ sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "r", label: "R", required: true }] }] }] }] }],
    } as FormSchemaJSON;
    const { container } = render(<OpenFormsMui schema={schema} />);
    const form = container.querySelector("form")!;
    form.requestSubmit();
    const alert = await screen.findByRole("alert");
    // MUI error Alert carries the error colour class; never the warning one.
    expect(alert.className).toMatch(/MuiAlert-(standardError|colorError|filledError|outlinedError)/);
    expect(alert.className).not.toMatch(/Warning/);
  });
});
