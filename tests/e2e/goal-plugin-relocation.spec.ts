import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT, PI_GATEWAY_PORT } from "./lifecycle.js";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { FIXTURE_GIT } from "./helpers/index.js";
import { WebSocket } from "ws";

/**
 * L3 — goal product hosted by goal-plugin (relocate-goal-product-to-plugin).
 *
 * Drives the REAL plugin-hosted goal surface against the Docker harness
 * (headless REST/WS — same shape as bus-client-goal-plugin-action.spec.ts).
 *
 * Covers test-plan #F1 (create + spawn convergence), #F2 (supervisor respawn
 * after driver death), #F4 (unlink clears memory + .meta.json + driver),
 * #F5 (goal_status verdict persistence over a bridge-ticket socket; wire keys
 * byte-identical). #F3 (keeper restart does not re-prime) is covered by the
 * keeper-restart glue + plugin-goal-handover L1 spec; #F6 stays manual-only.
 *
 * Byte-identical contract under test: REST paths `/api/folders/goals*`,
 * `.meta.json` keys, `goals_update` / `goal_status` wire types.
 */

const GOALS = (cwd: string) => `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`;

/** Resolve the harness container from the published dashboard port (skill pattern). */
function harnessContainer(): string {
  const out = execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`).toString().trim();
  expect(out, "harness container must be running on the derived port").toBeTruthy();
  return out;
}

/** Mint a single-use bridge WS ticket from INSIDE the container (loopback). */
function mintBridgeTicket(container: string): string {
  const raw = execSync(
    `docker exec ${container} curl -s -X POST http://127.0.0.1:${DASHBOARD_PORT}/api/ws-ticket -H 'content-type: application/json' -d '{"scope":"bridge"}'`,
  ).toString();
  const parsed = JSON.parse(raw) as { success: boolean; data?: { ticket: string } };
  expect(parsed.success, raw).toBe(true);
  return parsed.data!.ticket;
}

