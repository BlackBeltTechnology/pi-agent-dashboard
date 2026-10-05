/**
 * Typed client for `/api/plugins/team/*`. All traffic goes through
 * `host.api.fetch` (embedded: dashboard auth; standalone: app-kit transport).
 * See change: add-team-plugin (D9/D16).
 */
import type { AppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import type { Agent, Conversation, KnownUser, MatchResult, Me, Persona, PersonaInput, ProjectInfo, Target } from "./types.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(code);
  }
}

const BASE = "/api/plugins/team";

export function createApi(host: Pick<AppHost, "api">) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await host.api.fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const j = (json ?? {}) as { error?: string; fields?: Record<string, string> };
      throw new ApiError(res.status, j.error ?? "request_failed", j.fields);
    }
    return json as T;
  }
  const q = (t: Target, extra = "") => `?project=${encodeURIComponent(t)}${extra}`;
  const k = encodeURIComponent;
  const conv = (key: string) => `/agents/${k(key)}/conversations`;

  return {
    me: () => call<Me>("GET", "/me"),
    projects: async () => (await call<{ projects: ProjectInfo[] }>("GET", "/projects")).projects,
    match: async (cwds: string[]) => (await call<{ results: MatchResult[] }>("POST", "/projects/match", { cwds })).results,
    enableProject: (body: { path: string; name?: string; users?: unknown; contextFiles?: boolean }) =>
      call<{ id: string }>("POST", "/projects", body),
    patchProject: (id: string, body: { name?: string; users?: unknown; contextFiles?: boolean }) =>
      call<{ ok: true }>("PATCH", `/projects/${k(id)}`, body),
    disableProject: (id: string) => call<{ ok: true }>("DELETE", `/projects/${k(id)}`),
    users: async () => (await call<{ users: KnownUser[] }>("GET", "/users")).users,

    personas: async () => (await call<{ personas: Persona[] }>("GET", "/personas")).personas,
    createPersona: (body: PersonaInput) => call<Persona>("POST", "/personas", body),
    updatePersona: (key: string, body: Omit<PersonaInput, "slug" | "scope">) => call<Persona>("PUT", `/personas/${k(key)}`, body),
    deletePersona: (key: string) => call<{ ok: true }>("DELETE", `/personas/${k(key)}`),
    forkPersona: (key: string, slug?: string) => call<Persona>("POST", `/personas/${k(key)}/fork`, slug ? { slug } : {}),

    agents: async (t: Target) => (await call<{ agents: Agent[] }>("GET", `/agents${q(t)}`)).agents,
    conversations: async (key: string, t: Target, archived = false) =>
      (await call<{ conversations: Conversation[] }>("GET", `${conv(key)}${q(t, archived ? "&archived=true" : "")}`)).conversations,
    createConversation: (key: string, t: Target) => call<{ id: string; sessionId: string }>("POST", `${conv(key)}${q(t)}`),
    ensure: (key: string, t: Target, c: string) => call<{ sessionId: string }>("POST", `${conv(key)}/${k(c)}/session${q(t)}`),
    patchConversation: (key: string, t: Target, c: string, body: { title?: string; archived?: boolean }) =>
      call<Conversation>("PATCH", `${conv(key)}/${k(c)}${q(t)}`, body),
    restart: (key: string, t: Target, c: string) => call<{ ok: true }>("POST", `${conv(key)}/${k(c)}/restart${q(t)}`),
    deleteConversation: (key: string, t: Target, c: string) => call<{ ok: true }>("DELETE", `${conv(key)}/${k(c)}${q(t)}`),
  };
}

export type TeamApi = ReturnType<typeof createApi>;
