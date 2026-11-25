/**
 * Harness of the Team view integration tests: a scriptable in-memory "server"
 * behind `fetch` (lookup, snapshot with ETag/304, 404, control POSTs), a fresh
 * `TeamsStore`, and a render that wraps `TeamViewClaim` in the real plugin
 * context + primitive providers. Use with `vi.useFakeTimers()` and `flush()`.
 * See change: add-agent-teams-ui.
 */
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { snapshotEtag, type TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { TeamViewClaim } from "../TeamView.js";
import { createTeamsStore, type TeamsStore } from "../teams-store.js";
import { renderHost } from "./view-fixtures.js";

export interface FakeServer {
  snapshot: TeamUiSnapshot | undefined;
  /** `teams` of the lookup answer; `[]` = no team; a number = HTTP status. */
  lookup: Array<{ id: string; leadSessionId?: string }> | number;
  /** Status of `GET /teams/:id` when `snapshot` is undefined. */
  teamStatus: number;
  /** Answer of the control POSTs by URL suffix (`/stop`, `/shutdown`); default 200/202. */
  post: (url: string) => Response | Promise<Response>;
  requests: Array<{ method: string; url: string }>;
  gets: () => string[];
  posts: () => string[];
}

export function createServer(snapshot: TeamUiSnapshot | undefined, over: Partial<FakeServer> = {}): { server: FakeServer; fetch: typeof fetch } {
  const server: FakeServer = {
    snapshot,
    lookup: snapshot ? [{ id: snapshot.id, leadSessionId: "S-lead" }] : [],
    teamStatus: 404,
    post: (url) => new Response(JSON.stringify(url.endsWith("/shutdown") ? { closing: true } : { aborted: true }), { status: url.endsWith("/shutdown") ? 202 : 200 }),
    requests: [],
    gets: () => server.requests.filter((r) => r.method === "GET").map((r) => r.url),
    posts: () => server.requests.filter((r) => r.method === "POST").map((r) => r.url),
    ...over,
  };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    server.requests.push({ method, url });
    if (method === "POST") return server.post(url);
    if (url.includes("?sessionId=")) return typeof server.lookup === "number" ? new Response("{}", { status: server.lookup }) : new Response(JSON.stringify({ teams: server.lookup }), { status: 200 });
    if (!server.snapshot) return new Response(JSON.stringify({ error: "not_found" }), { status: server.teamStatus });
    const inm = new Headers(init?.headers).get("if-none-match");
    if (inm === snapshotEtag(server.snapshot.epoch, server.snapshot.rev)) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(server.snapshot), { status: 200 });
  }) as typeof fetch;
  return { server, fetch: fetchFn };
}

export const flush = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

export interface Mounted {
  store: TeamsStore;
  server: FakeServer;
  onBack: ReturnType<typeof vi.fn>;
  confirms: string[];
  unmount: () => void;
}

/** Mount the claim for `sessionId` against a fake server (caller owns fake timers). */
export async function mountView(snapshot: TeamUiSnapshot | undefined, over: Partial<FakeServer> = {}, sessionId = "S-lead", language?: string): Promise<Mounted> {
  __resetSessionEventsStoreForTests();
  const { server, fetch } = createServer(snapshot, over);
  const store = createTeamsStore({ fetch });
  const onBack = vi.fn();
  const log = { messages: [] as string[] };
  const tree = (): ReactElement => (
    <PluginContextProvider connectionStatus="connected" language={language}>
      <TeamViewClaim params={{ sessionId }} onBack={onBack} store={store} />
    </PluginContextProvider>
  );
  const view = renderHost(tree(), log);
  await flush();
  return {
    store,
    server,
    onBack,
    confirms: log.messages,
    unmount: () => {
      view.unmount();
      store.dispose();
    },
  };
}
