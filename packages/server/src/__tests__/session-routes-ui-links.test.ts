/**
 * Test-plan #E6 (uiUrl/diffUrl mapping, owner filter, no persistence) and #E7
 * (`?id=` filter) for `GET /api/sessions`.
 * See change: add-session-ui-deep-links-for-agents (D1, D3).
 */

import { sessionUiPath } from "@blackbelt-technology/pi-dashboard-shared/session-ui-path.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHostAdmitted } from "../auth/host-admission.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const PASSTHRU_GUARD = async () => {};
const A = { iss: "https://idp", sub: "a" };
const B = { iss: "https://idp", sub: "b" };

const ID1 = "01a16086-aaaa-4aaa-8aaa-000000000001";
const ID2 = "01a16086-bbbb-4bbb-8bbb-000000000002";
const ENDED = "ffff0000-1111-4222-8333-000000000003";
const OTHER = "cccc1111-1111-4222-8333-000000000004";

type Row = { id: string; status: string; principalOwner: { iss: string; sub: string } };
const rows: Row[] = [
  { id: ID1, status: "active", principalOwner: A },
  { id: ID2, status: "active", principalOwner: A },
  { id: ENDED, status: "ended", principalOwner: A },
  { id: OTHER, status: "active", principalOwner: B },
];

describe("GET /api/sessions — UI links and id filter", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    fastify.addHook("onRequest", async (req) => {
      (req as unknown as { principal: unknown }).principal = A;
    });
    registerSessionRoutes(fastify, {
      sessionManager: { listAll: () => rows, get: (id: string) => rows.find((r) => r.id === id) } as never,
      eventStore: createMemoryEventStore(() => false),
      networkGuard: PASSTHRU_GUARD,
      isResolverActive: () => true,
      uiLinks: {
        configuredOrigins: () => [],
        isAdmitted: (h) => isHostAdmitted(h, {}),
        port: () => 8000,
      },
    });
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  const get = async (qs = "") => {
    const res = await fastify.inject({
      method: "GET",
      url: `/api/sessions${qs}`,
      headers: { host: "localhost:8000" },
    });
    return { status: res.statusCode, body: res.json() as { data?: Array<Record<string, unknown>> } };
  };

  it("E6: owner-filtered rows carry uiUrl/diffUrl; nothing is persisted on the session", async () => {
    const { body } = await get();
    const data = body.data ?? [];
    expect(data.map((r) => r.id).sort()).toEqual([ID1, ID2, ENDED].sort());
    for (const r of data) {
      expect(r.uiUrl).toBe(`http://localhost:8000${sessionUiPath(String(r.id))}`);
      expect(r.diffUrl).toBe(`${String(r.uiUrl)}/diff`);
    }
    expect(data.find((r) => r.id === OTHER)).toBeUndefined();
    expect(rows.every((r) => !("uiUrl" in r) && !("diffUrl" in r))).toBe(true);
  });

  it("the response depends on the request Host, so it is never cacheable", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/sessions", headers: { host: "localhost:8000" } });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("E7: id filter — case-insensitive prefix >= 8, exact full id, owner-gated, single value", async () => {
    expect(((await get("?id=01A16086")).body.data ?? []).length).toBe(2);
    expect(((await get("?id=01a1608")).body.data ?? []).length).toBe(0);
    const full = (await get(`?id=${ENDED}`)).body.data ?? [];
    expect(full.map((r) => r.id)).toEqual([ENDED]);
    expect(full[0]?.uiUrl).toBe(`http://localhost:8000${sessionUiPath(ENDED)}`);
    expect(((await get(`?id=${OTHER}`)).body.data ?? []).length).toBe(0);
    expect((await get("?id=a&id=b")).status).toBe(400);
    expect(((await get()).body.data ?? []).length).toBe(3);
  });
});
