/**
 * Session actions menu gate for the flows plugin: only a flowless session with
 * known edit mode gets one item. Decision table over catalog × edit mode.
 * See change: flows-dock-chip-and-panel-actions (test-plan E18).
 */
import { initPluginConfigs } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { ActionListMenuContext } from "@blackbelt-technology/pi-dashboard-client-utils/ActionListMenuContext";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flowMenuItems, SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";
import { catalogAsks, editMode, entry, fetchMock, publishCatalog, type Served, tree } from "./flows-test-harness.js";

beforeEach(() => {
  initPluginConfigs({ flows: {} });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const t = ((_k: string, _v: unknown, fallback: string) => fallback) as never;
const noop = () => {};

describe("flowMenuItems (E18 decision table)", () => {
  const CATALOG = [
    ["unknown", { catalogKnown: false, hasFlows: false }],
    ["empty", { catalogKnown: true, hasFlows: false }],
    ["[x]", { catalogKnown: true, hasFlows: true }],
  ] as const;
  const EDIT = [
    ["unknown", undefined],
    ["off", false],
    ["on", true],
  ] as const;
  for (const [cLabel, c] of CATALOG) {
    for (const [eLabel, e] of EDIT) {
      const expected =
        cLabel === "empty" && eLabel === "on"
          ? ["New flow…"]
          : cLabel === "empty" && eLabel === "off"
            ? ["Turn on edit mode for this project"]
            : [];
      it(`catalog ${cLabel} × edit mode ${eLabel} → ${JSON.stringify(expected)}`, () => {
        const items = flowMenuItems(t, { ...c, editMode: e, newFlow: noop, setEditMode: noop });
        expect(items.map((i) => i.label)).toEqual(expected);
      });
    }
  }
});

describe("SessionFlowMenuClaim renders the gate", () => {
  let n = 0;
  async function renderMenu(catalog: "unknown" | "empty" | "flows", served: Served, open = false) {
    const sid = `menu-S-${++n}`;
    if (catalog === "empty") publishCatalog(sid, []);
    if (catalog === "flows") publishCatalog(sid, [entry("x")]);
    editMode.served = served;
    const send = vi.fn();
    const node = (o: boolean) => (
      <ActionListMenuContext.Provider value={{ open: o }}>
        <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />
      </ActionListMenuContext.Provider>
    );
    const r = render(tree(node(open), send));
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    return { ...r, send, sid, rerenderOpen: (o: boolean) => r.rerender(tree(node(o), send)) };
  }

  it("flowless + edit mode on → New flow… only", async () => {
    await renderMenu("empty", true);
    expect((await screen.findAllByRole("menuitem")).map((b) => b.textContent)).toEqual(["New flow…"]);
  });

  it("session with flows → nothing, and edit mode is not fetched", async () => {
    const { container } = await renderMenu("flows", true);
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown catalog → nothing", async () => {
    const { container } = await renderMenu("unknown", true);
    expect(container.textContent).toBe("");
  });

  it("opening the menu asks for the catalog", async () => {
    const { send, rerenderOpen } = await renderMenu("unknown", false);
    expect(catalogAsks(send)).toHaveLength(0);
    rerenderOpen(true);
    expect(catalogAsks(send)).toHaveLength(1);
  });
});
