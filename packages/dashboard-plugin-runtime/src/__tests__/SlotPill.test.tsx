/**
 * SlotPill surface variant — raised (default, sidebar) vs flat (session card).
 * See change: align-session-card-kb-slot-surface.
 */

import { cleanup, render } from "@testing-library/react";
import { mdiDatabaseOutline } from "@mdi/js";
import { afterEach, describe, expect, it } from "vitest";
import { SlotPill } from "../SlotPill.js";

afterEach(cleanup);

function pillRoot(testId: string, extra?: Record<string, unknown>) {
  const { getByTestId } = render(
    <SlotPill glyph={mdiDatabaseOutline} accent="cyan" label="Knowledge base" activateTestId={testId} {...extra}>
      <span>19,397 chunks</span>
    </SlotPill>,
  );
  return getByTestId(testId);
}

describe("SlotPill surface variant", () => {
  it("defaults to the raised sidebar surface (opaque + shadow)", () => {
    const root = pillRoot("pill-default");
    expect(root.className).toContain("bg-[var(--bg-secondary)]");
    expect(root.className).toContain("shadow-[0_1px_2px_var(--shadow-card)]");
  });

  it("surface=\"raised\" matches the default", () => {
    const root = pillRoot("pill-raised", { surface: "raised" });
    expect(root.className).toContain("bg-[var(--bg-secondary)]");
    expect(root.className).toContain("shadow-[0_1px_2px_var(--shadow-card)]");
  });

  it("surface=\"flat\" uses the translucent subcard surface and NO shadow", () => {
    const root = pillRoot("pill-flat", { surface: "flat" });
    expect(root.className).toContain("bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]");
    expect(root.className).not.toMatch(/shadow-/);
    expect(root.className).not.toContain("bg-[var(--bg-secondary)]");
  });

  it("border, radius, and hover-border are identical across variants", () => {
    const raised = pillRoot("pill-r2", { surface: "raised" });
    const flat = pillRoot("pill-f2", { surface: "flat" });
    for (const token of ["border-[var(--border-subtle)]", "rounded-[11px]", "hover:border-cyan-500/45"]) {
      expect(raised.className).toContain(token);
      expect(flat.className).toContain(token);
    }
  });
});
