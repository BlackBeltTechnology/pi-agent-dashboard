/**
 * `GET /api/auto-name-outcomes` — the discoverable route to a naming stop.
 *
 * A permanent stop can be latched while NO client is subscribed: the
 * `auto_name_error` toast reaches only a connected browser and the diagnostic
 * line only the server host. Without this route the operator's sole recourse
 * is `server.log`, which is exactly the invisibility this change exists to end.
 *
 * See change: fix-auto-naming-reasoning-model (design D9, test-plan #F10).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoNameOutcomes } from "../auto-name-outcome-store.js";
import { createServer, type DashboardServer } from "../server.js";

describe("GET /api/auto-name-outcomes", () => {
  let server: DashboardServer;
  let browserPort: number;

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("F10: serves a stop recorded with no subscribed client", async () => {
    autoNameOutcomes.record({
      sessionId: "unwatched-session",
      outcome: "stopped",
      reason: "auto-naming stopped after 3 attempts: the model could not emit a title",
      modelRef: "deepseek/deepseek-v4-flash",
      at: Date.now(),
    });

    const res = await fetch(`http://127.0.0.1:${browserPort}/api/auto-name-outcomes`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    const row = body.outcomes.find((o: any) => o.sessionId === "unwatched-session");
    expect(row).toMatchObject({
      outcome: "stopped",
      modelRef: "deepseek/deepseek-v4-flash",
    });
    expect(row.reason).toMatch(/could not emit a title/);
  });

  it("answers with an empty list rather than failing when nothing is retained", async () => {
    const res = await fetch(`http://127.0.0.1:${browserPort}/api/auto-name-outcomes`);
    expect(res.ok).toBe(true);
    expect(Array.isArray((await res.json()).outcomes)).toBe(true);
  });
});
