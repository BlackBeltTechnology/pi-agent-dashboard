/**
 * SlotPill surface variant — raised (default, sidebar) vs flat (session card).
 * See change: align-session-card-kb-slot-surface.
 */

import { mdiDatabaseOutline } from "@mdi/js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("surface=\"flat\" has NO fill and NO shadow (border only)", () => {
    const root = pillRoot("pill-flat", { surface: "flat" });
    expect(root.className).not.toContain("bg-[");
    expect(root.className).not.toMatch(/shadow-/);
    expect(root.className).not.toContain("bg-[var(--bg-secondary)]");
  });

  it("E1: the pill exposes zero interactive elements other than its own root", () => {
    const root = pillRoot("pill-state-only");
    const nested = root.querySelectorAll(
      "button, a, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
    );
    expect(Array.from(nested).filter((n) => n !== root)).toEqual([]);
  });

  it("E2: the pill renders no action glyph \u2014 it holds one glyph, its own", () => {
    const root = pillRoot("pill-one-glyph");
    expect(root.querySelectorAll("svg")).toHaveLength(1);
  });

  it("F6: the pill is a single control \u2014 Enter on the root fires its navigation", () => {
    const onActivate = vi.fn();
    const root = pillRoot("pill-single-control", { onActivate });
    root.focus();
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("X1: passing `actions` is a COMPILE-TIME break \u2014 no runtime shim accepts it", () => {
    const { getByTestId } = render(
      <SlotPill
        glyph={mdiDatabaseOutline}
        accent="cyan"
        label="Knowledge base"
        activateTestId="pill-no-actions"
        // @ts-expect-error `actions` was removed; plugins contribute declarative
        // folder-actions-menu items instead. If this stops erroring, the prop
        // (or a shim for it) has come back.
        actions={<button type="button" data-testid="smuggled">smuggled</button>}
      >
        <span>19,397 chunks</span>
      </SlotPill>,
    );
    expect(getByTestId("pill-no-actions").querySelector("[data-testid='smuggled']")).toBeNull();
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
