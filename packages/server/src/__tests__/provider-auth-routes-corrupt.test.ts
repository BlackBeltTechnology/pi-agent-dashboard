/**
 * Route-level proof that corrupt `auth.json` CONTENT neither 500s the status
 * endpoint nor leaks credential material through a refused DELETE
 * (test-plan X1, X5). Uses the REAL storage module — the existing
 * `provider-auth-routes.test.ts` mocks it, which would make these rows
 * vacuous — against the fresh tmp $HOME each test file gets.
 *
 * See change: fix-corrupt-auth-json-500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import {
  setCatalogueForSession,
  _resetForTests as resetCatalogueCache,
} from "../package/provider-catalogue-cache.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const FIXTURE_CATALOGUE: ProviderInfo[] = [
  { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: false },
  { id: "openai", displayName: "OpenAI", hasOAuth: false, configured: false },
];

const authDir = path.join(os.homedir(), ".pi", "agent");
const authPath = path.join(authDir, "auth.json");

function createMockPiGateway() {
  return {
    broadcast: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    connectionCount: () => 0,
    findSessionByCwd: () => undefined,
    getConnectedSessionIds: () => [],
    isSessionConnected: () => false,
  } as any;
}

describe("provider-auth-routes against corrupt auth.json content", () => {
  let app: ReturnType<typeof Fastify>;
  let piGateway: ReturnType<typeof createMockPiGateway>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    fs.mkdirSync(authDir, { recursive: true });
    piGateway = createMockPiGateway();
    app = Fastify();
    registerProviderAuthRoutes(app, {
      piGateway,
      browserGateway: { broadcastToAll: vi.fn() } as any,
    });
    await app.ready();
    setCatalogueForSession("test-session", FIXTURE_CATALOGUE);
  });

  afterEach(() => {
    resetCatalogueCache();
    try { fs.rmSync(authPath, { force: true }); } catch { /* absent */ }
  });

  // #X1 — corrupt content answers 200 with an all-unauthenticated array.
  it("GET /status returns 200 with every provider signed out when auth.json is empty", async () => {
    fs.writeFileSync(authPath, "");
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body.every((row: { authenticated: boolean }) => row.authenticated === false)).toBe(true);
  });

  // #X5 — a refused DELETE carries a reason and no credential material.
  it("DELETE surfaces the refusal reason without leaking credentials", async () => {
    const corrupt = '{"anthropic":{"type":"oauth","access":"sk-SECRETDELETE"';
    fs.writeFileSync(authPath, corrupt);
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
    });

    const res = await app.inject({ method: "DELETE", url: "/api/provider-auth/anthropic" });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error?: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/corrupt|backed up/i);
    expect(JSON.stringify(body)).not.toContain("sk-SECRETDELETE");
    // Nothing was persisted and the corrupt bytes are untouched.
    expect(fs.readFileSync(authPath, "utf-8")).toBe(corrupt);
  });
});
