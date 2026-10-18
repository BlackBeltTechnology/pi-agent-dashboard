/**
 * Settings → OpenSpec → Workflow Schema: the default switch is a Save-Bar
 * draft; per-cwd actions are not. test-plan #F5 (+ #F6 Save Bar never opens).
 * Harness glue copied from ./SettingsPanel.test.tsx.
 * See change: add-pi-spec-driven-schema.
 */
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSpecMapContext } from "../../lib/openspec/OpenSpecMapContext.js";
import { SettingsPanel } from "../settings/SettingsPanel.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref, fetchWorktrees: vi.fn().mockResolvedValue([]) };
});

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
  openspec: { enabled: true, workflowSchema: { defaultForNewProjects: false } },
};

let puts: any[];
let schemaPosts: number;

beforeEach(() => {
  puts = [];
  schemaPosts = 0;
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
  window.history.replaceState({}, "", "/settings/openspec");
  global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
    if (url === "/api/config" && options?.method === "PUT") {
      puts.push(JSON.parse(options.body));
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    if (url === "/api/config") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    }
    if (url === "/api/openspec/workflow-schema") schemaPosts++;
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  }) as typeof fetch;
});
afterEach(cleanup);

describe("SettingsPanel — OpenSpec Workflow Schema section", () => {
  it("#F5 the default switch is a draft: no request until Save, then PUT /api/config", async () => {
    render(<SettingsPanel />);
    const sw = await screen.findByRole("switch", { name: /default for new projects/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("save-btn")).toBeNull();

    fireEvent.click(sw);
    expect(puts).toHaveLength(0);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    const save = (await screen.findAllByTestId("save-btn"))[0];

    fireEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].openspec.workflowSchema.defaultForNewProjects).toBe(true);
  });

  it("#F6 a per-cwd action never opens the Save Bar", async () => {
    const map = new Map<string, OpenSpecData>([
      ["/repo/a", { initialized: true, changes: [], workflowSchema: { configured: null, generated: "none", missing: false, unpinnedChanges: [], affectedChanges: [] } } as OpenSpecData],
    ]);
    render(
      <OpenSpecMapContext.Provider value={map}>
        <SettingsPanel />
      </OpenSpecMapContext.Provider>,
    );
    fireEvent.click(await screen.findByTestId("workflow-schema-enable-/repo/a"));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));
    await waitFor(() => expect(schemaPosts).toBe(1));
    expect(screen.queryByTestId("save-btn")).toBeNull();
    expect(puts).toHaveLength(0);
  });
});
