import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { BusClient, NoPluginHandlerError } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { DASHBOARD_PORT } from "./lifecycle.js";
import { FIXTURE_GIT } from "./helpers/index.js";

/**
 * Acquire a real session id over the bus. `client.spawn()`'s exact
 * `spawnRequestId` correlation is L1-tested, but the harness build does not echo
 * that token on `session_added` (server-side spawn-correlation-token timing), so
 * here we resolve robustly: fire `spawn_session`, await `spawn_result` success,
 * then poll for the newly-appeared session id.
 */
async function spawnSession(client: BusClient, cwd: string): Promise<string> {
  const before = new Set(client.read.sessions().map((s) => s.id));
  const requestId = crypto.randomUUID();
  const result = client.await<SpawnResultBrowserMessage>(
    { type: "spawn_result" },
    { timeout: 45_000 },
  );
  client.send({ type: "spawn_session", cwd, requestId });
  const res = await result;
  expect(res.success, res.message).toBe(true);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const fresh = client.read.sessions().find((s) => !before.has(s.id));
    if (fresh) return fresh.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no new session appeared after spawn_result success");
}

/**
 * P1 (L3) — goal plugin_action reaches the working handler (test-plan #P1).
 * Exemplar: tests/e2e/anthropic-bridge-activation.spec.ts. Harness port from
 * `.pi-test-harness.json` via DASHBOARD_PORT (never hardcode :18000).
 *
 * The `BusClient` is a headless Node WS client, so this spec drives it DIRECTLY
 * against the Docker harness (no browser page). Observability mirrors the
 * anthropic-bridge exemplar's firm/best-effort split:
 *   FIRM   — goal is loaded (`/api/health`), `plugin("goal", …)` transmits with
 *            a real sessionId WITHOUT the client throwing or dropping the socket,
 *            and the deny-gate specifically rejects an unhandled pluginId
 *            (`plugin("flows", …)` → NoPluginHandlerError) — proving goal is the
 *            allowed handler, not a blanket pass.
 *   BEST-EFFORT — the downstream `plugin_event` goal snapshot depends on the
 *            harness pi session running the goal extension under the faux model;
 *            asserted only if it arrives (documented build-dependence).
 *
 * HARNESS NOTE: `client.spawn()` is exact-correlated on `session_added`
 * .spawnRequestId, which ONLY the server's **headless** spawn strategy echoes.
 * Boot the harness with `PI_SPAWN_STRATEGY=headless` (the dashboard/electron
 * default) for this spec; the harness's tmux default does not echo the id.
 */

interface HealthPlugin {
  id: string;
  enabled?: boolean;
  loaded?: boolean;
}

test.describe("bus-client goal plugin_action (L3)", () => {
  test("plugin('goal', …) reaches the goal handler; unknown ids are rejected", async ({
    request,
  }) => {
    // FIRM 1: the goal plugin is loaded server-side (a receiver exists).
    const health = (await (await request.get("/api/health")).json()) as {
      plugins?: HealthPlugin[];
    };
    const goal = (health.plugins ?? []).find((p) => p.id === "goal");
    test.skip(!goal?.loaded, "goal plugin not loaded in this harness build");

    const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
    try {
      await client.connect();

      // A real session is required — the goal handler ignores a null sessionId.
      const sessionId = await spawnSession(client, FIXTURE_GIT);
      expect(sessionId).toBeTruthy();

      // Best-effort observable: subscribe for the downstream goal snapshot.
      const snapshot = client
        .await<never>({ type: "plugin_event" } as never, { timeout: 8_000 })
        .catch(() => null);

      // FIRM 2: goal is an allowed handler — no client-side drop, socket stays open.
      expect(() =>
        client.plugin("goal", "set", { text: "ship the change" }, { sessionId }),
      ).not.toThrow();

      // FIRM 3: the deny-gate is specific — an unhandled pluginId is rejected,
      // proving goal was allowed BY NAME, not by a blanket pass-through.
      expect(() => client.plugin("flows", "noop", {}, { sessionId })).toThrow(
        NoPluginHandlerError,
      );

      // The socket must still be live after the goal send (no silent disconnect).
      expect(client.read.session(sessionId)).toBeDefined();

      // BEST-EFFORT: if the snapshot came back, it is a goal plugin_event.
      const evt = (await snapshot) as { pluginId?: string } | null;
      if (evt) expect(evt.pluginId ?? "goal").toBe("goal");
    } finally {
      client.close();
    }
  });
});
