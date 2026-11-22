/**
 * Render-count guard: reading Focus state in `SessionList` (to suppress the
 * folder compact chip) must not add an extra render loop per folder.
 *
 * Scenario: test-plan #P2. See change: sidebar-folder-ux.
 */
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CardSectionsProvider } from "../../../lib/state/CardSectionsContext.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionList } from "../SessionList.js";

const counter = vi.hoisted(() => ({ renders: 0 }));
vi.mock("../../folder/FolderActionBanner.js", async (orig) => {
  const real = await orig<typeof import("../../folder/FolderActionBanner.js")>();
  const Real = real.FolderActionBanner;
  return {
    ...real,
    // Profiler counts commits of the real banner subtree, including renders caused by its OWN state updates
    // (a wrapper-body counter would miss those).
    FolderActionBanner: (props: React.ComponentProps<typeof Real>) => (
      <Profiler id="folder-action-banner" onRender={() => { counter.renders += 1; }}>
        <Real {...props} />
      </Profiler>
    ),
  };
});

const FOLDERS = 14;
const sessions: DashboardSession[] = Array.from({ length: FOLDERS }, (_, i) => ({
  id: `s${i}`,
  cwd: `/home/user/p${i}`,
  source: "tui" as const,
  status: "active" as const,
  startedAt: Date.now() - 60_000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
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
afterEach(cleanup);

function tree(prefs: CardSectionPrefs) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return (
    <Router hook={hook}>
      <ThemeProvider>
        <CardSectionsProvider value={{ prefs }}>
          <SessionList sessions={sessions} onSelect={() => {}} />
        </CardSectionsProvider>
      </ThemeProvider>
    </Router>
  );
}

describe("Focus toggle render count (#P2)", () => {
  it(`renders FolderActionBanner at most once per folder per Focus toggle (${FOLDERS} folders)`, async () => {
    const r = render(tree({ focus: { enabled: false } }));
    await waitFor(() => expect(counter.renders).toBeGreaterThanOrEqual(1));
    await act(async () => {}); // let mount-time probes settle
    for (const next of [true, false]) {
      const before = counter.renders;
      r.rerender(tree({ focus: { enabled: next } }));
      await act(async () => {});
      expect(counter.renders - before).toBeLessThanOrEqual(FOLDERS);
    }
  });
});
