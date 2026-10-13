/**
 * `packages/client/src/index.css` carries one `@source` line per client-bearing
 * plugin package whose classes the client must compile. The hermes-memory and
 * kb plugins render token classes (severity pills, focus ring) only through
 * Tailwind arbitrary values, so a missing line silently drops their styles
 * (test-plan #E25).
 *
 * See change: retro-ux-plugin-settings-forms (design D2 risk).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

describe("index.css @source coverage (E25)", () => {
  it.each(["hermes-memory-plugin", "kb-plugin"])("has an @source line for %s/src/client", (pkg) => {
    expect(css).toContain(`@source "../../${pkg}/src/client";`);
  });
});
