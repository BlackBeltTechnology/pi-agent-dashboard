/**
 * E12 — every declared UI primitive key (incl. `ui:path-picker`) is registered
 * at client startup in main.tsx. See change: improve-kb-settings-sources-and-search.
 */
import fs from "node:fs";
import path from "node:path";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { describe, expect, it } from "vitest";

describe("main.tsx primitive registrations", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../main.tsx"), "utf-8");

  it("declares ui:path-picker", () => {
    expect(UI_PRIMITIVE_KEYS.pathPicker).toBe("ui:path-picker");
  });

  it("registers every UI_PRIMITIVE_KEYS entry", () => {
    const missing = Object.keys(UI_PRIMITIVE_KEYS).filter(
      (k) => !new RegExp(`UI_PRIMITIVE_KEYS\\.${k}\\b`).test(main),
    );
    expect(missing).toEqual([]);
  });
});