/** Read a file that only exists inside the harness container. */
function readInContainer(container: string, file: string): string | null {
  try {
    return execSync(`docker exec ${container} cat ${JSON.stringify(file)}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString();
  } catch {
    return null;
  }
}

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
  sessionFile?: string;
}

async function sessions(): Promise<SessionRow[]> {
  const { json } = await api<{ data?: SessionRow[] }>("GET", "/api/sessions");
  return json.data ?? [];
}

async function goals(cwd: string): Promise<Array<Record<string, any>>> {
  const { json } = await api<{ data?: Array<Record<string, any>> }>("GET", GOALS(cwd));
  return json.data ?? [];
}

/** Spawn a REAL harness session so `cwd` enters the known-folder set. */
async function ensureKnownCwd(client: BusClient, cwd: string): Promise<void> {
  const known = await sessions();
  if (known.some((s) => s.cwd === cwd)) return;
  const requestId = crypto.randomUUID();
  const result = client.await({ type: "spawn_result" }, { timeout: 45_000 });
  client.send({ type: "spawn_session", cwd, requestId });
  const res = (await result) as { success?: boolean; message?: string };
  expect(res.success, String(res.message ?? "")).toBe(true);
  await pollUntil(
    async () => (await sessions()).some((s) => s.cwd === cwd),
    (v) => v,
    45_000,
  );
}

test.describe("goal product hosted by goal-plugin (relocation L3)", () => {
  test.setTimeout(300_000);

  test("#F1 create + spawn converges; #F4 unlink clears every layer", async () => {
    const container = harnessContainer();
    const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
    await client.connect();
    await ensureKnownCwd(client, FIXTURE_GIT);

    const created = await api("POST", GOALS(FIXTURE_GIT), { objective: "relocation F1: pursue", autoRespawn: true });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const goalId = created.json.data.id as string;
    try {
      // spawn:true → the plugin spawns a headless driver via ctx.spawnSession.
      const linked = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(FIXTURE_GIT)}`, {
        spawn: true,
      });
      expect(linked.status, JSON.stringify(linked.json)).toBe(200);

      // Converge: one session carries the goalId and the goal names it driver.
      const driverId = await pollUntil(
        async () => (await sessions()).find((s) => s.goalId === goalId)?.id ?? null,
        (id) => id !== null,
        120_000,
      );
      const record = await pollUntil(
        async () => (await goals(FIXTURE_GIT)).find((g) => g.id === goalId),
        (g) => g?.driverSessionId === driverId,
        30_000,
      );
      expect(record!.status).toBe("pursuing");

      // The driver's `.meta.json` sidecar carries the goalId (in-container).
      const row = (await sessions()).find((s) => s.id === driverId);
      if (row?.sessionFile) {
        const metaFile = row.sessionFile.replace(/\.jsonl$/, ".meta.json");
        const meta = readInContainer(container, metaFile);
        expect(meta, `meta sidecar at ${metaFile}`).toBeTruthy();
        expect(JSON.parse(meta!).goalId).toBe(goalId);
      }

      // #F4 unlink: REST clears memory + .meta.json + the goal's driver.
      const unlinked = await api(
        "DELETE",
        `/api/folders/goals/${goalId}/sessions/${driverId}?cwd=${encodeURIComponent(FIXTURE_GIT)}`,
      );
      expect(unlinked.status, JSON.stringify(unlinked.json)).toBe(200);
      await pollUntil(
        async () => (await sessions()).find((s) => s.id === driverId)?.goalId,
        (v) => v === undefined,
        30_000,
      );
      const afterUnlink = (await goals(FIXTURE_GIT)).find((g) => g.id === goalId);
      expect(afterUnlink?.driverSessionId ?? null).toBeNull();
      if (row?.sessionFile) {
        const meta = readInContainer(container, row.sessionFile.replace(/\.jsonl$/, ".meta.json"));
        if (meta) expect(JSON.parse(meta).goalId).toBeUndefined();
      }
    } finally {
      await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
      client.close();
    }
  });

  test("#F2 supervisor respawn replaces a dead driver under the same goalId", async () => {
    const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
    await client.connect();
    await ensureKnownCwd(client, FIXTURE_GIT);

    const created = await api("POST", GOALS(FIXTURE_GIT), { objective: "relocation F2: survive death", autoRespawn: true });
    expect(created.status).toBe(201);
    const goalId = created.json.data.id as string;
    try {
      const linked = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(FIXTURE_GIT)}`, {
        spawn: true,
      });
      expect(linked.status).toBe(200);
      const firstDriver = (await pollUntil(
        async () => (await sessions()).find((s) => s.goalId === goalId)?.id ?? null,
        (id) => id !== null,
        120_000,
      )) as string;

      // Kill the driver over the browser bus. `shutdown` kills the process
      // (abort asks pi to stop at turn end — no death); the supervisor needs
      // a real driver death to classify + respawn.
      client.send({ type: "shutdown", sessionId: firstDriver });

      // FIRM — the goal product's own contract: the death is classified, a
      // respawn is RECORDED on the goal (reason + fresh token minted + the
      // in-flight stamp advanced) and the old driver's in-memory goalId is
      // gone. Server log corroboration: "[goal-supervisor] respawn spawned".
      await pollUntil(
        async () => {
          const rec = (await goals(FIXTURE_GIT)).find((g) => g.id === goalId);
          // Death classification: respawn recorded (reason + fresh token in
          // the in-flight stamp), status respawning, driver id NOT yet
          // replaced (only a REGISTER clears/replaces it).
          return (
            rec !== undefined &&
            Array.isArray(rec.respawns) &&
            rec.respawns.length > 0 &&
            rec.status === "respawning" &&
            rec.driverSessionId === firstDriver &&
            typeof rec.inFlightSpawn?.spawnToken === "string"
          );
        },
        (v) => v,
        120_000,
      );
      const respawnToken = (await goals(FIXTURE_GIT)).find((g) => g.id === goalId)!.inFlightSpawn!
        .spawnToken as string;

      // FIRM step 2 — the respawned DRIVER converges. The supervisor's
      // in-harness resume spawn does not complete pi registration (faux-model
      // limitation, watchdog-verified), so the test completes the register
      // handshake FOR it over a bridge socket, using the very token the
      // supervisor persisted. This exercises the production register path
      // end-to-end: token→ref resolution → onSessionResolved → replaceDriver
      // → new session id with the SAME goalId → primer once → the old
      // driver's in-memory goalId cleared (C2e).
      const container = harnessContainer();
      const ticket = mintBridgeTicket(container);
      const respWs = new WebSocket(`ws://127.0.0.1:${PI_GATEWAY_PORT}/?ticket=${encodeURIComponent(ticket)}`);
      await new Promise<void>((resolve, reject) => {
        respWs.on("open", () => resolve());
        respWs.on("error", reject);
      });
      const respFrames: Array<Record<string, unknown>> = [];
      respWs.on("message", (raw) => {
        try {
          respFrames.push(JSON.parse(String(raw)) as Record<string, unknown>);
        } catch { /* non-JSON */ }
      });
      const respSessionId = `goal-f2-resp-${crypto.randomUUID().slice(0, 8)}`;
      respWs.send(
        JSON.stringify({
          type: "session_register",
          sessionId: respSessionId,
          cwd: FIXTURE_GIT,
          source: "cli",
          spawnToken: respawnToken,
        }),
      );

      await pollUntil(
        async () => {
          const rows = await sessions();
          const next = rows.find((s) => s.id === respSessionId);
          const old = rows.find((s) => s.id === firstDriver);
          const rec = (await goals(FIXTURE_GIT)).find((g) => g.id === goalId);
          return (
            next?.goalId === goalId &&
            rec?.driverSessionId === respSessionId &&
            old?.goalId === undefined
          );
        },
        (v) => v,
        60_000,
      );
      const finalRecord = (await goals(FIXTURE_GIT)).find((g) => g.id === goalId)!;
      expect(finalRecord.driverSessionId).not.toBe(firstDriver);
      expect(finalRecord.driverSessionId).toBeTruthy();
      // Status: `pursuing` right after the handover — or `respawning` again
      // if the harness's resumed pi crashed AFTER the handover (its death is
      // then correctly re-classified under the same goal; both are sound).
      expect(["pursuing", "respawning"]).toContain(finalRecord.status);
      // Primer on the respawned driver exactly once.
      const respPrimes = respFrames.filter(
        (f) => f.type === "send_prompt" && String(f.text ?? "").startsWith("/goal"),
      );
      expect(respPrimes).toHaveLength(1);
      respWs.close();
    } finally {
      await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
      client.close();
    }
  });

  test("#F5 goal_status verdict persists through the synthetic bridge; wire type unchanged", async () => {
    const container = harnessContainer();

    // Bridge-scope ticket: single-use, 15s — mint and dial promptly.
    const ticket = mintBridgeTicket(container);
    const ws = new WebSocket(`ws://127.0.0.1:${PI_GATEWAY_PORT}/?ticket=${encodeURIComponent(ticket)}`);
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

    const sessionId = `goal-f5-${crypto.randomUUID().slice(0, 8)}`;
    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: FIXTURE_GIT,
        source: "cli",
      }),
    );
    await new Promise((r) => setTimeout(r, 400));

    try {
      const created = await api("POST", GOALS(FIXTURE_GIT), { objective: "relocation F5: verdict" });
      expect(created.status).toBe(201);
      const goalId = created.json.data.id as string;

      // Link the synthetic session (in-memory + .meta.json + broadcast).
      const link = await api("POST", `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(FIXTURE_GIT)}`, {
        sessionId,
      });
      expect(link.status).toBe(200);

      // Synthetic goal_status snapshots from the "driver" — the accumulator
      // derives the verdict kind from payload.status ("active" → "continue")
      // and advances on lastVerdict/turnsUsed.
      for (const [turns, verdict] of [[1, "pass"], [2, "pass"], [3, "fail"]] as const) {
        // The bridge envelopes custom extension messages in `plugin_pi_message`.
        ws.send(
          JSON.stringify({
            type: "plugin_pi_message",
            messageType: "goal_status",
            sessionId,
            payload: { status: "active", turnsUsed: turns, lastVerdict: verdict },
          }),
        );
        await new Promise((r) => setTimeout(r, 150));
      }
      const record = await pollUntil(
        async () => (await goals(FIXTURE_GIT)).find((g) => g.id === goalId),
        (g) => Array.isArray(g?.verdicts) && g.verdicts.length >= 2,
        30_000,
      );
      // Wire keys byte-identical to the pre-relocation consumer contract.
      expect(record!.status).toBe("pursuing");
      expect(record!.totalTurnsUsed).toBe(3);
      expect(record!.verdicts.at(-1)?.verdict).toBe("continue");

      await api("DELETE", `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
    } finally {
      ws.send(JSON.stringify({ type: "session_unregister", sessionId }));
      ws.close();
    }
  });
});
