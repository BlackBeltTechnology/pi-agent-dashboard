/**
 * Folder New Session split button — model · thinking chip in the menu.
 * test-plan: E38, E39, E40, E41, F1. See change: add-spawn-model-choice.
 * Exemplar: AgentSpawnPicker.test.tsx.
 */
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setAcpAgentsForTests } from "../../hooks/useAcpAgents.js";
import { useAgentAwareSpawn } from "../../hooks/useAgentAwareSpawn.js";
import { rememberAgent } from "../../lib/acp/agent-memory.js";
import { setSpawnDefaults, spawnChoiceKey } from "../../lib/spawn/spawn-choice-memory.js";
import { AgentSpawnPicker } from "../AgentSpawnPicker.js";

vi.mock("../../hooks/useModelCatalogue.js", () => ({
  useModelCatalogue: () => ({ models: [], catalogue: null, fetching: false, loading: false, unavailable: false, refetch: async () => {} }),
}));

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ preset: null, roles: [{ role: "fast", assigned: true, model: "a/f" }, { role: "review", assigned: true, model: "a/r" }] }] }),
    })),
  );
  setSpawnDefaults({});
});
afterEach(() => {
  cleanup();
  _setAcpAgentsForTests(null);
  vi.unstubAllGlobals();
});

const picker = (onSpawn = vi.fn()) => {
  render(
    <AgentSpawnPicker cwd="/a" onSpawn={onSpawn} testId="spawn" className="btn">
      New Session
    </AgentSpawnPicker>,
  );
  return onSpawn;
};

describe("folder split button model choice", () => {
  it("E38: no agents → menu has only the model chip", () => {
    _setAcpAgentsForTests([]);
    picker();
    fireEvent.click(screen.getByTestId("spawn-chevron"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByTestId("spawn-model-choice")).toBeTruthy();
    expect(within(menu).queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("E39: picking a role does not spawn; the main button spawns with it", async () => {
    _setAcpAgentsForTests([]);
    store[spawnChoiceKey("/a")] = JSON.stringify({ model: "@fast" });
    const onSpawn = picker();
    fireEvent.click(screen.getByTestId("spawn-chevron"));
    fireEvent.click(within(screen.getByTestId("spawn-model-choice")).getByTestId("model-selector-button"));
    fireEvent.click(await screen.findByTestId("model-tab-role"));
    fireEvent.click(screen.getAllByTestId("role-row").find((r) => r.getAttribute("data-role") === "review") as HTMLElement);
    expect(onSpawn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("spawn"));
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn).toHaveBeenCalledWith(undefined, { model: "@review" });
  });

  it("E40: a remembered ACP agent wins over the remembered model (button + board)", () => {
    _setAcpAgentsForTests([{ id: "qmt", name: "querymt" }]);
    rememberAgent("/a", "qmt");
    store[spawnChoiceKey("/a")] = JSON.stringify({ model: "@fast" });
    const onSpawn = picker();
    fireEvent.click(screen.getByTestId("spawn"));
    expect(onSpawn).toHaveBeenCalledWith("qmt");
    const inner = vi.fn();
    const { result } = renderHook(() => useAgentAwareSpawn(inner));
    result.current?.("/a", "chg", { focus: false });
    expect(inner).toHaveBeenCalledWith("/a", "chg", { focus: false, agent: "qmt" });
  });

  it("E41: board spawn fills the remembered choice for pi", () => {
    _setAcpAgentsForTests([]);
    store[spawnChoiceKey("/a")] = JSON.stringify({ model: "@fast" });
    const inner = vi.fn();
    const { result } = renderHook(() => useAgentAwareSpawn(inner));
    result.current?.("/a", "chg", { focus: false });
    expect(inner).toHaveBeenCalledWith("/a", "chg", { focus: false, model: "@fast" });
    // An explicit caller choice is never overridden.
    result.current?.("/a", "chg", { model: "x/y" });
    expect(inner).toHaveBeenLastCalledWith("/a", "chg", { model: "x/y" });
  });

  it("F1: APG keyboard on the always-on chevron", () => {
    _setAcpAgentsForTests([]);
    picker();
    const chevron = screen.getByTestId("spawn-chevron");
    chevron.focus();
    fireEvent.keyDown(chevron, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
    // Enter/Space reach the button as a native click.
    fireEvent.click(chevron);
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});
