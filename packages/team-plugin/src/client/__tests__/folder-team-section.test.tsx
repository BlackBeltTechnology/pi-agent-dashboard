// @vitest-environment jsdom
/**
 * Folder entry (F27, F28 dialog, X14). See change: add-team-plugin.
 */
import {
  CurrentPluginLayer,
  createFolderMenuStore,
  FolderMenuProvider,
  type FolderMenuStore,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FolderTeamSection } from "../FolderTeamSection.js";
import { resetMatchStore } from "../match-store.js";
import { hasEmbeddedHost, openTeam } from "../team-open.js";

type Result = { cwd: string; project: null | { id: string; name: string; available: boolean; source: "config" | "folder"; agents: number; active: number }; enableable: boolean; manageable?: boolean };

const proj = (id: string, source: "config" | "folder", agents = 3, active = 1) => ({ id, name: id, available: true, source, agents, active });
const MATCHES: Record<string, Result> = {
  "/repo/billing": { cwd: "/repo/billing", project: proj("billing", "folder"), enableable: false, manageable: true },
  "/repo/crm": { cwd: "/repo/crm", project: proj("crm", "config"), enableable: false, manageable: false },
  "/repo/new": { cwd: "/repo/new", project: null, enableable: true },
  "/repo/other": { cwd: "/repo/other", project: null, enableable: false },
};

let fetchMock: ReturnType<typeof vi.fn>;
const resp = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  resetMatchStore();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/projects/match")) {
      const { cwds } = JSON.parse(String(init?.body)) as { cwds: string[] };
      return resp({ results: cwds.map((c) => MATCHES[c]) });
    }
    if (String(url).endsWith("/me")) return resp({ mode: "single" });
    return resp({ ok: true }, 201);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(cwds: string[], store: FolderMenuStore = createFolderMenuStore()) {
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <FolderMenuProvider store={store}>
        <CurrentPluginLayer pluginId="team">
          {cwds.map((cwd) => (
            <FolderTeamSection key={cwd} folder={{ cwd }} />
          ))}
        </CurrentPluginLayer>
      </FolderMenuProvider>
    </Router>,
  );
  return store;
}
const ids = (store: FolderMenuStore, cwd: string) => store.getItems(cwd).map((i) => i.id).sort();

describe("F27: row + menu contributions", () => {
  it("row only on matched folders; items by state; ONE match request for all folders", async () => {
    const store = mount(["/repo/billing", "/repo/crm", "/repo/new", "/repo/other"]);
    await waitFor(() => expect(screen.getAllByTestId("folder-team-section").length).toBe(2));
    const matchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/projects/match"));
    expect(matchCalls.length).toBe(1);
    expect(JSON.parse(String(matchCalls[0][1]?.body)).cwds.length).toBe(4);

    expect(screen.getAllByTestId("folder-team-count").map((e) => e.textContent)).toEqual(["3 agents · 1 active", "3 agents · 1 active"]);
    expect(ids(store, "/repo/billing")).toEqual(["team-disable", "team-open", "team-settings"]); // folder-enabled + admin
    expect(ids(store, "/repo/crm")).toEqual(["team-open"]); // config project: read-only
    expect(ids(store, "/repo/new")).toEqual(["team-enable"]); // unmatched + enableable
    expect(ids(store, "/repo/other")).toEqual([]); // unmatched, member: nothing
  });

  it("enable dialog: name required (no POST); success posts the folder path and refreshes matches", async () => {
    const store = mount(["/repo/new"]);
    await waitFor(() => expect(ids(store, "/repo/new")).toEqual(["team-enable"]));
    act(() => store.getItems("/repo/new")[0].onSelect());
    const name = (await screen.findByLabelText("Project name")) as HTMLInputElement;
    expect(name.value).toBe("new");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("team-project-submit"));
    await screen.findByText("Give the project a name.");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST" && String(c[0]).endsWith("/projects"))).toBe(false);

    fireEvent.change(name, { target: { value: "Marketing" } });
    fireEvent.click(screen.getByTestId("team-project-submit"));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST" && String(c[0]).endsWith("/projects"));
      expect(JSON.parse(String(((post as unknown[])[1] as RequestInit).body))).toMatchObject({ path: "/repo/new", name: "Marketing", users: "*", contextFiles: false });
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/projects/match")).length).toBe(2));
  });

  it("multi-user: 'selected users' with nobody ticked ⇒ error and no POST", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/projects/match")) return resp({ results: [MATCHES["/repo/new"]] });
      if (String(url).endsWith("/me")) return resp({ mode: "multi" });
      if (String(url).endsWith("/users")) return resp({ users: [{ iss: "i", sub: "anna", name: "Anna" }, { iss: "i", sub: "bela", name: "Béla" }] });
      void init;
      return resp({ ok: true }, 201);
    });
    const store = mount(["/repo/new"]);
    await waitFor(() => expect(ids(store, "/repo/new")).toEqual(["team-enable"]));
    act(() => store.getItems("/repo/new")[0].onSelect());
    fireEvent.click(await screen.findByLabelText("Selected users"));
    fireEvent.click(screen.getByTestId("team-project-submit"));
    await screen.findByText("Pick at least one user, or allow everyone.");
    const createCall = (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "POST" && String(c[0]).endsWith("/projects");
    expect(fetchMock.mock.calls.some(createCall)).toBe(false);
    fireEvent.click(await screen.findByLabelText("Anna"));
    fireEvent.click(screen.getByTestId("team-project-submit"));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(createCall);
      expect(JSON.parse(String(((post as unknown[])[1] as RequestInit).body)).users).toEqual([{ iss: "i", sub: "anna" }]);
    });
  });

  it("disable asks to confirm and then DELETEs the project", async () => {
    const store = mount(["/repo/billing"]);
    await waitFor(() => expect(ids(store, "/repo/billing")).toContain("team-disable"));
    act(() => store.getItems("/repo/billing").find((i) => i.id === "team-disable")?.onSelect());
    fireEvent.click(await screen.findByTestId("team-disable-confirm"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE" && String(c[0]).endsWith("/projects/billing"))).toBe(true));
  });
});

describe("X14: no app host / failing match", () => {
  it("without EmbeddedApp the folder entry opens the standalone app in a new tab", () => {
    expect(hasEmbeddedHost({})).toBe(false);
    expect(hasEmbeddedHost({ EmbeddedApp: () => null })).toBe(true);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const navigate = vi.fn();
    openTeam("billing", navigate, "/repo/billing", false);
    expect(open).toHaveBeenCalledWith("/apps/team/?project=billing", "_blank", "noopener");
    expect(navigate).not.toHaveBeenCalled();
    openTeam("billing", navigate, "/repo/billing", true);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/folder\/[A-Za-z0-9_-]+\/team$/));
    open.mockRestore();
  });

  it("a 500 from the match endpoint: no row, no menu items, no crash", async () => {
    fetchMock.mockImplementation(async () => resp({ error: "x" }, 500));
    const store = mount(["/repo/billing"]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId("folder-team-section")).toBeNull();
    expect(ids(store, "/repo/billing")).toEqual([]);
  });
});
