/**
 * Folder actions menu — "Enable OpenSpec for this folder" re-enable item
 * (add-openspec-init-affordances).
 *
 * The item is a DIRECTORY-group host item built in SessionList: it exists IFF
 * the cwd is opted out (readiness `OPTED_OUT`) AND OpenSpec is not globally
 * disabled, and activating it removes the cwd from
 * `openspec.optOutDirectories` via a PUT /api/config partial.
 *
 * Scenarios: tasks 2.42–2.45 (test-plan #E29–#E32); spec:
 * openspec/changes/add-openspec-init-affordances/specs/folder-actions-menu.
 */

import { createFolderMenuStore, FolderMenuProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession, OpenSpecData, OpenSpecReadiness } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const CWD = "/home/user/project";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session: DashboardSession = {
  id: "s1",
  cwd: CWD,
  source: "tui",
  status: "active",
  startedAt: Date.now() - 60_000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
};

function withReadiness(readiness: OpenSpecReadiness): OpenSpecData {
  return { initialized: false, changes: [], readiness };
}

function renderList(props: Partial<React.ComponentProps<typeof SessionList>> = {}, menuStore = createFolderMenuStore()) {
  const { hook } = memoryLocation({ path: "/", static: true });
  render(
    <Router hook={hook}>
      <ThemeProvider>
        <FolderMenuProvider store={menuStore}>
          <SessionList sessions={[session]} onSelect={() => {}} {...props} />
        </FolderMenuProvider>
      </ThemeProvider>
    </Router>,
  );
  return menuStore;
}

function openMenu() {
  fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
}

function hasReenableItem(): boolean {
  const item = screen.queryByTestId("folder-menu-item-openspec-reenable");
  if (!item) return false;
  // Spec: the item lives in the DIRECTORY group.
  return item.closest("[data-testid='folder-menu-group-directory']") !== null;
}

describe("folder menu re-enable item (tasks 2.42–2.44 / test-plan #E29–#E31)", () => {
  it("2.42 / E29: an OPTED_OUT cwd gets the item in the DIRECTORY group", () => {
    renderList({ openspecMap: new Map([[CWD, withReadiness({ state: "OPTED_OUT" })]]) });
    openMenu();
    expect(hasReenableItem()).toBe(true);
    expect(screen.getByTestId("folder-menu-item-openspec-reenable").textContent).toContain(
      "Enable OpenSpec for this folder",
    );
  });

  it.each([
    ["ABSENT", { state: "ABSENT" as const }],
    ["READY", { state: "READY" as const }],
    ["BROKEN", { state: "BROKEN" as const, reason: "missing-changes-dir" as const }],
    ["STALE", { state: "STALE" as const, reason: "missing-skills" as const }],
  ])("2.43 / E30: a %s cwd gets no item", (_label, readiness) => {
    renderList({ openspecMap: new Map([[CWD, withReadiness(readiness)]]) });
    openMenu();
    expect(hasReenableItem()).toBe(false);
  });

  it("2.44 / E31: opted-out cwd but openspec globally disabled — no item", () => {
    renderList({
      openspecMap: new Map([[CWD, withReadiness({ state: "OPTED_OUT" })]]),
      openspecEnabled: false,
    });
    openMenu();
    expect(hasReenableItem()).toBe(false);
  });
});

describe("folder menu re-enable activation (task 2.45 / test-plan #E32)", () => {
  it("activating the item PUTs /api/config with the cwd removed from optOutDirectories", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "/api/config") {
        return new Response(
          JSON.stringify({
            success: true,
            data: { openspec: { enabled: true, optOutDirectories: ["/other", CWD], offerInitialization: true } },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderList({ openspecMap: new Map([[CWD, withReadiness({ state: "OPTED_OUT" })]]) });
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-openspec-reenable"));

    await waitFor(() => {
      const put = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
      expect(put.length).toBeGreaterThan(0);
      expect(JSON.parse((put[put.length - 1][1] as RequestInit).body as string)).toEqual({
        openspec: { optOutDirectories: ["/other"] },
      });
    });
  });
});
