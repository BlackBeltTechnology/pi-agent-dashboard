/**
 * Defense-in-depth at the auto-attach rename site (event-wiring.ts).
 *
 * The detector (`detectOpenSpecActivity`) already rejects non-slug-shaped
 * change names after fix-uuid-rename-bug. This file tests the second layer:
 * even if a future detector regression returns a junk `changeName`, the
 * auto-attach branch in `event-wiring.ts` MUST refuse to mutate session state
 * or send `rename_session`.
 *
 * Approach: mock `detectOpenSpecActivity` to return a UUID-shaped result,
 * drive a tool_execution_start event end-to-end, assert no mutation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-activity-detector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-activity-detector.js")>();
  return {
    ...actual,
    detectOpenSpecActivity: vi.fn(() => ({
      changeName: "019df0aa-1234-5678-9abc-def012345678",
      isActive: true,
    })),
  };
});

// Imported AFTER vi.mock so the server picks up the mocked module.
const { createServer } = await import("../server.js");

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 50);
    });
  });
  return ws;
}

describe("Auto-attach defense-in-depth: rename site rejects non-slug changeName", () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let piPort: number;
  let browserPort: number;
  let ws: WebSocket;
  const piMessages: any[] = [];

  beforeEach(async () => {
    piMessages.length = 0;
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
    ws = await connectSession(piPort, "s1");
    ws.on("message", (raw) => {
      try { piMessages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
  });

  afterEach(async () => {
    ws.close();
    await server.stop();
  });

  it("does NOT mutate openspecChange / attachedProposal / name when detector returns a UUID", async () => {
    // Any tool_execution_start triggers the (mocked) detector. Path content is
    // irrelevant — the mock ignores its inputs and returns a UUID changeName.
    ws.send(JSON.stringify({
      type: "event_forward",
      sessionId: "s1",
      event: {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolName: "Write", args: { path: "openspec/changes/add-auth/proposal.md" } },
      },
    }));
    await new Promise((r) => setTimeout(r, 100));

    const session = server.sessionManager.get("s1");
    expect(session?.openspecChange).toBeFalsy();
    expect(session?.attachedProposal).toBeFalsy();
    expect(session?.name).toBeFalsy();

    const renameSent = piMessages.some((m) => m.type === "rename_session");
    expect(renameSent).toBe(false);
  });
});
