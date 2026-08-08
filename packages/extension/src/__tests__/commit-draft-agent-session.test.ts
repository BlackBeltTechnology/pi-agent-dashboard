/**
 * pi 0.84.0 audit: the v4 lane-based session model.
 *
 * The 0.84.0 CHANGELOG replaced the INHERITED pi-agent-core harness session
 * model with v4 `Session` / `SessionStorage` / `SessionRepo`. That break does
 * not reach the `pi-coding-agent` SDK surface `runForkSubagentDraft` calls:
 * `createAgentSession({ sessionManager: SessionManager.inMemory(cwd) })` is
 * unchanged. These tests pin that fact and the subagent's disposal contract, so
 * a future pi that DOES move the SDK surface fails loudly here instead of at
 * runtime in a user's commit draft.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #X7, #X8, #X9), design D3a.
 */
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const model = { provider: "anthropic", id: "claude" };

/**
 * Stub the SDK module `runForkSubagentDraft` dynamically imports, recording how
 * it was driven.
 */
function stubSdk(opts: { deltas?: string[]; promptRejects?: boolean } = {}) {
  const calls = {
    createAgentSession: vi.fn(),
    inMemory: vi.fn(),
    unsubscribe: vi.fn(),
    dispose: vi.fn(),
  };
  let emit: ((e: unknown) => void) | undefined;

  const session = {
    subscribe: (fn: (e: unknown) => void) => {
      emit = fn;
      return calls.unsubscribe;
    },
    prompt: vi.fn(async () => {
      for (const d of opts.deltas ?? []) {
        emit?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: d } });
      }
      if (opts.promptRejects) throw new Error("turn exploded");
    }),
    dispose: calls.dispose,
  };

  vi.doMock("@earendil-works/pi-coding-agent", () => ({
    createAgentSession: calls.createAgentSession.mockResolvedValue({ session }),
    SessionManager: { inMemory: calls.inMemory.mockReturnValue({ __inMemory: true }) },
  }));

  return calls;
}

describe("runForkSubagentDraft — 0.84.x session-model audit", () => {
  it("X8: the pinned pi still exports the SDK session surface this path calls", () => {
    // If pi ever collapses createAgentSession / SessionManager.inMemory into
    // the v4 lane API, this fails immediately and forces D3a to be revisited.
    const require_ = createRequire(import.meta.url);
    const repoRoot = path.resolve(__dirname, "../../../..");
    const sdk = require_(
      path.join(repoRoot, "packages/server/node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
    );

    expect(typeof sdk.createAgentSession).toBe("function");
    expect(typeof sdk.SessionManager).toBe("function");
    expect(typeof sdk.SessionManager.inMemory).toBe("function");
  });

  it("X7: drafts via createAgentSession + SessionManager.inMemory, then tears down", async () => {
    vi.resetModules();
    const calls = stubSdk({ deltas: ["feat: ", "add thing"] });
    const { runForkSubagentDraft: run } = await import("../commit-draft-agent.js");

    const text = await run("seed", "/tmp/repo", () => model);

    expect(text).toBe("feat: add thing");
    expect(calls.inMemory).toHaveBeenCalledWith("/tmp/repo");
    const opts = calls.createAgentSession.mock.calls[0][0];
    expect(opts.model).toBe(model);
    expect(opts.cwd).toBe("/tmp/repo");
    // No tools: this subagent must never act on the repo.
    expect(opts.tools).toEqual([]);
    expect(opts.sessionManager).toEqual({ __inMemory: true });
    // Ephemeral: both teardown steps run on the success path.
    expect(calls.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls.dispose).toHaveBeenCalledTimes(1);
    vi.doUnmock("@earendil-works/pi-coding-agent");
  });

  it("X9: unsubscribes and disposes even when the turn rejects", async () => {
    vi.resetModules();
    const calls = stubSdk({ promptRejects: true });
    const { runForkSubagentDraft: run } = await import("../commit-draft-agent.js");

    await expect(run("seed", "/tmp/repo", () => model)).rejects.toThrow(/turn exploded/);

    expect(calls.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls.dispose).toHaveBeenCalledTimes(1);
    vi.doUnmock("@earendil-works/pi-coding-agent");
  });

  it("X9: a draft with no text fails and still tears the session down", async () => {
    vi.resetModules();
    const calls = stubSdk({ deltas: [] });
    const { runForkSubagentDraft: run } = await import("../commit-draft-agent.js");

    await expect(run("seed", "/tmp/repo", () => model)).rejects.toThrow(/empty-draft/);

    expect(calls.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls.dispose).toHaveBeenCalledTimes(1);
    vi.doUnmock("@earendil-works/pi-coding-agent");
  });

  it("no model → fails before any session is constructed", async () => {
    vi.resetModules();
    const calls = stubSdk();
    const { runForkSubagentDraft: run } = await import("../commit-draft-agent.js");

    await expect(run("seed", "/tmp/repo", () => undefined)).rejects.toThrow(/no-model/);

    expect(calls.createAgentSession).not.toHaveBeenCalled();
    vi.doUnmock("@earendil-works/pi-coding-agent");
  });
});
