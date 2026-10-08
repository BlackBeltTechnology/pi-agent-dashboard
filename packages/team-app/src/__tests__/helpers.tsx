/**
 * Test helpers: a fake `AppHost` whose `api.fetch` is a route table, plus a
 * render wrapper (host provider + wouter memory router + toast provider).
 * See change: add-team-plugin.
 */
import { type AppHost, AppHostProvider } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Router, useLocation, useSearch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Agent, Conversation, Me, Persona, ProjectInfo } from "../api/types.js";
import { ToastProvider } from "../ui/toast.js";

type Handler = (req: { method: string; path: string; query: URLSearchParams; body: unknown }) => unknown | Promise<unknown>;

export interface FakeHost extends AppHost {
  calls: Array<{ method: string; path: string; body: unknown }>;
  routes: Map<string, Handler>;
  lang: string;
  setLang(l: string): void;
  titles: string[];
}

export function makeHost(opts: { mode?: "embedded" | "standalone"; dashboard?: boolean; folder?: { cwd: string; name: string }; lang?: string } = {}): FakeHost {
  const calls: FakeHost["calls"] = [];
  const routes = new Map<string, Handler>();
  const langListeners = new Set<() => void>();
  const host: FakeHost = {
    version: 1,
    mode: opts.mode ?? "standalone",
    basePath: opts.mode === "embedded" ? "/team" : "/apps/team",
    folder: opts.folder,
    capabilities: { dashboard: opts.dashboard ?? false, fullscreen: false },
    calls,
    routes,
    lang: opts.lang ?? "hu",
    titles: [],
    api: {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
      async fetch(path, init) {
        const url = new URL(path, "http://x");
        const method = (init?.method ?? "GET").toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path: `${url.pathname}${url.search}`, body });
        // longest registered pattern wins
        let handler: Handler | undefined;
        let best = -1;
        for (const [key, h] of routes) {
          const [m, p] = key.split(" ");
          if (m !== method) continue;
          const rx = new RegExp(`^${p.replace(/:[a-z]+/gi, "[^/]+")}$`);
          if (rx.test(url.pathname) && p.length > best) {
            handler = h;
            best = p.length;
          }
        }
        if (!handler) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
        const out = await handler({ method, path: url.pathname, query: url.searchParams, body });
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
      },
      wsUrl: async () => "ws://x/ws?ticket=t",
    },
    identity: { current: () => null, subscribe: () => () => {} },
    theme: { current: () => "dark", subscribe: () => () => {} },
    i18n: {
      language: () => host.lang,
      subscribe(cb) {
        langListeners.add(cb);
        return () => langListeners.delete(cb);
      },
    },
    setLang(l) {
      host.lang = l;
      for (const cb of langListeners) cb();
    },
    setTitle: (t) => host.titles.push(t),
    setActions() {},
    openSession: () => {},
    openFolder: () => {},
    navigateDashboard: () => {},
    openStandalone: () => {},
    requestFullscreen: () => {},
  };
  return host;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const ME: Me = { uk: "u", iss: "i", sub: "s", admin: false, mode: "multi", maxConversations: 50, skills: [] };

export const project = (id: string, extra: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id,
  name: id,
  contextFiles: false,
  available: true,
  source: "config",
  ...extra,
});

export const agent = (key: string, extra: Partial<Agent> = {}): Agent => ({
  key,
  name: key.split(":")[1] ?? key,
  description: "desc",
  avatar: { kind: "initials" },
  role: "member",
  scope: key.startsWith("shared") ? "shared" : "private",
  tools: "chat",
  unconfined: false,
  status: "new",
  activeCount: 0,
  personaStale: false,
  unassigned: false,
  retired: false,
  effectiveSkills: [],
  skillBlock: null,
  ...extra,
});

export const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: `conv ${id}`,
  status: "running",
  lastActivityAt: new Date().toISOString(),
  archived: false,
  personaStale: false,
  ...extra,
});

export const persona = (key: string, extra: Partial<Persona> = {}): Persona => ({
  key,
  scope: key.startsWith("shared") ? "shared" : "private",
  name: key.split(":")[1],
  description: "",
  avatar: { kind: "initials" },
  role: "member",
  instructions: "x",
  tools: "chat",
  projects: ["_ws"],
  updatedAt: new Date().toISOString(),
  ...extra,
});

/** Standard boot routes: me + projects. */
export function bootRoutes(host: FakeHost, me: Partial<Me> = {}, projects: ProjectInfo[] = []) {
  host.routes.set("GET /api/plugins/team/me", () => ({ ...ME, ...me }));
  host.routes.set("GET /api/plugins/team/projects", () => ({ projects }));
}

function LocationProbe() {
  const [loc] = useLocation();
  const search = useSearch();
  return <span data-testid="loc">{`${loc}${search ? `?${search}` : ""}`}</span>;
}

export function renderApp(ui: ReactElement, host: FakeHost, at = "/") {
  const { hook, navigate } = memoryLocation({ path: at });
  const result = render(
    <AppHostProvider host={host}>
      <Router hook={hook}>
        <ToastProvider>
          {ui}
          <LocationProbe />
        </ToastProvider>
      </Router>
    </AppHostProvider>,
  );
  return { ...result, navigate, hook };
}
