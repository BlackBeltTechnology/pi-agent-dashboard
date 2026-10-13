/**
 * The field family sits below the client: it must not import from
 * `packages/client` or `client-utils` (test-plan #E7).
 * See change: retro-ux-plugin-settings-forms.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings-fields.tsx import boundary (#E7)", () => {
  it("imports nothing from the client packages", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "settings-fields.tsx"), "utf8");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/packages\/client|pi-dashboard-client-utils|pi-dashboard-web|\.\.\/client/);
    }
  });
});
