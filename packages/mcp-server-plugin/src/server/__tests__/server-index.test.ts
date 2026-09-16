/**
 * registerPlugin wiring (change extract-mcp-client-plugin, task 6.1): the
 * adapter-version diagnostic runs lazily on the FIRST POST /mcp, not at
 * registration; an absent `mcp-client.config` service reads as `unknown`; and
 * the plugin declares no manifest `dependsOn` (the config service is a package
 * dependency, so a missing plugin degrades rather than blocking load).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { ADAPTER_VERSION_FLOOR } from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";
import { type ListSessionsArgs, listSessions } from "../list-sessions.js";

interface CtxHandle {
  ctx: ServerPluginContext;
  app: ReturnType<typeof Fastify>;
  warnings: string[];
  infos: string[];
  piHandlers: Map<string, (msg: unknown, sessionId: string) => void>;
  /** Flip to `false` to simulate a closed bridge socket at delivery time. */
  setDeliverable: (ok: boolean) => void;
  sentMessages: Array<{ sessionId: string; msg: unknown }>;
}

function makeCtx(config: { adapterVerdict: () => unknown } | undefined): CtxHandle {
  const warnings: string[] = [];
  const infos: string[] = [];
  const piHandlers = new Map<string, (msg: unknown, sessionId: string) => void>();
  const sentMessages: Array<{ sessionId: string; msg: unknown }> = [];
  let deliverable = true;
  const app = Fastify();
  const consumed: Record<string, unknown> = {
    "mcp-client.config": config,
  };
  const ctx = {
    logger: {
      info: (m: string) => infos.push(m),
      warn: (m: string) => warnings.push(m),
      error: () => {},
    },
    consume: (name: string) => consumed[name],
    provide: () => {},
    fastify: app,
    sessionManager: { listAll: () => [] },
    sendToSession: () => false,
    spawnSession: async () => ({}),
    abortSession: async () => false,
    onEvent: () => () => {},
    registerPiHandler: (type: string, handler: (msg: unknown, sessionId: string) => void) => {
      piHandlers.set(type, handler);
    },
    sendExtensionMessage: (sessionId: string, msg: unknown) => {
      if (!deliverable) return false;
      sentMessages.push({ sessionId, msg });
      return true;
    },
    onSessionEnded: () => {},
  } as unknown as ServerPluginContext;
  return { ctx, app, warnings, infos, piHandlers, setDeliverable: (ok: boolean) => { deliverable = ok; }, sentMessages };
}

const ADAPTER_MSG = "upgrade now";

let cfgDir: string;
beforeEach(() => {
  // Sandbox provisioning: the plugin writes the Pi-global mcp.json at
  // registration, and PI_CODING_AGENT_DIR is where the adapter resolves it.
  cfgDir = mkdtempSync(join(tmpdir(), "mcp-server-cfg-"));
  process.env.PI_CODING_AGENT_DIR = cfgDir;
});
afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(cfgDir, { recursive: true, force: true });
});

describe("registerPlugin adapter diagnostic (task 6.1)", () => {
  it("does not probe at registration; warns once on the first /mcp request", async () => {
    const adapterVerdict = vi.fn(() => ({
      kind: "below-floor",
      installed: "2.19.0",
      floor: ADAPTER_VERSION_FLOOR,
      message: ADAPTER_MSG,
    }));
    const { ctx, app, warnings } = makeCtx({ adapterVerdict });
    await registerPlugin(ctx);
    await app.ready();

    // Registration must NOT have probed or warned.
    expect(adapterVerdict).not.toHaveBeenCalled();
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(0);

    // First POST /mcp fires it exactly once.
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(adapterVerdict).toHaveBeenCalledTimes(1);
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(1);

    // Second POST does not repeat it.
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(adapterVerdict).toHaveBeenCalledTimes(1);
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(1);

    await app.close();
  });

  it("an absent service still warns once on first request, reading as `unknown`", async () => {
    const { ctx, app, warnings } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(warnings.filter((w) => w.includes("unknown"))).toHaveLength(1);
    await app.close();
  });
});

