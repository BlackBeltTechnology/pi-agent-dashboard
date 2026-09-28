/**
 * Stateful fake of the server YOLO API for component tests (change:
 * add-access-grant-dialog, 8b.7-8b.8). Mirrors `YoloController` semantics that
 * the UI depends on: one session; a POST while live ADDS the root and keeps
 * `expiresAt`; report mode refuses with 409.
 */
import { vi } from "vitest";
import type {
  AccessPromptsView,
  VerdictView,
  YoloSessionView,
} from "../../../lib/access-grants/access-prompts-types.js";

export interface FakeYoloServer {
  session: YoloSessionView | null;
  available: boolean;
  verdicts: VerdictView[];
  roots: Record<string, string[]>;
  calls: { url: string; method: string; body?: Record<string, unknown> }[];
  now: number;
}

export function view(s: FakeYoloServer): AccessPromptsView {
  return {
    prompting: {
      enabled: true,
      killSwitch: false,
      hostGateMode: s.available ? "enforce" : "report",
      blockers: s.available ? [] : ["report-mode"],
    },
    pending: [],
    verdicts: s.verdicts,
    yolo: { available: s.available, durationsMinutes: [15, 30, 60], session: s.session },
    refusals: [],
  };
}

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

type Body = Record<string, unknown>;

/** POST /api/access/yolo: activate, or ADD to the live session (expiry kept). */
function postYolo(s: FakeYoloServer, b: Body) {
  if (!s.available) return reply(409, { success: false, error: "report-mode" });
  if (s.session) {
    if (b.unscoped) return reply(400, { success: false, error: "cannot-widen-to-unscoped" });
    const root = String(b.root);
    if (!s.session.roots.some((r) => r.path === root)) s.session.roots.push({ path: root, addedAt: s.now });
    return reply(200, { success: true, data: { session: s.session, added: true } });
  }
  const expiresAt = s.now + Number(b.durationMinutes) * 60_000;
  const roots = b.unscoped ? [] : [{ path: String(b.root), addedAt: s.now }];
  s.session = { source: "operator", activatedAt: s.now, expiresAt, unscoped: b.unscoped === true, roots };
  return reply(200, { success: true, data: { session: s.session, added: false } });
}

function route(s: FakeYoloServer, url: string, method: string, body: Body) {
  if (url === "/api/access/prompts" && method === "GET") return reply(200, { success: true, data: view(s) });
  if (url.startsWith("/api/access/yolo/roots?")) {
    const base = new URL(url, "http://x").searchParams.get("base") ?? "";
    return reply(200, { success: true, data: { roots: s.roots[base] ?? [] } });
  }
  if (url === "/api/access/yolo" && method === "POST") return postYolo(s, body);
  if (url === "/api/access/yolo" && method === "DELETE") {
    s.session = null;
    return reply(200, { success: true });
  }
  return reply(404, { success: false, error: "not found" });
}

export function installFakeYoloServer(init: Partial<FakeYoloServer> = {}): FakeYoloServer {
  const s: FakeYoloServer = {
    session: null,
    available: true,
    verdicts: [],
    roots: {},
    calls: [],
    now: Date.now(),
    ...init,
  };
  global.fetch = vi.fn((url: string, req?: { method?: string; body?: string }) => {
    const method = req?.method ?? "GET";
    const body = req?.body ? (JSON.parse(req.body) as Body) : undefined;
    s.calls.push({ url, method, body });
    return route(s, url, method, body ?? {});
  }) as unknown as typeof fetch;
  return s;
}

export const scopedSession = (now: number, ...paths: string[]): YoloSessionView => ({
  source: "operator",
  activatedAt: now,
  expiresAt: now + 15 * 60_000,
  unscoped: false,
  roots: paths.map((path) => ({ path, addedAt: now })),
});
