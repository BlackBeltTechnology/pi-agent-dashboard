/**
 * "Open flow…" from the FLOWS dock chip (moved from the session actions menu):
 * hidden with no flows, enabled when idle, disabled while any flow runs; the
 * picker lists every flow and selecting one writes the per-session attachment
 * with the resolved baseline and expands the panel. The picker open asks for a
 * rediscovered catalog.
 * See change: attach-flow-before-run (D7); flows-dock-chip-and-panel-actions (D6, D10).
 */
import { initPluginConfigs, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowsContextGroup } from "../client/FlowsContextGroup.js";
import { __resetFlowAttachStoreForTests, getAttachment } from "../client/flow-attach-store.js";
import { flowCollapseKey } from "../client/flow-collapse-storage.js";
import { useIsolatedLocalStorage, catalogAsks, completed, editMode, entry, fetchMock, publishCatalog, started, tree } from "./flows-test-harness.js";

useIsolatedLocalStorage();

const TWO = [
  entry("test:capabilities", { description: "project flow", source: "/proj/.pi/flows/flows/test/capabilities/flow.yaml" }),
  entry("pkg:review", { description: "package flow", source: "/home/.pi/agent/npm/node_modules/pkg/flows/review/flow.yaml" }),
];

let n = 0;
const nextSid = () => `open-S-${++n}`;
const openBtn = () => screen.queryByTestId("flows-chip-open") as HTMLButtonElement | null;
const renderChip = (sid: string, send = vi.fn()) => ({ send, ...render(tree(<FlowsContextGroup session={{ id: sid } as DashboardSession} />, send)) });

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

describe("Open flow… visibility (E9)", () => {
  it("(a) hidden with no flows", () => {
    const sid = nextSid();
    publishCatalog(sid, []);
    publishSessionEvents(sid, [started("A", 1)]);
    renderChip(sid);
    expect(openBtn()).toBeNull();
  });

  it("(b) enabled with flows and nothing running", () => {
    const sid = nextSid();
    publishCatalog(sid, TWO);
    renderChip(sid);
    expect(openBtn()?.disabled).toBe(false);
  });

  it("(c) disabled while any flowStates entry runs, even if the latest is completed", () => {
    const sid = nextSid();
    publishCatalog(sid, TWO);
    // B starts, then A starts and completes: latest flowState = completed A,
    // flowStates still holds running B.
    publishSessionEvents(sid, [started("B", 1), started("A", 2), completed("A", 3)]);
    renderChip(sid);
    expect(openBtn()?.disabled).toBe(true);
    expect(openBtn()?.title).toBe("A flow is running");
  });
});

describe("Open flow… picker (E10)", () => {
  it("lists every flow with its description, attaches with the resolved baseline and expands the panel", async () => {
    const sid = nextSid();
    publishCatalog(sid, TWO);
    publishSessionEvents(sid, [started("X", 700), completed("X", 800)]);
    const { send } = renderChip(sid);
    fireEvent.click(openBtn()!);
    // Opening the picker asks for a rediscovered catalog.
    expect(catalogAsks(send).at(-1)).toMatchObject({ payload: { rediscover: true } });
    const picker = await screen.findByTestId("picker");
    expect(picker.textContent).toContain("test:capabilities|project flow");
    expect(picker.textContent).toContain("pkg:review|package flow");
    fireEvent.click(screen.getByText(/pkg:review/));
    const a = getAttachment(sid);
    expect(a).toMatchObject({ name: "pkg:review", source: TWO[1].source, baselineStartedAt: 700 });
    expect(typeof a?.id).toBe("string");
    expect(localStorage.getItem(flowCollapseKey("dashboard", sid))).toBe("false");
  });
});
