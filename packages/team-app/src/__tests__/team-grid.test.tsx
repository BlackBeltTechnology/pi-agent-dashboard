/**
 * Team grid + cards (F10, F11, F20). See change: add-team-plugin.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetStore } from "../state/target-store.js";
import { TeamGrid } from "../team/TeamGrid.js";
import { agent, bootRoutes, conv, json, ME, makeHost, project, renderApp } from "./helpers.js";

const AGENTS = "GET /api/plugins/team/agents";

describe("F10: polling", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("a card flips running → busy after one 5 s tick; no polling while the tab is hidden", async () => {
    const host = makeHost();
    bootRoutes(host);
    let status: "running" | "busy" = "running";
    host.routes.set(AGENTS, () => ({ agents: [agent("shared:a", { status, activeCount: 1 })] }));
    renderApp(<TeamGrid />, host);
    await screen.findByText("a");
    expect(document.querySelector('[data-key="shared:a"]')?.getAttribute("data-status")).toBe("running");
    status = "busy";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(document.querySelector('[data-key="shared:a"]')?.getAttribute("data-status")).toBe("busy"));

    const polls = () => host.calls.filter((c) => c.path.startsWith("/api/plugins/team/agents")).length;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const before = polls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(polls()).toBe(before);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

describe("F11: card actions by role and state", () => {
  const cards = [
    agent("shared:sh", { name: "Shared" }),
    agent("private:own", { name: "Own" }),
    agent("shared:old", { name: "Retired", status: "retired", retired: true, activeCount: 1 }),
    agent("shared:full", { name: "Full", status: "unavailable", tools: "full", unconfined: true }),
    agent("shared:stale", { name: "Stale", status: "running", activeCount: 1, personaStale: true }),
  ];
  const open = async (admin: boolean) => {
    const host = makeHost();
    bootRoutes(host, { admin });
    host.routes.set(AGENTS, () => ({ agents: cards }));
    renderApp(<TeamGrid />, host);
    await screen.findByText("Shared");
    return host;
  };
  const menuItems = (key: string) => {
    const card = document.querySelector(`[data-key="${key}"]`) as HTMLElement;
    const btn = within(card).queryAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu");
    if (btn) fireEvent.click(btn);
    return [...card.querySelectorAll("[role=menuitem]")].map((e) => e.getAttribute("data-item"));
  };

  it("admin: shared gets edit+fork+delete", async () => {
    await open(true);
    expect(menuItems("shared:sh")).toEqual(["edit", "fork", "delete"]);
  });

  it("non-admin: shared gets fork only; own gets edit+fork+delete", async () => {
    await open(false);
    expect(menuItems("shared:sh")).toEqual(["fork"]);
    expect(menuItems("private:own")).toEqual(["edit", "fork", "delete"]);
  });

  it("retired / unavailable: no conversation actions; retired has no menu; stale shows restart", async () => {
    await open(true);
    const retired = document.querySelector('[data-key="shared:old"]') as HTMLElement;
    expect(within(retired).queryByTestId("talk")).toBeNull();
    expect(within(retired).queryByTestId("new-conv")).toBeNull();
    expect(menuItems("shared:old")).toEqual([]);
    const full = document.querySelector('[data-key="shared:full"]') as HTMLElement;
    expect(within(full).queryByTestId("talk")).toBeNull();
    expect(full.textContent).toContain("Shell (bash)");
    const stale = document.querySelector('[data-key="shared:stale"]') as HTMLElement;
    expect(within(stale).getByText("Újraindítás a frissítéshez")).toBeTruthy();
  });

  it("restart-to-apply restarts only the stale conversations", async () => {
    const host = await open(true);
    host.routes.set("GET /api/plugins/team/agents/:k/conversations", () => ({ conversations: [conv("c1", { personaStale: true }), conv("c2")] }));
    host.routes.set("POST /api/plugins/team/agents/:k/conversations/:c/restart", () => ({ ok: true }));
    const stale = document.querySelector('[data-key="shared:stale"]') as HTMLElement;
    fireEvent.click(within(stale).getByText("Újraindítás a frissítéshez"));
    await waitFor(() => expect(host.calls.filter((c) => c.path.includes("/restart")).length).toBe(1));
    expect(host.calls.find((c) => c.path.includes("/restart"))?.path).toContain("/c1/restart");
  });
});

describe("F20: card summary and primary action", () => {
  it("status + '3 beszélgetés · 2 órája'; primary opens the latest; new card creates the first; unassigned only links", async () => {
    const host = makeHost();
    bootRoutes(host);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    host.routes.set(AGENTS, () => ({
      agents: [
        agent("shared:busy", { name: "Busy", status: "busy", activeCount: 3, latest: { id: "cLatest", title: "t", status: "busy", lastActivityAt: twoHoursAgo } }),
        agent("shared:fresh", { name: "Fresh", status: "new", activeCount: 0 }),
        agent("shared:gone", { name: "Gone", status: "unavailable", unassigned: true, activeCount: 1, latest: { id: "cG", title: "t", status: "sleeping", lastActivityAt: twoHoursAgo } }),
      ],
    }));
    host.routes.set("POST /api/plugins/team/agents/:k/conversations", () => json({ id: "cNew", sessionId: "s" }, 201));
    renderApp(<TeamGrid />, host);
    await screen.findByText("Busy");
    const busy = document.querySelector('[data-key="shared:busy"]') as HTMLElement;
    expect(within(busy).getByTestId("activity").textContent).toBe("3 beszélgetés · 2 órája");
    expect(busy.getAttribute("data-status")).toBe("busy");
    fireEvent.click(within(busy).getByTestId("talk"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/agent/shared%3Abusy/c/cLatest?project=_ws"));

    const fresh = document.querySelector('[data-key="shared:fresh"]') as HTMLElement;
    fireEvent.click(within(fresh).getByTestId("talk"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/agent/shared%3Afresh/c/cNew?project=_ws"));

    const gone = document.querySelector('[data-key="shared:gone"]') as HTMLElement;
    expect(within(gone).queryByTestId("new-conv")).toBeNull();
    expect(within(gone).getByTestId("open-list").textContent).toContain("Beszélgetések (1)");
  });

  it("'+ Új' is disabled at the conversation limit with its reason", async () => {
    const host = makeHost();
    bootRoutes(host, { maxConversations: 2 });
    host.routes.set(AGENTS, () => ({ agents: [agent("shared:a", { name: "A", status: "running", activeCount: 2 })] }));
    renderApp(<TeamGrid />, host);
    await screen.findByRole("heading", { name: "A" });
    const btn = screen.getByTestId("new-conv") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("2");
  });
});

describe("states", () => {
  it("empty target, error + retry", async () => {
    const host = makeHost();
    bootRoutes(host, { admin: true });
    let fail = true;
    host.routes.set(AGENTS, () => (fail ? json({ error: "x" }, 500) : { agents: [] }));
    renderApp(<TeamGrid />, host);
    await screen.findByText("Az ügynökök listája nem tölthető be.");
    fail = false;
    fireEvent.click(screen.getByText("Újrapróbálás"));
    await screen.findByTestId("empty-target");
    expect(ME.admin).toBe(false);
  });
});

describe("target switch", () => {
  it("the previous target's cards disappear immediately (never clickable under the new target)", async () => {
    const host = makeHost();
    bootRoutes(host, {}, [project("p1")]);
    targetStore.set("_ws");
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => {
      release = r;
    });
    host.routes.set(AGENTS, async ({ query }) => {
      if (query.get("project") === "p1") {
        await gate;
        return { agents: [agent("shared:b", { name: "BBB" })] };
      }
      return { agents: [agent("shared:a", { name: "AAA" })] };
    });
    renderApp(<TeamGrid />, host);
    await screen.findByRole("heading", { name: "AAA" });
    act(() => targetStore.set("p1"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "AAA" })).toBeNull());
    expect(screen.getByText(/Ügynökök betöltése/)).toBeTruthy();
    release(null);
    await screen.findByRole("heading", { name: "BBB" });
  });
});
