// @vitest-environment jsdom
/**
 * Every Team view state renders something (test-plan S38): loading, no team (an
 * empty lookup — no existence oracle), not found (only after a resolved team answers
 * 404), error + cache (stale notice + working Retry), error without cache, empty
 * sections. See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, type Mounted, mountView } from "./team-view-harness.js";
import { member, snap } from "./view-fixtures.js";

let mounted: Mounted | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  cleanup();
  vi.useRealTimers();
});

describe("states (S38)", () => {
  it("loading: skeleton with aria-busy and a status text, before the lookup resolves", async () => {
    let release: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((r) => (release = r));
    const { createTeamsStore } = await import("../teams-store.js");
    const { render } = await import("@testing-library/react");
    const { PluginContextProvider } = await import("@blackbelt-technology/dashboard-plugin-runtime/host");
    const { TeamViewClaim } = await import("../TeamView.js");
    const store = createTeamsStore({ fetch: (() => pending) as unknown as typeof fetch });
    render(
      <PluginContextProvider connectionStatus="connected">
        <TeamViewClaim params={{ sessionId: "S1" }} store={store} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("team-loading").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("team-none")).toBeNull(); // never flashes "no team" before the store resolves
    release(new Response(JSON.stringify({ teams: [] }), { status: 200 }));
    await flush();
    expect(screen.getByTestId("team-none")).toBeTruthy();
    store.dispose();
  });

  it("reduced motion: the skeleton pulse and the busy glyph pulse stop under motion-reduce (task 8.7)", async () => {
    let release: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((r) => (release = r));
    const { createTeamsStore } = await import("../teams-store.js");
    const { render } = await import("@testing-library/react");
    const { PluginContextProvider } = await import("@blackbelt-technology/dashboard-plugin-runtime/host");
    const { TeamViewClaim } = await import("../TeamView.js");
    const store = createTeamsStore({ fetch: (() => pending) as unknown as typeof fetch });
    const view = render(
      <PluginContextProvider connectionStatus="connected">
        <TeamViewClaim params={{ sessionId: "S1" }} store={store} />
      </PluginContextProvider>,
    );
    for (const bar of Array.from(screen.getByTestId("team-loading").querySelectorAll(".animate-pulse"))) expect(bar.className).toContain("motion-reduce:animate-none");
    expect(screen.getByTestId("team-loading").querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    view.unmount();
    release(new Response("{}", { status: 200 }));
    store.dispose();
    cleanup();
    mounted = await mountView(snap({ members: [member("a", "busy")] }));
    const glyph = screen.getByTestId("team-member-status").querySelector("[aria-hidden=true].animate-pulse");
    expect(glyph?.className).toContain("motion-reduce:animate-none");
  });

  it("no team: an empty lookup shows the no-team copy with a way back", async () => {
    mounted = await mountView(undefined);
    expect(screen.getByTestId("team-none").textContent).toContain("not part of a team");
    expect(screen.queryByTestId("team-not-found")).toBeNull();
    fireEvent.click(screen.getByTestId("team-back"));
    expect(mounted.onBack).toHaveBeenCalledOnce();
  });

  it("a team that never resolved (404 on first load) is 'no team', not 'not found'", async () => {
    mounted = await mountView(undefined, { lookup: [{ id: "gone" }], teamStatus: 404 });
    expect(screen.getByTestId("team-none")).toBeTruthy();
    expect(screen.queryByTestId("team-not-found")).toBeNull();
  });

  it("not found: only after a previously resolved team answers 404", async () => {
    mounted = await mountView(snap());
    expect(screen.getByTestId("team-view")).toBeTruthy();
    mounted.server.snapshot = undefined;
    mounted.store.signalReconnect();
    await flush(600);
    expect(screen.getByTestId("team-not-found").textContent).toContain("no longer available");
    expect(screen.queryByTestId("team-view")).toBeNull();
  });

  it("error without a cache: error notice with a Retry that refetches", async () => {
    mounted = await mountView(undefined, { lookup: 500 });
    const notice = screen.getByTestId("team-error");
    expect(notice.textContent).toContain("Couldn’t load the team");
    const before = mounted.server.gets().length;
    mounted.server.lookup = [];
    fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
    await flush();
    expect(mounted.server.gets().length).toBeGreaterThan(before);
    expect(screen.getByTestId("team-none")).toBeTruthy();
  });

  it("error + cached snapshot: the snapshot stays visible with a stale notice and a working Retry", async () => {
    mounted = await mountView(snap({ rev: 1 }));
    const real = mounted.server.snapshot;
    mounted.server.snapshot = undefined;
    mounted.server.teamStatus = 500;
    mounted.store.signalReconnect();
    await flush(600);
    expect(screen.getByTestId("team-view")).toBeTruthy();
    expect(screen.getByTestId("team-stale").textContent).toContain("Couldn’t refresh");
    expect(screen.getByTestId("team-name").textContent).toBe("Team A");
    mounted.server.snapshot = real && { ...real, rev: 2 };
    fireEvent.click(within(screen.getByTestId("team-stale")).getByRole("button", { name: "Retry" }));
    await flush();
    expect(screen.queryByTestId("team-stale")).toBeNull();
  });

  it("empty members, tasks and messages each show text, never an empty panel", async () => {
    mounted = await mountView(snap({ members: [], tasks: [], mail: [], mailTotal: 0 }));
    expect(screen.getByTestId("team-members-empty").textContent).toContain("No members yet");
    expect(screen.getByTestId("team-tasks-empty").textContent).toContain("No tasks yet");
    expect(screen.getByTestId("team-log-empty").textContent).toContain("No messages yet");
    for (const panel of screen.getAllByRole("tabpanel", { hidden: true })) expect((panel.textContent ?? "").trim()).not.toBe("");
  });

  it("every non-ready state has non-empty text and a Back control", async () => {
    mounted = await mountView(undefined);
    expect((screen.getByTestId("team-state").textContent ?? "").trim().length).toBeGreaterThan(10);
    expect(screen.getByTestId("team-back").textContent).toContain("Back to the session");
  });

  it("the tab panels all stay mounted (one visible) so a tab switch keeps its state", async () => {
    mounted = await mountView(snap({ members: [member("a", "idle")] }));
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels).toHaveLength(3);
    expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
  });
});
