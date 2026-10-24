/**
 * WO-A (change: leaf-only-helpers) 1.3 — POST /api/session/:id/prompt accepts an
 * optional prompt `mode` ("steer" | "followUp", default "followUp") and carries
 * it on the bridge `send_prompt` as `delivery`, which is the field the bridge
 * already maps to pi's `deliverAs` (idle send) or to the steer/follow-up routing
 * while streaming. An invalid mode is a 400 and nothing is sent.
 */
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { registerSessionApi } from "../session/session-api.js";

function build() {
  const sent: any[] = [];
  const app = Fastify();
  const sessionManager = createMemorySessionManager();
  sessionManager.register({ id: "s1", cwd: "/w", source: "tui", startedAt: Date.now() } as never);
  registerSessionApi(app, {
    sessionManager,
    piGateway: { sendToSession: (_id: string, msg: any) => { sent.push(msg); return true; } } as never,
    browserGateway: { headlessPidRegistry: { register: vi.fn() } } as never,
  });
  return { app, sent };
}

describe("POST /api/session/:id/prompt mode", () => {
  let harness: ReturnType<typeof build>;
  beforeEach(() => {
    harness = build();
  });

  it('mode "steer" reaches send_prompt as delivery:"steer"', async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/session/s1/prompt",
      payload: { text: "hold on", mode: "steer" },
    });
    expect(res.statusCode).toBe(200);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({ type: "send_prompt", sessionId: "s1", text: "hold on", delivery: "steer" });
  });

  it("no mode ⇒ delivery:\"followUp\" (today's default: buffered while streaming)", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/session/s1/prompt",
      payload: { text: "after you" },
    });
    expect(res.statusCode).toBe(200);
    expect(harness.sent[0]).toMatchObject({ type: "send_prompt", delivery: "followUp" });
  });

  it("an invalid mode is a 400 and nothing is sent", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/session/s1/prompt",
      payload: { text: "nope", mode: "immediately" },
    });
    expect(res.statusCode).toBe(400);
    expect(harness.sent).toHaveLength(0);
  });
});
