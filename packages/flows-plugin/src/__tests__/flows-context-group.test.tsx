/**
 * FLOWS dock chip (`composer-context-group` claim): renders only with a
 * non-empty catalog (independent of commandsList), disables Run / Open while a
 * flow runs, and names the open or last flow with a text status pill.
 * See change: flows-dock-chip-and-panel-actions (test-plan E19–E21).
 */
import { initPluginConfigs, publishSessionData, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveChipFlow, FlowsContextGroup } from "../client/FlowsContextGroup.js";
import { __resetFlowAttachStoreForTests, setAttachment } from "../client/flow-attach-store.js";
import { useIsolatedLocalStorage, completed, editMode, entry, ev, fetchMock, publishCatalog, started, tree } from "./flows-test-harness.js";

useIsolatedLocalStorage();

beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
  initPluginConfigs({ flows: {} });
  editMode.served = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const nextSid = () => `chip-S-${++n}`;
const renderChip = (sid: string) => render(tree(<FlowsContextGroup session={{ id: sid } as DashboardSession} />, vi.fn()));
const chip = () => screen.queryByTestId("flows-context-group");
const btn = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

describe("chip gate (E19)", () => {
  for (const catalog of ["unknown", "empty", "[x]"] as const) {
    for (const commands of ["absent", "has flows"] as const) {
      it(`catalog ${catalog} × commandsList ${commands} → ${catalog === "[x]" ? "chip" : "nothing"}`, () => {
        const sid = nextSid();
        if (commands === "has flows") publishSessionData(sid, "commandsList", [{ name: "flows" }]);
        if (catalog === "empty") publishCatalog(sid, []);
        if (catalog === "[x]") publishCatalog(sid, [entry("x")]);
        const { container } = renderChip(sid);
        if (catalog === "[x]") {
          expect(chip()).toBeTruthy();
          expect(container.textContent).toContain("FLOWS");
        } else {
          expect(container.innerHTML).toBe("");
        }
      });
    }
  }
});

describe("actions while a flow runs (E20)", () => {
  it("running → Run and Open disabled with the reason, Edit enabled", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("x")]);
    publishSessionEvents(sid, [started("x", 10)]);
    renderChip(sid);
    for (const id of ["flows-chip-run", "flows-chip-open"]) {
      expect(btn(id).disabled).toBe(true);
      expect(btn(id).title).toBe("A flow is running");
    }
    expect(btn("flows-chip-edit-button").disabled).toBe(false);
  });

  it("not running → all enabled, each with an accessible name", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("x")]);
    renderChip(sid);
    expect(btn("flows-chip-run").disabled).toBe(false);
    expect(btn("flows-chip-open").disabled).toBe(false);
    expect(btn("flows-chip-edit-button").disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Run flow…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open flow…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit…" })).toBeTruthy();
  });
});

describe("status pill (E21)", () => {
  const pill = () => screen.queryByTestId("flows-chip-status")?.textContent ?? null;
  const name = () => screen.queryByTestId("flows-chip-name")?.textContent ?? null;
  const agentDone = (flowName: string, step: number, ts: number) =>
    ev("flow_agent_complete", ts, { flowName, agentName: `a${step}`, stepId: `s${step}`, result: {} });

  it("running 7/19", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("batch:apply")]);
    publishSessionEvents(sid, [started("batch:apply", 10, 19), ...Array.from({ length: 7 }, (_, i) => agentDone("batch:apply", i, 11 + i))]);
    renderChip(sid);
    expect(name()).toBe("batch:apply");
    expect(pill()).toBe("running 7/19");
  });

  it("failed · 19 steps", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("batch:apply")]);
    publishSessionEvents(sid, [started("batch:apply", 10, 19), completed("batch:apply", 20, "error")]);
    renderChip(sid);
    expect(pill()).toBe("failed · 19 steps");
  });

  it("done / aborted", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("a")]);
    publishSessionEvents(sid, [started("a", 10), completed("a", 20, "success")]);
    renderChip(sid);
    expect(pill()).toBe("done");
    cleanup();
    const sid2 = nextSid();
    publishCatalog(sid2, [entry("a")]);
    publishSessionEvents(sid2, [started("a", 10), completed("a", 20, "aborted")]);
    renderChip(sid2);
    expect(pill()).toBe("aborted");
  });

  it("attached, not started", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("ship-it")]);
    act(() => setAttachment(sid, { id: "att", name: "ship-it", source: "/p/ship-it/flow.yaml", baselineStartedAt: 0 }));
    renderChip(sid);
    expect(name()).toBe("ship-it");
    expect(pill()).toBe("not started");
  });

  it("none → no name or pill, actions only", () => {
    const sid = nextSid();
    publishCatalog(sid, [entry("a")]);
    renderChip(sid);
    expect(name()).toBeNull();
    expect(pill()).toBeNull();
    expect(btn("flows-chip-run")).toBeTruthy();
  });

  it("the pill carries its state as text (data-status mirrors it)", () => {
    const s = deriveChipFlow({ flowState: null, flowStates: new Map<string, FlowState>(), attachment: null });
    expect(s).toBeNull();
  });
});