describe("manifest (task 6.1)", () => {
  it("declares no dependsOn — the config service is a package dependency", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      "pi-dashboard-plugin"?: { dependsOn?: string[] };
    };
    expect(pkg["pi-dashboard-plugin"]?.dependsOn).toBeUndefined();
    expect(pkg.dependencies?.["@blackbelt-technology/pi-dashboard-mcp-client-plugin"]).toBeTruthy();
  });
});

describe("X1/X5 — the mint reply rides the session-private lane", () => {
  it("X5 — mint → deliver logs the session id but NEVER the plaintext", async () => {
    const { ctx, app, piHandlers, infos, warnings, sentMessages } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();

    const handler = piHandlers.get("mcp/mint-token");
    expect(handler).toBeDefined();
    handler?.({}, "session-x");

    // The plaintext was delivered exactly once, on the private lane.
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].sessionId).toBe("session-x");
    const token = (sentMessages[0].msg as { token: string }).token;
    expect(token.startsWith("mcp_")).toBe(true);
    expect((sentMessages[0].msg as { type: string }).type).toBe("mcp_token_minted");

    // Every log line, across both sinks: no plaintext, no mcp_ prefix.
    for (const line of [...infos, ...warnings]) {
      expect(line).not.toContain(token);
      expect(line).not.toContain("mcp_");
    }
    await app.close();
  });

  it("X1 — a closed bridge socket at delivery time is logged with the session id; /mcp keeps serving", async () => {
    const { ctx, app, piHandlers, warnings, infos, setDeliverable, sentMessages } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();

    // The bridge WS dies just as the mint reply is sent.
    setDeliverable(false);
    expect(() => piHandlers.get("mcp/mint-token")?.({}, "session-gone")).not.toThrow();

    // The failure is surfaced, with the affected session id — never silent,
    // never a plaintext leak.
    const failureLines = warnings.filter((w) => w.includes("session-gone"));
    expect(failureLines.length).toBeGreaterThan(0);
    for (const line of [...infos, ...warnings]) expect(line).not.toContain("mcp_");
    expect(sentMessages).toHaveLength(0);

    // The endpoint still serves other callers (401 = alive and guarding).
    const res = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── Bounded, filterable, cursor-paged listing ───────────────────────────────
// change: paginate-mcp-list-sessions. E1–E26 listing behaviour and X1–X4 walk
// stability, exercised against the pure `listSessions` surface. The handler is
// a one-liner over `listAll()`; all the behaviour lives here.

type Row = Partial<DashboardSession> & { id: string; cwd: string };

function makeRow(over: Row): DashboardSession {
  return {
    source: "tui",
    status: "active",
    startedAt: 1_000,
    hidden: false,
    ...over,
  } as DashboardSession;
}

/** `n` visible sessions with distinct recency keys (newest = highest startedAt). */
function seed(
  n: number,
  over: (i: number) => Partial<DashboardSession> = () => ({}),
): DashboardSession[] {
  return Array.from({ length: n }, (_, i) =>
    makeRow({
      id: `s-${String(i).padStart(4, "0")}`,
      cwd: "/proj",
      startedAt: 1_000 + i,
      ...over(i),
    }),
  );
}

/** Page through `rows` from an optional cursor until exhausted. */
function walk(
  rows: readonly DashboardSession[],
  args: Partial<ListSessionsArgs> = {},
  limit = 25,
  startCursor?: string,
) {
  const pages: ReturnType<typeof listSessions>[] = [];
  let cursor = startCursor;
  for (let i = 0; i < 100; i += 1) {
    const page = listSessions(rows, { ...args, limit, ...(cursor ? { cursor } : {}) });
    pages.push(page);
    if (!page.nextCursor) return pages;
    cursor = page.nextCursor;
  }
  throw new Error("walk did not terminate");
}

const idsOf = (pages: ReturnType<typeof listSessions>[]) =>
  pages.flatMap((p) => p.sessions.map((s) => s.id));

describe("E1/E2/E5 — the default and the bounds are enforced", () => {
  it("E1 — a no-argument call over 100 sessions is bounded to 25 with a cursor", () => {
    const page = listSessions(seed(100));
    expect(page.sessions).toHaveLength(25);
    expect(page.total).toBe(100);
    expect(page.nextCursor).toBeTruthy();
  });

  it("E2 — the minimum valid limit returns one session and a cursor", () => {
    const page = listSessions(seed(100), { limit: 1 });
    expect(page.sessions).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
  });

  it("E5 — the hard maximum returns 200 and still signals more", () => {
    const page = listSessions(seed(300), { limit: 200 });
    expect(page.sessions).toHaveLength(200);
    expect(page.nextCursor).toBeTruthy();
  });
});

describe("E10/E11 — status filtering", () => {
  it("E10 — a status filter narrows results and total", () => {
    const rows = [
      ...seed(10, () => ({ status: "active" })),
      ...seed(90, (i) => ({ id: `e-${i}`, status: "ended", endedAt: 9_000 })),
    ];
    const page = listSessions(rows, { status: ["active"] });
    expect(page.sessions).toHaveLength(10);
    expect(page.sessions.every((s) => s.status === "active")).toBe(true);
    expect(page.total).toBe(10);
  });

  it("E11 — several status values match any of them", () => {
    const rows = [
      ...seed(5, () => ({ status: "active" })),
      ...seed(5, (i) => ({ id: `st-${i}`, status: "streaming" })),
      ...seed(3, (i) => ({ id: `id-${i}`, status: "idle" })),
      ...seed(90, (i) => ({ id: `ed-${i}`, status: "ended", endedAt: 9_000 })),
    ];
    const page = listSessions(rows, { status: ["active", "idle", "streaming"] });
    expect(page.sessions).toHaveLength(13);
    expect(page.sessions.some((s) => s.status === "ended")).toBe(false);
    expect(page.total).toBe(13);
  });
});

describe("E13/E14/E15 — cwd, since and conjunction", () => {
  it("E13 — cwd matches after path normalization", () => {
    const rows = [
      ...seed(3, () => ({ cwd: "/tmp/proj" })),
      ...seed(3, (i) => ({ id: `o-${i}`, cwd: "/tmp/other" })),
    ];
    const page = listSessions(rows, { cwd: "/tmp/proj/" });
    expect(page.sessions).toHaveLength(3);
    expect(page.sessions.every((s) => s.cwd === "/tmp/proj")).toBe(true);
    expect(page.total).toBe(3);
  });

  it("E14 — since compares against the sort key", () => {
    const rows = [
      makeRow({ id: "a", cwd: "/x", startedAt: 1_000 }),
      makeRow({ id: "b", cwd: "/x", startedAt: 2_000 }),
      makeRow({ id: "c", cwd: "/x", startedAt: 3_000 }),
    ];
    const page = listSessions(rows, { since: 2_000 });
    expect(page.sessions.map((s) => s.id).sort()).toEqual(["b", "c"]);
    expect(page.total).toBe(2);
  });

  it("E15 — combined filters conjoin", () => {
    const rows = [
      makeRow({ id: "hit", cwd: "/p", status: "active", startedAt: 5_000 }),
      makeRow({ id: "wrong-status", cwd: "/p", status: "ended", startedAt: 5_000 }),
      makeRow({ id: "wrong-cwd", cwd: "/q", status: "active", startedAt: 5_000 }),
      makeRow({ id: "too-old", cwd: "/p", status: "active", startedAt: 100 }),
    ];
    const page = listSessions(rows, { status: ["active"], cwd: "/p", since: 1_000 });
    expect(page.sessions.map((s) => s.id)).toEqual(["hit"]);
    expect(page.total).toBe(1);
  });
});

describe("E16/E18/E19 — hidden exclusion and exhaustion signals", () => {
  it("E16 — hidden sessions are excluded and uncounted", () => {
    const rows = [
      ...seed(10, () => ({ hidden: false })),
      ...seed(3, (i) => ({ id: `h-${i}`, hidden: true })),
    ];
    const page = listSessions(rows);
    expect(page.sessions).toHaveLength(10);
    expect(page.sessions.some((s) => s.hidden === true)).toBe(false);
    expect(page.total).toBe(10);
  });

  it("E18 — an empty filtered result is a clean exhausted list", () => {
    const rows = seed(100, () => ({ status: "ended", endedAt: 9_000 }));
    const page = listSessions(rows, { status: ["active"] });
    expect(page.sessions).toEqual([]);
    expect(page.total).toBe(0);
    // Absent, not null-but-present.
    expect("nextCursor" in page).toBe(false);
  });

  it("E19 — an exactly-full page is not reported as truncated", () => {
    const page = listSessions(seed(25));
    expect(page.sessions).toHaveLength(25);
    expect("nextCursor" in page).toBe(false);
  });
});

describe("E20–E23 — the keyset walk", () => {
  it("E20 — the final page carries no continuation cursor", () => {
    const pages = walk(seed(60));
    const last = pages[pages.length - 1];
    expect("nextCursor" in last).toBe(false);
  });

  it("E21 — a full walk yields every session exactly once in 5 pages", () => {
    const rows = seed(103);
    const pages = walk(rows);
    expect(pages).toHaveLength(5);
    const ids = idsOf(pages);
    expect(ids).toHaveLength(103);
    expect(new Set(ids).size).toBe(103);
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.id)));
  });

  it("E22 — sessions sharing a sort key across a page boundary each appear once", () => {
    const rows = seed(30);
    // Recency-desc positions 24/25 are s-0004/s-0005; give them the same key so
    // the tie straddles the page-1/page-2 boundary.
    rows[5] = { ...rows[5], startedAt: rows[4].startedAt };
    const ids = idsOf(walk(rows));
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    expect(ids.filter((id) => id === rows[4].id)).toHaveLength(1);
    expect(ids.filter((id) => id === rows[5].id)).toHaveLength(1);
  });

  it("E23 — a non-finite sort key sorts last and does not corrupt the walk", () => {
    const rows = seed(100);
    rows[7] = { ...rows[7], startedAt: Number.NaN };
    const ids = idsOf(walk(rows));
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(ids[ids.length - 1]).toBe(rows[7].id);
  });
});

