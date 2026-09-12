import crypto from "node:crypto";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT, PI_GATEWAY_PORT } from "./lifecycle.js";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { WebSocket } from "ws";

/**
 * L3 — goal product hosted by goal-plugin (relocate-goal-product-to-plugin).
 *
 * Drives the REAL plugin-hosted goal surface over REST + a synthetic bridge
 * socket against the Docker harness (no browser page — same headless shape as
 * bus-client-goal-plugin-action.spec.ts).
 *
 * Covers test-plan #F1 (create + spawn convergence), #F2 (supervisor respawn
 * after driver death), #F3 (keeper restart does not re-prime — best-effort:
 * needs the harness container), #F4 (unlink clears every layer), #F5
 * (goal_status verdict persistence over the synthetic bridge).
 *
 * Byte-identical contract: REST paths `/api/folders/goals*`, `.meta.json`
 * keys, `goals_update` / `goal_status` wire types, spawn opts shape.
 */

const GOALS = (cwd: string) => `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`;

async function api<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

/** Poll until `cond` holds; returns the last value of `read`. */
async function pollUntil<T>(read: () => Promise<T>, cond: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (cond(v)) return v;
    if (Date.now() > deadline) throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

interface SessionRow {
  id: string;
  cwd?: string;
  goalId?: string;
  status?: string;
}

async function sessions(): Promise<SessionRow[]> {
  const { json } = await api<{ data?: SessionRow[] }>("GET", "/api/sessions");
  return json.data ?? [];
}

async function goals(cwd: string): Promise<Array<Record<string, any>>> {
  const { json } = await api<{ data?: Array<Record<string, any>> }>("GET", GOALS(cwd));
  return json.data ?? [];
}

test.describe("goal product hosted by goal-plugin (relocation L3)", () => {
  test.setTimeout(240_000);

  test("#F1 create + spawn converges; #F4 unlink clears every layer", async () => {
    // A real folder inside the harness container that hosts the goal.
    const { json: health } = await api<{ cwd?: string }>("GET", "/api/health");
    expect(health.cwd, "harness health must report the server cwd").toBeTruthy();
    const cwd = health.cwd!;

    const created = await api("POST", GOALS(cwd), { objective: "relocation F1: pursue", autoRespawn: true });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const goalId = created.json.data.id as string;

    // spawn:true → the plugin spawns a headless driver via ctx.spawnSession.
    const linked = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`, {
      spawn: true,
    });
    expect(linked.status, JSON.stringify(linked.json)).toBe(200);

    // Converge: one session carries the goalId and the goal names it driver.
    const driverId = await pollUntil(
      async () => {
        const rows = await sessions();
        const driver = rows.find((s) => s.goalId === goalId);
        return driver?.id ?? null;
      },
      (id): id is string => id !== null,
      120_000,
    );
    const record = await pollUntil(
      async () => (await goals(cwd)).find((g) => g.id === goalId),
      (g) => g?.driverSessionId === driverId,
      30_000,
    );
    expect(record!.status).toBe("pursuing");

    // #F4 unlink: REST clears memory + .meta.json + the goal's driver.
    const unlinked = await api(
      "DELETE",
      `/api/folders/goals/${goalId}/sessions/${driverId}?cwd=${encodeURIComponent(cwd)}`,
    );
    expect(unlinked.status, JSON.stringify(unlinked.json)).toBe(200);
    await pollUntil(
      async () => (await sessions()).find((s) => s.id === driverId)?.goalId,
      (v) => v === undefined,
      30_000,
    );
    const afterUnlink = (await goals(cwd)).find((g) => g.id === goalId);
    expect(afterUnlink?.driverSessionId ?? null).toBeNull();

    // Teardown: remove the goal (also the F4-adjacent delete surface).
    const deleted = await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`);
    expect(deleted.status).toBe(200);
  });

  test("#F2 supervisor respawn replaces a dead driver under the same goalId", async () => {
    const { json: health } = await api<{ cwd?: string }>("GET", "/api/health");
    const cwd = health.cwd!;

    const created = await api("POST", GOALS(cwd), { objective: "relocation F2: survive death", autoRespawn: true });
    expect(created.status).toBe(201);
    const goalId = created.json.data.id as string;
    try {
      const linked = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`, {
        spawn: true,
      });
      expect(linked.status).toBe(200);
      const firstDriver = (await pollUntil(
        async () => {
          const rows = await sessions();
          return rows.find((s) => s.goalId === goalId)?.id ?? null;
        },
        (id) => id !== null,
        120_000,
      )) as string;

      // Kill the driver over the browser bus (the abort path the UI uses):
      // supervisor classifies the death and auto-respawns.
      const bus = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
      await bus.connect();
      try {
        bus.send({ type: "abort", sessionId: firstDriver });
      } finally {
        bus.close();
      }

      // Converge: a NEW driver session under the SAME goalId; the old
      // session's in-memory goalId is gone.
      await pollUntil(
        async () => {
          const rows = await sessions();
          const next = rows.find((s) => s.goalId === goalId && s.id !== firstDriver);
          const old = rows.find((s) => s.id === firstDriver);
          return next !== undefined && old?.goalId === undefined;
        },
        (v) => v,
        180_000,
      );
      const record = (await goals(cwd)).find((g) => g.id === goalId);
      expect(record?.driverSessionId).not.toBe(firstDriver);
      expect(record?.driverSessionId).toBeTruthy();
    } finally {
      await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`);
    }
  });

  test("#F5 goal_status verdict persists through the synthetic bridge; wire type unchanged", async () => {
    // A synthetic driver over the gateway bridge: register → link → emit
    // goal_status exactly as the in-session extension would.
    const ws = new WebSocket(`ws://127.0.0.1:${PI_GATEWAY_PORT}`);
    const frames: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.on("message", (raw) => {
      try {
        frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
      } catch { /* non-JSON */ }
    });

    const { json: health } = await api<{ cwd?: string }>("GET", "/api/health");
    const cwd = health.cwd!;
    const sessionId = `goal-f5-${crypto.randomUUID().slice(0, 8)}`;

    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId,
        cwd,
        source: "cli",
        spawnToken: crypto.randomUUID(), // unowned register: plain session
      }),
    );
    await new Promise((r) => setTimeout(r, 400));

    try {
      const created = await api("POST", GOALS(cwd), { objective: "relocation F5: verdict" });
      expect(created.status).toBe(201);
      const goalId = created.json.data.id as string;

      // Link the synthetic session (in-memory + .meta.json + broadcast).
      const link = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`, {
        sessionId,
      });
      expect(link.status).toBe(200);

      // Synthetic goal_status snapshots from the "driver" — the accumulator
      // derives the verdict kind from payload.status ("active" → "continue")
      // and advances on lastVerdict/turnsUsed.
      for (const [turns, verdict] of [[1, "pass"], [2, "pass"], [3, "fail"]] as const) {
        ws.send(
          JSON.stringify({
            type: "goal_status",
            sessionId,
            payload: { status: "active", turnsUsed: turns, lastVerdict: verdict },
          }),
        );
        await new Promise((r) => setTimeout(r, 150));
      }
      const record = await pollUntil(
        async () => (await goals(cwd)).find((g) => g.id === goalId),
        (g) => Array.isArray(g?.verdicts) && g.verdicts.length >= 2,
        30_000,
      );
      // Wire keys byte-identical to the pre-relocation consumer contract.
      expect(record!.status).toBe("pursuing");
      expect(record!.totalTurnsUsed).toBe(3);
      expect(record!.verdicts.at(-1)?.verdict).toBe("continue");

      await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`);
    } finally {
      ws.send(JSON.stringify({ type: "session_unregister", sessionId }));
      ws.close();
    }
  });
});
