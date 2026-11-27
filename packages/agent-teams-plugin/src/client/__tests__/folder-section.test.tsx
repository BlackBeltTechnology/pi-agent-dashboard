// @vitest-environment jsdom
/**
 * Sidebar folder section placement (test-plan #F10): the Start team action is ONE
 * folder-menu item per folder, sidebar placement only, and the dialog it opens posts
 * the folder's own cwd. See change: add-agent-teams-templates-hooks (7.2).
 */
import { CurrentPluginLayer, createFolderMenuStore, FolderMenuProvider, type FolderMenuStore } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START_TEAM_MENU_ID, StartTeamFolderAction } from "../StartTeamFolderAction.js";

const resp = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as Response;
const TEMPLATES = { templates: [{ name: "review-pr", source: "user", trusted: true, valid: true, errors: [], warnings: [] }], warnings: [] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? resp({ teamId: "t_1" }) : resp(TEMPLATES)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Mounted {
  folder: FolderDescriptor;
  placement?: SlotPlacement;
}
function mount(folders: Mounted[], store: FolderMenuStore = createFolderMenuStore(), onOuterClick: () => void = () => undefined) {
  const view = render(
    <div onClick={onOuterClick}>
      <FolderMenuProvider store={store}>
        <CurrentPluginLayer pluginId="agent-teams">
          {folders.map((f) => (
            <StartTeamFolderAction key={`${f.folder?.cwd}:${f.placement ?? "sidebar"}`} folder={f.folder} placement={f.placement} />
          ))}
        </CurrentPluginLayer>
      </FolderMenuProvider>
    </div>,
  );
  return { store, ...view };
}
const items = (store: FolderMenuStore, cwd: string) => store.getItems(cwd).map((i) => i.id);

describe("F10 — one Start action per folder, sidebar only", () => {
  it("registers exactly one `create` item per folder: with / without label, worktree folder", () => {
    const { store } = mount([{ folder: { cwd: "/repo/a", label: "A" } }, { folder: { cwd: "/repo/b" } }, { folder: { cwd: "/repo/.worktrees/os-x", label: "os-x" } }]);
    for (const cwd of ["/repo/a", "/repo/b", "/repo/.worktrees/os-x"]) {
      expect(items(store, cwd), cwd).toEqual([START_TEAM_MENU_ID]);
      expect(store.getItems(cwd)[0]).toMatchObject({ group: "create", label: "Start team", pluginId: "agent-teams" });
    }
  });

  it("registers nothing for the card placement or a folder without a cwd", () => {
    const { store } = mount([{ folder: { cwd: "/repo/a" }, placement: "card" }, { folder: { cwd: "" } }, { folder: undefined as unknown as FolderDescriptor }]);
    expect(items(store, "/repo/a")).toEqual([]);
    expect(items(store, "")).toEqual([]);
  });

  it("sidebar + card of the same folder still gives a single item", () => {
    const { store } = mount([{ folder: { cwd: "/repo/a" } }, { folder: { cwd: "/repo/a" }, placement: "card" }]);
    expect(items(store, "/repo/a")).toEqual([START_TEAM_MENU_ID]);
  });

  it("removes the item on unmount and renders nothing in the card grid", () => {
    const { store, unmount, container } = mount([{ folder: { cwd: "/repo/a" } }]);
    expect(container.querySelector("[data-testid]")).toBeNull();
    unmount();
    expect(items(store, "/repo/a")).toEqual([]);
  });

  it("makes no request until the item is selected", () => {
    mount([{ folder: { cwd: "/repo/a" } }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Start flow from the folder (7.1, 7.2)", () => {
  async function open(cwd: string, label?: string) {
    const outer = vi.fn();
    const { store } = mount([{ folder: { cwd, label } }, { folder: { cwd: "/repo/other" } }], undefined, outer);
    const item = store.getItems(cwd)[0];
    act(() => {
      item?.onSelect();
    });
    await screen.findByTestId("start-team-dialog");
    return { store, outer };
  }

  it("lists the templates for THAT folder's cwd and posts that same cwd", async () => {
    await open("/repo/my app&x", "My app");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/plugins/agent-teams/templates?cwd=%2Frepo%2Fmy%20app%26x", expect.anything()));
    fireEvent.click(await screen.findByTestId("start-template-review-pr"));
    fireEvent.change(screen.getByTestId("start-goal"), { target: { value: "ship it" } });
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(screen.queryByTestId("start-team-dialog")).toBeNull());
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(post?.[0]).toBe("/api/plugins/agent-teams/teams/start");
    const init = post?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ template: "review-pr", goal: "ship it", cwd: "/repo/my app&x" });
  });

  it("shows the folder label, and clicks inside the dialog never reach the folder card behind it", async () => {
    const { outer } = await open("/repo/a", "My app");
    expect(screen.getByTestId("start-team-dialog").textContent).toContain("My app");
    fireEvent.click(screen.getByTestId("start-goal"));
    fireEvent.click(screen.getByTestId("start-cancel"));
    expect(outer).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("start-team-dialog")).toBeNull());
  });
});