describe("X1–X4 — the walk tolerates concurrent mutation", () => {
  it("X1 — a session created mid-walk does not corrupt the walk", () => {
    const rows = seed(100);
    const page1 = listSessions(rows, { limit: 25 });
    // Registered between page 1 and page 2, older than the cursor so it is in range.
    rows.push(makeRow({ id: "late", cwd: "/proj", startedAt: 500 }));
    const ids = [...page1.sessions.map((s) => s.id), ...idsOf(walk(rows, {}, 25, page1.nextCursor))];
    expect(ids).toHaveLength(new Set(ids).size);
    expect(new Set(ids).size).toBe(101);
  });

  it("X2 — a session ended mid-walk does not duplicate or skip an UNRELATED row", () => {
    const rows = seed(100);
    const page1 = listSessions(rows, { limit: 25 });
    const mutated = page1.sessions[24];
    const idx = rows.findIndex((r) => r.id === mutated.id);
    // The walked row ends and its sort key moves behind the cursor.
    rows[idx] = { ...rows[idx], status: "ended", endedAt: 500 };
    const ids = [...page1.sessions.map((s) => s.id), ...idsOf(walk(rows, {}, 25, page1.nextCursor))];
    const unrelated = ids.filter((id) => id !== mutated.id);
    expect(new Set(unrelated).size).toBe(unrelated.length);
    expect(new Set(unrelated).size).toBe(99);
  });

  it("X3 — a session removed mid-walk does not corrupt the walk", () => {
    const rows = seed(100);
    const page1 = listSessions(rows, { limit: 25 });
    const page1Ids = new Set(page1.sessions.map((s) => s.id));
    const removed = rows.find((r) => !page1Ids.has(r.id));
    if (!removed) throw new Error("unreachable");
    rows.splice(
      rows.findIndex((r) => r.id === removed.id),
      1,
    );
    const ids = [...page1.sessions.map((s) => s.id), ...idsOf(walk(rows, {}, 25, page1.nextCursor))];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(removed.id);
    expect(new Set(ids).size).toBe(99);
  });

  it("X4 — removing the exact row the cursor names still resumes correctly", () => {
    const rows = seed(100);
    const page1 = listSessions(rows, { limit: 25 });
    const target = page1.sessions[24];
    rows.splice(
      rows.findIndex((r) => r.id === target.id),
      1,
    );
    const restIds = idsOf(walk(rows, {}, 25, page1.nextCursor));
    expect(new Set(restIds).size).toBe(restIds.length);
    expect(restIds).not.toContain(target.id);
    expect(restIds).toHaveLength(75);
  });
});
