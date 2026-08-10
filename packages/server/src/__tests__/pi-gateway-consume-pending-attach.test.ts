/**
 * Verifies the consume-on-register flow: when `applyAttachProposal` runs with
 * a pending intent's name, it (a) updates the session, (b) sends rename to
 * the bridge if `attachRenameTarget` returned a name, and (c) broadcasts
 * `session_updated`. Mirrors what `pi-gateway.onSessionRegistered` does in
 * `event-wiring.ts`.
 *
 * See change: add-folder-task-checker-and-spawn-attach.
 */
import { describe, it, expect, vi } from "vitest";
import { applyAttachProposal } from "../browser-handlers/session-meta-handler.js";
import { createPendingAttachRegistry } from "../pending/pending-attach-registry.js";

function makeCtx(initial?: { name?: string }) {
  const session = { id: "s99", cwd: "/p", name: initial?.name ?? "", attachedProposal: null };
  const updates: any[] = [];
  const broadcasts: any[] = [];
  const piSent: any[] = [];
  const ctx = {
    sessionManager: {
      get: () => session,
      update: (id: string, u: any) => {
        updates.push({ id, u });
        Object.assign(session, u);
      },
    },
    piGateway: {
      sendToSession: (id: string, msg: any) => { piSent.push({ id, msg }); return true; },
    },
    broadcast: (msg: any) => { broadcasts.push(msg); },
  } as any;
  return { ctx, updates, broadcasts, piSent, session };
}

describe("consume-on-register flow", () => {
  it("end-to-end: enqueue → consume → applyAttachProposal updates + broadcasts", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    reg.enqueue("/p", "add-foo");

    // Simulate session_register arriving for cwd /p with sessionId s99.
    const consumed = reg.consume("/p");
    expect(consumed).toBe("add-foo");

    const { ctx, updates, broadcasts, piSent } = makeCtx({ name: "" });
    applyAttachProposal("s99", consumed!, ctx);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("s99");
    expect(updates[0]!.u.attachedProposal).toBe("add-foo");
    // Empty/witness name → auto-rename fires.
    expect(updates[0]!.u.name).toBe("add-foo");
    expect(piSent).toHaveLength(2);
    expect(piSent[0]!.msg).toMatchObject({ type: "rename_session", sessionId: "s99", name: "add-foo" });
    expect(piSent[1]!.msg).toMatchObject({ type: "attach_proposal_changed", sessionId: "s99", attachedChange: "add-foo" });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!).toMatchObject({
      type: "session_updated",
      sessionId: "s99",
      updates: { attachedProposal: "add-foo", name: "add-foo" },
    });
  });

  it("no intent in queue → no-op (regression: register without intent must not attach)", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    expect(reg.consume("/p")).toBeNull();
    // Caller short-circuits and never calls applyAttachProposal — verified by
    // event-wiring.ts conditional. This test just pins the contract that
    // consume returns null for an empty queue, which is what the wiring relies
    // on to skip the call.
  });

  it("cwd normalization between enqueue and consume", () => {
    const reg = createPendingAttachRegistry({
      normalize: (s) => s.replace(/[/\\]+$/, ""),
      warn: () => {},
    });
    reg.enqueue("/proj/", "add-bar");
    // Bridge sends back cwd without trailing slash.
    expect(reg.consume("/proj")).toBe("add-bar");
  });

  it("only one intent consumed per register call", () => {
    const reg = createPendingAttachRegistry({ normalize: (s) => s, warn: () => {} });
    reg.enqueue("/p", "a");
    reg.enqueue("/p", "b");
    expect(reg.consume("/p")).toBe("a");
    expect(reg.size("/p")).toBe(1);
    expect(reg.consume("/p")).toBe("b");
  });

  it("session with explicit user-set name keeps it (idempotent rename short-circuits)", () => {
    const { ctx, updates, piSent } = makeCtx({ name: "my-custom-name" });
    applyAttachProposal("s99", "add-foo", ctx);
    expect(updates[0]!.u.attachedProposal).toBe("add-foo");
    // attachRenameTarget returns undefined when name is non-empty/non-witness,
    // so no rename_session — but the attach_proposal_changed bridge push still fires.
    expect("name" in updates[0]!.u).toBe(false);
    expect(piSent).toHaveLength(1);
    expect(piSent[0]!.msg).toMatchObject({ type: "attach_proposal_changed", sessionId: "s99", attachedChange: "add-foo" });
  });

  it("calling applyAttachProposal twice with same name is idempotent", () => {
    const { ctx, updates, piSent } = makeCtx({ name: "" });
    applyAttachProposal("s99", "add-foo", ctx);
    applyAttachProposal("s99", "add-foo", ctx);
    // First call sets name="add-foo"; second call sees name===attachedProposal
    // (witness equality holds) and the rename helper returns the same target —
    // safe to re-emit, but the session state is unchanged.
    expect(updates).toHaveLength(2);
    // Both broadcasts include attachedProposal:"add-foo"; second is a no-op
    // from a state perspective.
    expect(updates.every((u) => u.u.attachedProposal === "add-foo")).toBe(true);
    expect(piSent.length).toBeGreaterThanOrEqual(1);
  });
});
