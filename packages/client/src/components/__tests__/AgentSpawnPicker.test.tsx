/**
 * AgentSpawnPicker: split button, per-folder memory + fallback, no-agents
 * zero-change, APG menu keyboard, entry-point wiring.
 * See change: add-acp-session-driver (test-plan #E45, #E57, #E58).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setAcpAgentsForTests } from "../../hooks/useAcpAgents.js";
import { agentMemoryKey, getRememberedAgent, rememberAgent } from "../../lib/acp/agent-memory.js";
import { AgentSelect } from "../AgentSelect.js";
import { AgentSpawnPicker } from "../AgentSpawnPicker.js";
import { FolderSpawnButtons } from "../folder/FolderSpawnButtons.js";

const QMT = { id: "qmt", name: "querymt" };
const CLAUDE = { id: "claude", name: "Claude Agent" };

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
});
afterEach(() => {
  cleanup();
  _setAcpAgentsForTests(null);
  vi.unstubAllGlobals();
});

const picker = (cwd: string, onSpawn = vi.fn()) =>
  render(
    <AgentSpawnPicker cwd={cwd} onSpawn={onSpawn} testId="spawn" className="btn" title="New pi session">
      New Session
    </AgentSpawnPicker>,
  );

describe("no agents configured (E45, E57)", () => {
  it("renders today's plain button: no chevron, no menu, no agent label; spawns with no agent", () => {
    _setAcpAgentsForTests([]);
    const onSpawn = vi.fn();
    const { container } = picker("/a", onSpawn);
    expect(screen.queryByTestId("spawn-chevron")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("spawn"));
    expect(onSpawn).toHaveBeenCalledWith(); // no argument at all: today's call, byte-identical
  });
});

describe("agents configured", () => {
  it("E45: split button with a menu; defaults to pi; the projection never carries command/env", () => {
    _setAcpAgentsForTests([QMT]);
    picker("/a");
    expect(screen.getByTestId("spawn-chevron")).toBeTruthy();
    expect(screen.getByTestId("spawn-agent").textContent).toContain("pi");
    fireEvent.click(screen.getByTestId("spawn-chevron"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.getAttribute("data-agent"))).toEqual(["pi", "qmt"]);
    expect(items.filter((i) => i.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(items[0]?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.innerHTML).not.toMatch(/command|env/i);
  });

  it("E57: choosing an agent remembers it per folder; /a preselects qmt, /b pi; spawn uses the remembered agent", () => {
    _setAcpAgentsForTests([QMT, CLAUDE]);
    const onSpawn = vi.fn();
    const a = picker("/a", onSpawn);
    fireEvent.click(screen.getByTestId("spawn-chevron"));
    fireEvent.click(screen.getAllByRole("menuitemradio").find((i) => i.getAttribute("data-agent") === "qmt") as HTMLElement);
    expect(window.localStorage.getItem(agentMemoryKey("/a"))).toBe("qmt");
    expect(screen.getByTestId("spawn-agent").textContent).toContain("querymt");
    fireEvent.click(screen.getByTestId("spawn"));
    expect(onSpawn).toHaveBeenLastCalledWith("qmt");
    a.unmount();
    picker("/b");
    expect(screen.getByTestId("spawn-agent").textContent).toContain("pi");
  });

  it("E57: a remembered agent that is no longer configured falls back to pi", () => {
    rememberAgent("/a", "qmt");
    expect(getRememberedAgent("/a", [QMT])).toBe("qmt");
    expect(getRememberedAgent("/a", [CLAUDE])).toBeUndefined();
    _setAcpAgentsForTests([CLAUDE]);
    picker("/a");
    expect(screen.getByTestId("spawn-agent").textContent).toContain("pi");
  });

  it("APG keyboard: ArrowDown moves, Enter chooses, Escape closes and returns focus to the chevron", () => {
    _setAcpAgentsForTests([QMT, CLAUDE]);
    picker("/a");
    const chevron = screen.getByTestId("spawn-chevron");
    fireEvent.click(chevron);
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[0]); // focus lands on the checked item
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
    expect(window.localStorage.getItem(agentMemoryKey("/a"))).toBe("claude");
    fireEvent.click(chevron);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(window.localStorage.getItem(agentMemoryKey("/a"))).toBe("claude"); // Escape keeps the selection
  });

  it("chevron exposes aria-haspopup/expanded and an accessible name", () => {
    _setAcpAgentsForTests([QMT]);
    picker("/a");
    const chevron = screen.getByTestId("spawn-chevron");
    expect(chevron.getAttribute("aria-haspopup")).toBe("menu");
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    expect(chevron.getAttribute("aria-label")).toBeTruthy();
    fireEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("entry-point wiring (E58)", () => {
  it("FolderSpawnButtons passes the chosen agent; with no agents it passes none (unchanged call)", () => {
    _setAcpAgentsForTests([]);
    const spawn = vi.fn();
    const { unmount } = render(<FolderSpawnButtons cwd="/a" showWorktree={false} onSpawnSession={spawn} />);
    fireEvent.click(screen.getByTestId("folder-spawn-session-btn"));
    expect(spawn).toHaveBeenLastCalledWith(); // unchanged call
    unmount();
    _setAcpAgentsForTests([QMT]);
    rememberAgent("/a", "qmt");
    render(<FolderSpawnButtons cwd="/a" showWorktree={false} onSpawnSession={spawn} />);
    fireEvent.click(screen.getByTestId("folder-spawn-session-btn"));
    expect(spawn).toHaveBeenLastCalledWith("qmt");
  });

  it("AgentSelect: absent without agents; preselects the folder memory; changing it updates the memory", () => {
    _setAcpAgentsForTests([]);
    const { container, unmount } = render(<AgentSelect cwd="/a" />);
    expect(container.innerHTML).toBe("");
    unmount();
    _setAcpAgentsForTests([QMT]);
    rememberAgent("/a", "qmt");
    const onChange = vi.fn();
    render(<AgentSelect cwd="/a" onChange={onChange} />);
    const select = screen.getByTestId("agent-select") as HTMLSelectElement;
    expect(select.value).toBe("qmt");
    expect(onChange).toHaveBeenLastCalledWith("qmt");
    fireEvent.change(select, { target: { value: "" } });
    expect(window.localStorage.getItem(agentMemoryKey("/a"))).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
