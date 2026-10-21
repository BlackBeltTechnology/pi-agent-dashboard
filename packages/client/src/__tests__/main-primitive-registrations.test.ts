/**
 * E12 — every declared UI primitive key (incl. `ui:path-picker`) is registered
 * at client startup: main.tsx builds its registry with `createHostPrimitiveRegistry()`,
 * which registers every `UI_PRIMITIVE_KEYS` entry (incl. `ui:chat-view`,
 * `ui:elapsed-badge`). See changes: improve-kb-settings-sources-and-search,
 * decouple-plugins-from-core (test-plan #E31).
 */
import fs from "node:fs";
import path from "node:path";
import type { UiModelSelectorProps, UiPrimitiveMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { describe, expect, it } from "vitest";
import { createHostPrimitiveRegistry } from "../lib/plugins/host-primitives.js";

/**
 * @structural-pin main.tsx renders the whole app on import, so its wiring can only be checked in its text
 */
describe("main.tsx primitive registrations", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../main.tsx"), "utf-8");

  it("declares ui:path-picker", () => {
    expect(UI_PRIMITIVE_KEYS.pathPicker).toBe("ui:path-picker");
  });

  it("main.tsx builds the app registry with createHostPrimitiveRegistry()", () => {
    expect(main).toMatch(/const primitiveRegistry = createHostPrimitiveRegistry\(\)/);
  });

  it("the factory registers every UI_PRIMITIVE_KEYS entry, incl. chat-view and elapsed-badge", () => {
    const registry = createHostPrimitiveRegistry();
    // `_impls` is the registry's @internal map; a test may read it to compare key sets.
    expect([...registry._impls.keys()].sort()).toEqual(Object.values(UI_PRIMITIVE_KEYS).sort());
    expect(UI_PRIMITIVE_KEYS.chatView).toBe("ui:chat-view");
    expect(UI_PRIMITIVE_KEYS.elapsedBadge).toBe("ui:elapsed-badge");
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
