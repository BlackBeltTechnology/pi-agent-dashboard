/**
 * `ResourcePageSectionSlot` — page filtering, surface props, isolation
 * (test-plan #E24, #X12). See change: add-skill-atlas-screen.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginContextProvider } from "../plugin-context.js";
import { createSlotRegistry } from "../slot-registry.js";
import { ResourcePageSectionSlot } from "../slot-consumers.js";

afterEach(cleanup);

type P = { resourceType: string; scope: string; cwd?: string };
const Probe = (id: string) => (p: P) => (
  <span data-testid={id}>{`${p.resourceType}|${p.scope}|${p.cwd ?? "-"}`}</span>
);

function registry(extra?: (r: ReturnType<typeof createSlotRegistry>) => void) {
  const r = createSlotRegistry();
  r.addClaim({ pluginId: "atlas", priority: 100, slot: "resource-page-section", resourceType: "skill", Component: Probe("skill-only") });
  r.addClaim({ pluginId: "any", priority: 200, slot: "resource-page-section", Component: Probe("untyped") });
  extra?.(r);
  return r;
}

describe("ResourcePageSectionSlot (#E24)", () => {
  it("skill-typed claim renders on the Skills page with folder props", () => {
    render(
      <PluginContextProvider registry={registry()}>
        <ResourcePageSectionSlot resourceType="skill" scope="folder" cwd="/repo" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("skill-only").textContent).toBe("skill|folder|/repo");
    expect(screen.getByTestId("untyped").textContent).toBe("skill|folder|/repo");
  });

  it("skill-typed claim is absent on the Agents page; untyped renders", () => {
    render(
      <PluginContextProvider registry={registry()}>
        <ResourcePageSectionSlot resourceType="agent" scope="folder" cwd="/repo" />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("skill-only")).toBeNull();
    expect(screen.getByTestId("untyped")).toBeDefined();
  });

  it("global surface never passes cwd", () => {
    render(
      <PluginContextProvider registry={registry()}>
        <ResourcePageSectionSlot resourceType="skill" scope="global" cwd="/leak" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("skill-only").textContent).toBe("skill|global|-");
  });

  it("renders nothing without claims", () => {
    const { container } = render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <ResourcePageSectionSlot resourceType="skill" scope="global" />
      </PluginContextProvider>,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("throwing section is isolated (#X12)", () => {
  it("a throwing claim does not hide sibling sections", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = registry((reg) =>
      reg.addClaim({
        pluginId: "bad",
        priority: 50,
        slot: "resource-page-section",
        Component: () => {
          throw new Error("boom");
        },
      }),
    );
    render(
      <PluginContextProvider registry={r}>
        <ResourcePageSectionSlot resourceType="skill" scope="folder" cwd="/repo" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("skill-only")).toBeDefined();
    expect(screen.getByTestId("untyped")).toBeDefined();
    err.mockRestore();
  });
});
