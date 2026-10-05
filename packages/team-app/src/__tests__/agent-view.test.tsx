/**
 * Agent view: conversation list + chat pane states (F21, X1/X2 UI side).
 * `chat-embed` is replaced by a thin double; the socket layer is covered in
 * chat-session.test.tsx. See change: add-team-plugin.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentView } from "../agent/AgentView.js";
import { agent, bootRoutes, conv, json, makeHost, renderApp } from "./helpers.js";

vi.mock("@blackbelt-technology/pi-dashboard-web/chat-embed", async () => (await import("./chat-mock.js")).chatEmbedMock());
vi.mock("../agent/chat-providers.js", () => ({ ChatProviders: ({ children }: { children: unknown }) => children }));
vi.mock("../agent/chat-session.js", () => ({
  useTeamChat: () => ({ state: { messages: [] }, status: "connected", sendPrompt: vi.fn(), abort: vi.fn() }),
}));

const AGENTS = "GET /api/plugins/team/agents";
const CONVS = "GET /api/plugins/team/agents/:k/conversations";
const ENSURE = "POST /api/plugins/team/agents/:k/conversations/:c/session";

function setup(opts: { active?: ReturnType<typeof conv>[]; archived?: ReturnType<typeof conv>[]; agentExtra?: Parameters<typeof agent>[1]; max?: number } = {}) {
  const host = makeHost();
  bootRoutes(host, { maxConversations: opts.max ?? 50 });
  const active = opts.active ?? [conv("c1"), conv("c2", { title: "second" })];
  const archived = opts.archived ?? [conv("c3", { archived: true, title: "old one" })];
  host.routes.set(AGENTS, () => ({ agents: [agent("shared:a", { name: "Alpha", status: "running", activeCount: active.length, ...opts.agentExtra })] }));
  host.routes.set(CONVS, ({ query }) => ({ conversations: query.get("archived") === "true" ? archived : active }));
  host.routes.set(ENSURE, () => ({ sessionId: "sess-1" }));
  return host;
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

describe("F21: conversation list", () => {
  it("lists active conversations; archived only under the filter; each switch opens its own chat", async () => {
    const host = setup();
    renderApp(<AgentView agentKey="shared:a" />, host, "/agent/shared%3Aa");
    const list = await screen.findByTestId("conv-list");
    expect(within(list).getAllByRole("button").map((b) => b.getAttribute("data-conv"))).toEqual(["c1", "c2"]);
    expect(screen.queryByText("old one")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle-archived"));
    expect(within(screen.getByTestId("conv-list")).getByText("old one")).toBeTruthy();
    fireEvent.click(screen.getByTestId("toggle-archived"));
    fireEvent.click(within(screen.getByTestId("conv-list")).getByText("second"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/agent/shared%3Aa/c/c2?project=_ws"));
  });

  it("rename updates the title via PATCH", async () => {
    const host = setup();
    host.routes.set("PATCH /api/plugins/team/agents/:k/conversations/:c", ({ body }) => conv("c1", { title: (body as { title: string }).title }));
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByTestId("conv-menu");
    fireEvent.click(screen.getByTestId("conv-menu"));
    fireEvent.click(await screen.findByText("Átnevezés"));
    const input = await screen.findByLabelText("Cím");
    fireEvent.change(input, { target: { value: "Fresh title" } });
    fireEvent.click(screen.getByText("Mentés", { selector: "button[type=submit]" }));
    await waitFor(() => expect(host.calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "Fresh title" }));
  });

  it("at the limit 'Új beszélgetés' is disabled with its reason", async () => {
    const host = setup({ max: 2 });
    renderApp(<AgentView agentKey="shared:a" />, host, "/agent/shared%3Aa");
    const btn = (await screen.findByTestId("list-new-conv")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Elérted a 2 aktív beszélgetést/)).toBeTruthy();
  });

  it("an unknown conversation id shows the not-found state", async () => {
    const host = setup();
    renderApp(<AgentView agentKey="shared:a" convId="nope" />, host, "/agent/shared%3Aa/c/nope");
    await screen.findByText("Ez a beszélgetés nem található.");
  });
});

describe("conversation states", () => {
  it("ready: ensure is called once and the chat mounts", async () => {
    const host = setup();
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByTestId("chatview");
    expect(host.calls.filter((c) => c.path.includes("/session")).length).toBe(1);
  });

  it("X1/X2: spawn_timeout and guard_unavailable show an error with Retry that re-ensures", async () => {
    for (const code of ["spawn_timeout", "guard_unavailable"]) {
      const host = setup();
      let fail = true;
      host.routes.set(ENSURE, () => (fail ? json({ error: code }, code === "spawn_timeout" ? 504 : 503) : { sessionId: "s" }));
      const { unmount } = renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
      await screen.findByRole("alert");
      fail = false;
      await act(async () => fireEvent.click(screen.getByText("Újrapróbálás", { selector: "button" })));
      await screen.findByTestId("chatview");
      unmount();
    }
  });

  it("conversation_unrecoverable: explanatory error, no Retry", async () => {
    const host = setup();
    host.routes.set(ENSURE, () => json({ error: "conversation_unrecoverable" }, 409));
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByText("Ez a beszélgetés nem állítható helyre.");
    expect(screen.queryByText("Újrapróbálás", { selector: "button" })).toBeNull();
  });

  it("retired / unassigned agents: read-only banner, ensure is never called", async () => {
    const host = setup({ agentExtra: { status: "unavailable", unassigned: true } });
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByText(/már nincs ehhez a projekthez rendelve/);
    expect(host.calls.some((c) => c.path.includes("/session"))).toBe(false);
  });

  it("stale persona: banner with Restart that restarts and re-ensures", async () => {
    const host = setup({ active: [conv("c1", { personaStale: true })] });
    host.routes.set("POST /api/plugins/team/agents/:k/conversations/:c/restart", () => ({ ok: true }));
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByText(/A persona frissült. Indítsd újra/);
    await act(async () => fireEvent.click(screen.getByText("Újraindítás", { selector: ".callout button" })));
    await waitFor(() => expect(host.calls.filter((c) => c.path.includes("/session")).length).toBe(2));
    expect(host.calls.some((c) => c.path.includes("/restart"))).toBe(true);
  });

  it("archived conversation: read-only banner + Restore; no ensure", async () => {
    const host = setup({ archived: [conv("c3", { archived: true })] });
    host.routes.set("PATCH /api/plugins/team/agents/:k/conversations/:c", () => conv("c3"));
    renderApp(<AgentView agentKey="shared:a" convId="c3" />, host, "/agent/shared%3Aa/c/c3");
    await screen.findByText(/Archivált beszélgetés: csak olvasható/);
    expect(host.calls.some((c) => c.path.includes("/session"))).toBe(false);
    fireEvent.click(screen.getAllByText("Visszaállítás", { selector: "button" })[0]);
    await waitFor(() => expect(host.calls.find((c) => c.method === "PATCH")?.body).toEqual({ archived: false }));
  });

  it("'Megnyitás a dashboardon' only when the host has the dashboard capability", async () => {
    const host = setup();
    host.capabilities.dashboard = true;
    const opened: string[] = [];
    host.openSession = (id) => opened.push(id);
    renderApp(<AgentView agentKey="shared:a" convId="c1" />, host, "/agent/shared%3Aa/c/c1");
    await screen.findByTestId("chatview");
    fireEvent.click(screen.getByTestId("conv-menu"));
    fireEvent.click(await screen.findByText("Megnyitás a dashboardon"));
    expect(opened).toEqual(["sess-1"]);
  });
});
