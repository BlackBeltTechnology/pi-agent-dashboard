/**
 * Bridge `spawn_new_session` carries model/thinking through the shared resolver.
 * test-plan: E29. See change: add-spawn-model-choice.
 * Exemplar: event-wiring-is-git-repo.test.ts (real server + pi WS).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnPiSession: spawn,
}));
vi.mock("../spawn-process/spawn-register-watchdog.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  armSpawnWatchdog: vi.fn(),
}));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: spawn_new_session model inheritance", () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("E29: model + thinkingLevel reach spawnPiSession", async () => {
    spawn.mockResolvedValue({ success: true, message: "ok" });
    const { createServer } = await import("../server.js");
    const server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    stop = () => server.stop();
    const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => resolve());
    });
    ws.send(
      JSON.stringify({
        type: "spawn_new_session",
        sessionId: "s1",
        cwd: "/p",
        model: "anthropic/claude-sonnet-5-5",
        thinkingLevel: "medium",
      }),
    );
    for (let i = 0; i < 50 && spawn.mock.calls.length === 0; i++) await wait(20);
    ws.close();
    expect(spawn).toHaveBeenCalledWith(
      "/p",
      expect.objectContaining({ model: "anthropic/claude-sonnet-5-5", thinking: "medium" }),
    );
  });
});
