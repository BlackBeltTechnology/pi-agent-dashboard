/**
 * Dispatcher invariant (change: add-chat-gateway-team-controls, task 3.14).
 *
 * X11: "no path reaches a session without a Grant". `dispatchToSession` requires
 * the grant as an argument and refuses at runtime when the layer is installed
 * and the grant is absent — so even a call that bypasses the type (`as any`)
 * affects no session.
 */
import { describe, expect, it } from "vitest";
import { dispatchToSession } from "../dispatch.js";
import { CHAT_COMMAND_ALLOWLIST } from "../team/tier.js";
import { createFakeSeam } from "./fake-seam.js";

describe("dispatchToSession — the only path to a session (X11)", () => {
  it("affects no session for ANY action verb when the layer is installed and no grant is passed", () => {
    const seam = createFakeSeam();
    seam.sessions.push({ id: "s1", cwd: "/repo", status: "active" });

    for (const verb of CHAT_COMMAND_ALLOWLIST) {
      // Bypass the type exactly as a forgetful call site would.
      const res = dispatchToSession(
        seam,
        { teamControlled: true } as never,
        { sessionId: "s1", text: verb, delivery: "followUp" },
      );
      expect(res).toEqual({ ok: false, reason: "missing_grant" });
    }

    // Nothing reached the session, for any verb.
    expect(seam.sentPrompts).toHaveLength(0);
  });

  it("refuses a non-grant payload even when the layer is installed", () => {
    const seam = createFakeSeam();
    seam.sessions.push({ id: "s1", cwd: "/repo", status: "active" });
    const res = dispatchToSession(
      seam,
      { teamControlled: true, grant: { kind: "refusal", reason: "disarmed", verb: "send_prompt" } as never },
      { sessionId: "s1", text: "hi", delivery: "followUp" },
    );
    expect(res).toEqual({ ok: false, reason: "missing_grant" });
    expect(seam.sentPrompts).toHaveLength(0);
  });

  it("drives the session when a grant is present", () => {
    const seam = createFakeSeam();
    seam.sessions.push({ id: "s1", cwd: "/repo", status: "active" });
    const res = dispatchToSession(
      seam,
      {
        teamControlled: true,
        grant: {
          kind: "grant",
          tier: "control",
          verb: "send_prompt",
          binding: { workspaceId: "ws_1", folders: ["/repo"], principals: {}, roles: {} },
        },
      },
      { sessionId: "s1", text: "hi", delivery: "followUp" },
    );
    expect(res).toEqual({ ok: true });
    expect(seam.sentPrompts).toEqual([{ sessionId: "s1", text: "hi", delivery: "followUp" }]);
  });

  it("drives the session with no grant when the layer is not installed (L1/L2 already gated it)", () => {
    const seam = createFakeSeam();
    seam.sessions.push({ id: "s1", cwd: "/repo", status: "active" });
    const res = dispatchToSession(
      seam,
      { teamControlled: false },
      { sessionId: "s1", text: "hi", delivery: "followUp" },
    );
    expect(res).toEqual({ ok: true });
    expect(seam.sentPrompts).toHaveLength(1);
  });
});
