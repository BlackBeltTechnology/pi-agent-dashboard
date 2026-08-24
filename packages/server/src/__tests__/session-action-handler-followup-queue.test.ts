/**
 * Tests for the bridge-owned-follow-up-queue mutation forwarders in
 * `session-action-handler.ts`. Each handler:
 *   1. Returns early when `sessionManager.get(sessionId)` is undefined.
 *   2. Otherwise forwards the message verbatim (preserving fields) to the
 *      bridge via `piGateway.sendToSession`.
 *
 * The bridge mutates `bridgeFollowUp` locally; the server caches no state
 * for these flows (the round-trip arrives via `queue_update`).
 *
 * See change: rework-mid-turn-prompt-queue.
 */

import { describe, expect, it, vi } from "vitest";
import {
  handleClearFollowupEntries,
  handleEditFollowupEntry,
  handlePromoteFollowupEntry,
  handleRemoveFollowupEntry,
} from "../browser-handlers/session-action-handler.js";

function makeCtx(opts: { sessionExists: boolean }) {
  const sessionManager = {
    get: vi.fn((_id: string) => (opts.sessionExists ? { id: _id } : undefined)),
  };
  const piGateway = {
    sendToSession: vi.fn(),
  };
  return {
    ctx: { sessionManager, piGateway } as any,
    sessionManager,
    piGateway,
  };
}

describe("handleClearFollowupEntries", () => {
  it("forwards { indices } when session exists", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handleClearFollowupEntries(
      { type: "clear_followup_entries", sessionId: "S1", indices: [0, 2] } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "clear_followup_entries",
      sessionId: "S1",
      indices: [0, 2],
    });
  });

  it("forwards `indices: 'all'` discriminant", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handleClearFollowupEntries(
      { type: "clear_followup_entries", sessionId: "S1", indices: "all" } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "clear_followup_entries",
      sessionId: "S1",
      indices: "all",
    });
  });

  it("drops silently when session is unknown", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: false });
    handleClearFollowupEntries(
      { type: "clear_followup_entries", sessionId: "MISSING", indices: "all" } as any,
      ctx,
    );
    expect(piGateway.sendToSession).not.toHaveBeenCalled();
  });
});

describe("handleEditFollowupEntry", () => {
  it("forwards { index, text } when session exists", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handleEditFollowupEntry(
      { type: "edit_followup_entry", sessionId: "S1", index: 1, text: "BETA" } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "edit_followup_entry",
      sessionId: "S1",
      index: 1,
      text: "BETA",
    });
  });

  /**
   * `images` was retired from the message (design D5): under the count-only
   * wire the browser never holds the bytes after the initial `send_prompt`, so
   * no producer could populate it. An edit replaces TEXT; the bridge preserves
   * the entry's images. A stale client sending one must not have it forwarded.
   * See change: fix-bridge-followup-image-drop.
   */
  it("never forwards an images field, even when a stale client sends one", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handleEditFollowupEntry(
      {
        type: "edit_followup_entry", sessionId: "S1", index: 0, text: "x",
        images: [{ type: "image", data: "...", mimeType: "image/png" }],
      } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "edit_followup_entry",
      sessionId: "S1",
      index: 0,
      text: "x",
    });
  });

  it("drops silently when session is unknown", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: false });
    handleEditFollowupEntry(
      { type: "edit_followup_entry", sessionId: "MISSING", index: 0, text: "x" } as any,
      ctx,
    );
    expect(piGateway.sendToSession).not.toHaveBeenCalled();
  });
});

describe("handleRemoveFollowupEntry", () => {
  it("forwards { index } when session exists", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handleRemoveFollowupEntry(
      { type: "remove_followup_entry", sessionId: "S1", index: 2 } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "remove_followup_entry",
      sessionId: "S1",
      index: 2,
    });
  });

  it("drops silently when session is unknown", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: false });
    handleRemoveFollowupEntry(
      { type: "remove_followup_entry", sessionId: "MISSING", index: 0 } as any,
      ctx,
    );
    expect(piGateway.sendToSession).not.toHaveBeenCalled();
  });
});

describe("handlePromoteFollowupEntry", () => {
  it("forwards { index } when session exists", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: true });
    handlePromoteFollowupEntry(
      { type: "promote_followup_entry", sessionId: "S1", index: 3 } as any,
      ctx,
    );
    expect(piGateway.sendToSession).toHaveBeenCalledWith("S1", {
      type: "promote_followup_entry",
      sessionId: "S1",
      index: 3,
    });
  });

  it("drops silently when session is unknown", () => {
    const { ctx, piGateway } = makeCtx({ sessionExists: false });
    handlePromoteFollowupEntry(
      { type: "promote_followup_entry", sessionId: "MISSING", index: 0 } as any,
      ctx,
    );
    expect(piGateway.sendToSession).not.toHaveBeenCalled();
  });
});


