/**
 * `composer-dock-process-group` consumption by the dock: summary mounts add no
 * DOM, counts reach the header, a dropped/throwing claim vanishes from the count.
 * Test-plan #F7 #F8 #X6. See change: add-composer-dock (task 3.2, design D4).
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerDock } from "../ComposerDock.js";
import { addFakeGroup, bash, makeSession, proc, renderDock, type SlotRegistry } from "./dock-harness.js";

afterEach(cleanup);

const dock = () => screen.getByTestId("composer-dock");
const header = () => screen.getByRole("group", { name: "Processes" });
const toggle = () => dock().querySelector<HTMLButtonElement>('[data-dock-toggle="processes"]') as HTMLButtonElement;

describe("summary-mode claim", () => {
  it("F7: a claim reporting {count:2,noun:'subagents'} adds 0 DOM nodes while collapsed; the header names 2 subagents", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 2, noun: "subagents" } });
    const { container } = renderDock({ session: makeSession(), registry });
    expect(header().textContent).toContain("2 subagents");
    // The always-mounted summary instance adds no node beside the dock, and the
    // collapsed lane has no body, so no claim-rendered node exists anywhere.
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(dock());
    expect(screen.queryByTestId("claim-row")).toBeNull();
    expect(dock().querySelector("[id$='-body']")).toBeNull();
  });

  it("summary mode alone renders no DOM (no dock) while the claim reports nothing", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: null });
    const { container } = renderDock({ session: makeSession(), registry });
    expect(container.innerHTML).toBe("");
  });

  it("the rows instance mounts only while the lane body is shown, and its report is ignored", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 2, noun: "subagents" } });
    renderDock({ session: makeSession(), registry });
    expect(screen.queryByTestId("claim-row")).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getAllByTestId("claim-row")).toHaveLength(1);
    // Counted once (summary instance), not twice (rows instance).
    expect(header().textContent).toContain("2 subagents");
    expect(header().textContent).not.toContain("4");
    fireEvent.click(toggle());
    expect(screen.queryByTestId("claim-row")).toBeNull();
  });

  it("counts of several claims are summed into the header", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { pluginId: "a-plugin", report: { count: 2, noun: "subagents" } });
    addFakeGroup(registry, { pluginId: "b-plugin", report: { count: 1, noun: "jobs" } });
    renderDock({ session: makeSession(), registry });
    expect(header().textContent).toContain("3 running");
    expect(header().textContent).toContain("2 subagents · 1 jobs");
  });

  it("F8: unmounting the claim drops its count; the lane is gone when nothing else runs", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 3, noun: "subagents" } });
    const session = makeSession();
    const { rerenderDock } = renderDock({ session, registry });
    expect(header().textContent).toContain("3 subagents");
    // Disable the plugin: a registry without the claim.
    rerenderDock({ session, registry: createSlotRegistry() });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });

  it("F8b: with other work running, only the claim's count leaves the header", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 3, noun: "subagents" } });
    const session = makeSession({ processes: [proc(1)] });
    const { rerenderDock } = renderDock({ session, registry });
    expect(header().textContent).toContain("4 running");
    rerenderDock({ session, registry: createSlotRegistry() });
    expect(header().textContent).toContain("1 background process");
    expect(header().textContent).not.toContain("subagents");
  });

  it("a session switch drops the previous session's count until the claim reports for the new one", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 2, noun: "subagents" } });
    const { rerenderDock } = renderDock({ session: makeSession({ id: "s1" }), registry });
    expect(header().textContent).toContain("2 subagents");
    rerenderDock({ session: makeSession({ id: "s2" }), registry });
    expect(header().textContent).toContain("2 subagents");
    rerenderDock({ session: undefined, registry });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });
});

describe("a throwing claim (X6)", () => {
  function setup(): SlotRegistry {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { pluginId: "boom-plugin", throws: true });
    return registry;
  }

  it("X6: summary and rows both throw: logged by the boundary, count absent, core groups still render", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = setup();
    renderDock({
      session: makeSession({ processes: [proc(1), proc(2)] }),
      processes: { commands: [bash("t1")], onKill: vi.fn() },
      registry,
    });
    expect(spy.mock.calls.some((c) => c.join(" ").includes("[slot-error-boundary]") && c.join(" ").includes("boom-plugin"))).toBe(true);
    expect(header().textContent).toContain("3 running");
    expect(header().textContent).toContain("1 command · 2 background");
    expect(header().textContent).not.toContain("subagents");
    fireEvent.click(toggle());
    const headings = screen.getAllByTestId("composer-dock-group-heading").map((h) => h.textContent);
    expect(headings).toEqual(["Commands", "Background"]);
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(3);
    spy.mockRestore();
  });

  it("a throwing claim alone leaves no dock", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderDock({ session: makeSession(), registry: setup() });
    expect(container.innerHTML).toBe("");
    spy.mockRestore();
  });
});

describe("without a registry", () => {
  it("renders the core lane when no plugin runtime provider is mounted", () => {
    render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <ComposerDock
          session={makeSession({ processes: [proc(1)] })}
          cwd="/repo"
          openLane={null}
          onOpenLaneChange={() => {}}
        />
      </PluginContextProvider>,
    );
    expect(header().textContent).toContain("1 background process");
  });
});
