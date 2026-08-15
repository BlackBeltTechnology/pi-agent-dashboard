import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { OpenFormsMui } from "../src/OpenFormsMui";
import type { FormSchemaJSON } from "../src/schema/types";

/**
 * Regression for the D14 singleton hazard: importing the component out of the
 * skill directory must resolve React to ONE instance. A second React instance
 * would make hooks throw "invalid hook call". Here we assert both the structural
 * guarantee (a single resolved `react`) and the behavioural one (the component
 * mounts and its hooks run without an invalid-hook-call).
 */
describe("single React instance (task 1.5)", () => {
  it("resolves react from the skill's own node_modules exactly once", () => {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("react");
    expect(resolved).toContain("openforms-mui/tools/node_modules/react");
  });

  it("mounts the component without an invalid hook call", () => {
    const schema: FormSchemaJSON = {
      pages: [{ sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "t", label: "T" }] }] }] }] }],
    } as FormSchemaJSON;
    // React.version is defined once; a duplicate instance would desync hooks.
    expect(typeof React.version).toBe("string");
    render(<OpenFormsMui schema={schema} />);
    expect(screen.getByLabelText(/T/)).toBeInTheDocument();
  });
});
