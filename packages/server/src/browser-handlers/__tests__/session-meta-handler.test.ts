/**
 * Tests for handleAttachProposal / handleDetachProposal.
 * See change: fix-mobile-attach-proposal-display.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionManager, type SessionManager } from "../../session/memory-session-manager.js";
import type { BrowserHandlerContext } from "../handler-context.js";
import { handleAttachProposal, handleDetachProposal, handleRemoveTagGlobally, handleSetSessionProcessDrawer, handleSetSessionTags, pushAttachProposalChanged } from "../session-meta-handler.js";

interface PiSent {
  sessionId: string;
  msg: unknown;
}
interface Broadcast {
  type: string;
  sessionId: string;
  updates: Record<string, unknown>;
}

function makeCtx(sessionManager: SessionManager) {
  const piSends: PiSent[] = [];
  const broadcasts: Broadcast[] = [];

  const ctx = {
    sessionManager,
    piGateway: {
      sendToSession(sessionId: string, msg: unknown) {
        piSends.push({ sessionId, msg });
      },
    },
    broadcast(msg: any) {
      broadcasts.push(msg);
    },
  } as unknown as BrowserHandlerContext;

  return { ctx, piSends, broadcasts };
}

function registerSession(mgr: SessionManager, id: string, overrides: Record<string, unknown> = {}) {
  mgr.register({
    id,
    cwd: "/tmp/test",
    source: "tui",
    startedAt: Date.now(),
  });
  if (Object.keys(overrides).length > 0) mgr.update(id, overrides as any);
}

describe("handleAttachProposal — decision matrix", () => {
  let mgr: SessionManager;
  beforeEach(() => {
    mgr = createMemorySessionManager();
  });

  it("empty name + null attached → name auto-set, rename_session sent", () => {
    registerSession(mgr, "s1");
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleAttachProposal({ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBe("add-auth");
    expect(s.name).toBe("add-auth");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "rename_session", sessionId: "s1", name: "add-auth" } },
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: "add-auth" } },
    ]);
    expect(broadcasts).toEqual([
      { type: "session_updated", sessionId: "s1", updates: { attachedProposal: "add-auth", name: "add-auth" } },
    ]);
  });

  it("custom name + null attached → name preserved, no rename_session", () => {
    registerSession(mgr, "s1", { name: "my custom" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleAttachProposal({ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBe("add-auth");
    expect(s.name).toBe("my custom");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: "add-auth" } },
    ]);
    expect(broadcasts).toEqual([
      { type: "session_updated", sessionId: "s1", updates: { attachedProposal: "add-auth" } },
    ]);
  });

  it("name === attachedProposal (auto-set) → re-tracks new change name", () => {
    registerSession(mgr, "s1", { name: "foo", attachedProposal: "foo" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleAttachProposal({ type: "attach_proposal", sessionId: "s1", changeName: "bar" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.name).toBe("bar");
    expect(s.attachedProposal).toBe("bar");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "rename_session", sessionId: "s1", name: "bar" } },
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: "bar" } },
    ]);
    expect(broadcasts[0].updates).toEqual({ attachedProposal: "bar", name: "bar" });
  });

  it("custom name + non-null attached → name preserved, no rename_session", () => {
    registerSession(mgr, "s1", { name: "my custom", attachedProposal: "foo" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleAttachProposal({ type: "attach_proposal", sessionId: "s1", changeName: "bar" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.name).toBe("my custom");
    expect(s.attachedProposal).toBe("bar");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: "bar" } },
    ]);
    expect(broadcasts[0].updates).toEqual({ attachedProposal: "bar" });
  });
});

describe("pushAttachProposalChanged", () => {
  it("sends attach_proposal_changed to the owning session", () => {
    const piSends: PiSent[] = [];
    const ctx = {
      piGateway: { sendToSession(sessionId: string, msg: unknown) { piSends.push({ sessionId, msg }); return true; } },
    } as unknown as BrowserHandlerContext;
    pushAttachProposalChanged(ctx, "s1", "X");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: "X" } },
    ]);
  });

  it("silent no-op when no bridge connected (sendToSession returns false)", () => {
    const ctx = {
      piGateway: { sendToSession() { return false; } },
    } as unknown as BrowserHandlerContext;
    // Must not throw even though no bridge owns the session.
    expect(() => pushAttachProposalChanged(ctx, "ghost", null)).not.toThrow();
  });
});

describe("handleSetSessionProcessDrawer", () => {
  let mgr: SessionManager;
  beforeEach(() => {
    mgr = createMemorySessionManager();
  });

  function makeDrawerCtx(sessionManager: SessionManager) {
    const broadcasts: Broadcast[] = [];
    const metaCalls: Array<{ sessionFile: string; collapsed: boolean }> = [];
    const ctx = {
      sessionManager,
      broadcast(msg: any) { broadcasts.push(msg); },
      metaPersistence: {
        setProcessDrawerCollapsed(sessionFile: string, collapsed: boolean) {
          metaCalls.push({ sessionFile, collapsed });
        },
      },
    } as unknown as BrowserHandlerContext;
    return { ctx, broadcasts, metaCalls };
  }

  it("persists collapse toggle to session + meta and broadcasts session_updated", () => {
    registerSession(mgr, "s1", { sessionFile: "/tmp/test/s1.jsonl" });
    const { ctx, broadcasts, metaCalls } = makeDrawerCtx(mgr);

    handleSetSessionProcessDrawer(
      { type: "set_session_process_drawer", sessionId: "s1", collapsed: false } as any,
      ctx,
    );

    expect(mgr.get("s1")!.processDrawerCollapsed).toBe(false);
    expect(broadcasts).toEqual([
      { type: "session_updated", sessionId: "s1", updates: { processDrawerCollapsed: false } },
    ]);
    expect(metaCalls).toEqual([{ sessionFile: "/tmp/test/s1.jsonl", collapsed: false }]);
  });

  it("no-ops for an unknown session", () => {
    const { ctx, broadcasts, metaCalls } = makeDrawerCtx(mgr);
    handleSetSessionProcessDrawer(
      { type: "set_session_process_drawer", sessionId: "ghost", collapsed: true } as any,
      ctx,
    );
    expect(broadcasts).toEqual([]);
    expect(metaCalls).toEqual([]);
  });
});

describe("handleSetSessionTags", () => {
  let mgr: SessionManager;
  beforeEach(() => {
    mgr = createMemorySessionManager();
  });

  it("sets tags → updates session + broadcasts session_updated with updates.tags", () => {
    registerSession(mgr, "s1");
    const { ctx, broadcasts } = makeCtx(mgr);

    handleSetSessionTags(
      { type: "set_session_tags", sessionId: "s1", tags: ["feature", "backend"] } as any,
      ctx,
    );

    expect(mgr.get("s1")!.tags).toEqual(["feature", "backend"]);
    expect(broadcasts).toEqual([
      { type: "session_updated", sessionId: "s1", updates: { tags: ["feature", "backend"] } },
    ]);
  });

  it("empty array → session becomes untagged", () => {
    registerSession(mgr, "s1", { tags: ["feature"] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleSetSessionTags({ type: "set_session_tags", sessionId: "s1", tags: [] } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual([]);
    expect(broadcasts[0].updates).toEqual({ tags: [] });
  });

  it("normalizes + clamps unnormalized / over-cap input before persist", () => {
    registerSession(mgr, "s1");
    const { ctx, broadcasts } = makeCtx(mgr);
    const long = "x".repeat(200);
    const many = Array.from({ length: 50 }, (_, i) => `Tag${i}`);

    handleSetSessionTags(
      { type: "set_session_tags", sessionId: "s1", tags: ["Feature", "feature", "  ", long, ...many] } as any,
      ctx,
    );

    const tags = mgr.get("s1")!.tags!;
    expect(tags).toHaveLength(12); // capped to MAX_TAGS
    expect(tags[0]).toBe("feature"); // trimmed + lowercased + deduped
    expect(tags.every((t) => t.length <= 32)).toBe(true); // truncated to MAX_TAG_LEN
    expect(broadcasts[0].updates.tags).toEqual(tags);
  });
});

describe("handleRemoveTagGlobally", () => {
  let mgr: SessionManager;
  beforeEach(() => {
    mgr = createMemorySessionManager();
  });

  // E3: 5 sessions, 3 carry `explore`, 2 do not.
  it("E3 — strips the tag from every carrier, one broadcast each, non-carriers untouched", () => {
    registerSession(mgr, "s1", { tags: ["explore", "backend"] });
    registerSession(mgr, "s2", { tags: ["explore"] });
    registerSession(mgr, "s3", { tags: ["frontend"] });
    registerSession(mgr, "s4", { tags: ["explore", "api"] });
    registerSession(mgr, "s5", { tags: [] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: "explore" } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual(["backend"]);
    expect(mgr.get("s2")!.tags).toEqual([]);
    expect(mgr.get("s4")!.tags).toEqual(["api"]);
    // Non-carriers untouched.
    expect(mgr.get("s3")!.tags).toEqual(["frontend"]);
    expect(mgr.get("s5")!.tags).toEqual([]);
    // Exactly one session_updated per carrier (3), none for non-carriers.
    expect(broadcasts).toHaveLength(3);
    expect(broadcasts.every((b) => b.type === "session_updated")).toBe(true);
    expect(broadcasts.map((b) => b.sessionId).sort()).toEqual(["s1", "s2", "s4"]);
    for (const b of broadcasts) {
      expect((b.updates.tags as string[]).includes("explore")).toBe(false);
    }
  });

  // E4: no session carries `ghost`.
  it("E4 — removing a tag no session carries is a no-op", () => {
    registerSession(mgr, "s1", { tags: ["explore"] });
    registerSession(mgr, "s2", { tags: ["frontend"] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: "ghost" } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual(["explore"]);
    expect(mgr.get("s2")!.tags).toEqual(["frontend"]);
    expect(broadcasts).toEqual([]);
  });

  // E5: whitespace-only tag normalizes to empty.
  it("E5 — blank tag normalizes empty ⇒ no-op", () => {
    registerSession(mgr, "s1", { tags: ["explore"] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: "   " } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual(["explore"]);
    expect(broadcasts).toEqual([]);
  });

  // E6: inbound `  Explore ` normalizes to `explore` before matching.
  it("E6 — normalizes the inbound tag before matching", () => {
    registerSession(mgr, "s1", { tags: ["explore", "backend"] });
    registerSession(mgr, "s2", { tags: ["explore"] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: "  Explore " } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual(["backend"]);
    expect(mgr.get("s2")!.tags).toEqual([]);
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.map((b) => b.sessionId).sort()).toEqual(["s1", "s2"]);
  });

  // Untrusted payload: a non-string `tag` is a no-op (never reaches normalize).
  it("non-string tag is a no-op (guards malformed WS payload)", () => {
    registerSession(mgr, "s1", { tags: ["explore"] });
    const { ctx, broadcasts } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: null } as any, ctx);
    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: 42 } as any, ctx);

    expect(mgr.get("s1")!.tags).toEqual(["explore"]);
    expect(broadcasts).toEqual([]);
  });

  // X3: fresh listAll (reconnect snapshot) reflects the stripped tags.
  it("X3 — a fresh listAll after the strip reflects the tag absent (reconnect replay)", () => {
    registerSession(mgr, "s1", { tags: ["explore", "backend"] });
    registerSession(mgr, "s2", { tags: ["explore"] });
    const { ctx } = makeCtx(mgr);

    handleRemoveTagGlobally({ type: "remove_tag_globally", tag: "explore" } as any, ctx);

    // Simulate a reconnect snapshot: replay listAll and confirm no session
    // still carries `explore`.
    const replayed = mgr.listAll();
    expect(replayed.every((s) => !(s.tags ?? []).includes("explore"))).toBe(true);
  });
});

describe("handleDetachProposal — decision matrix", () => {
  let mgr: SessionManager;
  beforeEach(() => {
    mgr = createMemorySessionManager();
  });

  it("name === attachedProposal (auto-set) → name cleared, rename_session with empty name", () => {
    registerSession(mgr, "s1", { name: "foo", attachedProposal: "foo" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleDetachProposal({ type: "detach_proposal", sessionId: "s1" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBeNull();
    expect(s.name).toBeUndefined();
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "rename_session", sessionId: "s1", name: "" } },
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: null } },
    ]);
    expect(broadcasts[0].updates).toEqual({
      attachedProposal: null, openspecPhase: null, openspecChange: null, name: undefined,
      pendingReplaceProposal: null, rejectedReplaceProposals: [],
    });
  });

  it("custom name + non-null attached → name preserved, no rename_session", () => {
    registerSession(mgr, "s1", { name: "my custom", attachedProposal: "foo" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleDetachProposal({ type: "detach_proposal", sessionId: "s1" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBeNull();
    expect(s.name).toBe("my custom");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: null } },
    ]);
    expect(broadcasts[0].updates).toEqual({
      attachedProposal: null, openspecPhase: null, openspecChange: null,
      pendingReplaceProposal: null, rejectedReplaceProposals: [],
    });
  });

  it("empty name + non-null attached → name unchanged, no rename_session", () => {
    registerSession(mgr, "s1", { attachedProposal: "foo" });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleDetachProposal({ type: "detach_proposal", sessionId: "s1" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBeNull();
    expect(s.name).toBeUndefined();
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: null } },
    ]);
    expect(broadcasts[0].updates).toEqual({
      attachedProposal: null, openspecPhase: null, openspecChange: null,
      pendingReplaceProposal: null, rejectedReplaceProposals: [],
    });
  });

  it("name set + null attached (defensive) → name preserved, no rename_session", () => {
    registerSession(mgr, "s1", { name: "foo", attachedProposal: null });
    const { ctx, piSends, broadcasts } = makeCtx(mgr);

    handleDetachProposal({ type: "detach_proposal", sessionId: "s1" } as any, ctx);

    const s = mgr.get("s1")!;
    expect(s.attachedProposal).toBeNull();
    expect(s.name).toBe("foo");
    expect(piSends).toEqual([
      { sessionId: "s1", msg: { type: "attach_proposal_changed", sessionId: "s1", attachedChange: null } },
    ]);
    expect(broadcasts[0].updates).toEqual({
      attachedProposal: null, openspecPhase: null, openspecChange: null,
      pendingReplaceProposal: null, rejectedReplaceProposals: [],
    });
  });
});
