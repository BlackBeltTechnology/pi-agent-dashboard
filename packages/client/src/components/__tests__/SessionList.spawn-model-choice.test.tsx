/**
 * SessionList spawn paths carry the model choice: Initialize project (menu item
 * + banner) uses the folder's remembered choice and always spawns pi; a card
 * sibling inherits the source model / thinking (ACP → agent only).
 * test-plan: E42, E43. See change: add-spawn-model-choice.
 * Exemplars: SessionList.folder-menu.test.tsx, SessionList.card-spawn-worktree.test.tsx.
 */
import { createFolderMenuStore, FolderMenuProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { _setAcpAgentsForTests } from "../../hooks/useAcpAgents.js";
import { agentMemoryKey } from "../../lib/acp/agent-memory.js";
import { spawnChoiceKey } from "../../lib/spawn/spawn-choice-memory.js";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

// The banner's own init-status plumbing is out of scope: render a stand-in
// that exposes the Initialize callback the list wires.
vi.mock("../folder/FolderActionBanner.js", () => ({
  FolderActionBanner: ({ cwd, onInitializeProject, compact }: { cwd: string; onInitializeProject?: (c: string) => void; compact?: boolean }) => (
    <button type="button" data-testid={`init-banner${compact ? "-compact" : ""}`} onClick={() => onInitializeProject?.(cwd)}>
      init
    </button>
  ),
}));

const CWD = "/home/user/project";
let store: Record<string, string>;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
});
afterEach(() => {
  cleanup();
  _setAcpAgentsForTests(null);
  vi.unstubAllGlobals();
});

function session(over: Partial<DashboardSession> = {}): DashboardSession {
  return { id: "s1", cwd: CWD, source: "tui", status: "active", startedAt: Date.now() - 60_000, tokensIn: 0, tokensOut: 0, cost: 0, ...over };
}

function renderList(sessions: DashboardSession[], onSpawnSession = vi.fn()) {
  const { hook } = memoryLocation({ path: "/", static: true });
  render(
    <Router hook={hook}>
      <ThemeProvider>
        <FolderMenuProvider store={createFolderMenuStore()}>
          <SessionList sessions={sessions} onSelect={() => {}} onSpawnSession={onSpawnSession} />
        </FolderMenuProvider>
      </ThemeProvider>
    </Router>,
  );
  return onSpawnSession;
}

describe("Initialize project (E42)", () => {
  it("menu item + banner spawn pi with the remembered model, never the remembered agent", () => {
    _setAcpAgentsForTests([{ id: "qmt", name: "querymt" }]);
    store[spawnChoiceKey(CWD)] = JSON.stringify({ model: "@fast" });
    store[agentMemoryKey(CWD)] = "qmt";
    const spawn = renderList([session()]);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    fireEvent.click(screen.getByTestId("folder-menu-item-project-setup"));
    fireEvent.click(screen.getByTestId("init-banner"));
    expect(spawn).toHaveBeenCalledTimes(2);
    for (const call of spawn.mock.calls) {
      expect(call[0]).toBe(CWD);
      expect(call[1]).toBeUndefined();
      expect(call[2]).toEqual({ initialPrompt: expect.any(String), model: "@fast" });
      expect(call[2]).not.toHaveProperty("agent");
    }
  });
});

describe("card sibling (E43)", () => {
  const sibling = () => {
    fireEvent.click(screen.getByTestId("session-actions-trigger-s1"));
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
  };

  it("a pi parent passes its model + thinking level", () => {
    const spawn = renderList([session({ model: "anthropic/claude-opus-5-5", thinkingLevel: "high" })]);
    sibling();
    expect(spawn).toHaveBeenCalledWith(CWD, undefined, { model: "anthropic/claude-opus-5-5", thinkingLevel: "high" });
  });

  it("an empty model is not sent", () => {
    const spawn = renderList([session({ model: "" })]);
    sibling();
    expect(spawn).toHaveBeenCalledWith(CWD, undefined, undefined);
  });

  it("an ACP parent passes the agent only", () => {
    const spawn = renderList([session({ driver: "acp", acpAgentId: "qmt", model: "x/y", thinkingLevel: "low" } as Partial<DashboardSession>)]);
    sibling();
    expect(spawn).toHaveBeenCalledWith(CWD, undefined, { agent: "qmt" });
  });
});
