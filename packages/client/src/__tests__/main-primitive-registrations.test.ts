/**
 * E12 — every declared UI primitive key (incl. `ui:path-picker`) is registered
 * at client startup in main.tsx. See change: improve-kb-settings-sources-and-search.
 */
import fs from "node:fs";
import type React from "react";
import path from "node:path";
import type { UiModelSelectorProps, UiPrimitiveMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
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

  // E30: `allowRoles` is part of the ui:model-selector contract (compile-time).
  // The legacy three-prop call site must keep compiling. See change: add-role-aware-model-refs.
  it("ui:model-selector props accept allowRoles, legacy call site unchanged", () => {
    const legacy: UiModelSelectorProps = { current: "a/b", onSelect: () => {} };
    const withRoles: UiModelSelectorProps = { ...legacy, allowRoles: true };
    const viaMap: React.ComponentProps<UiPrimitiveMap["ui:model-selector"]> = withRoles;
    expect(viaMap.allowRoles).toBe(true);
    expect(legacy.allowRoles).toBeUndefined();
  });
});
