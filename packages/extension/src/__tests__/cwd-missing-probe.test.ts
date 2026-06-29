/**
 * Bridge cwd-missing probe tests.
 *
 * Pinned shape:
 *   - probe emits `cwd_missing` when existsSync returns false
 *   - probe stays silent when cwd exists
 *   - debounce: once emitted, subsequent ticks don't re-emit
 *   - no spam on stable existing-cwd ticks
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { describe, it, expect } from "vitest";
import { sendCwdMissingIfChanged } from "../model-tracker.js";
import type { BridgeContext } from "../bridge-context.js";

function makeBc(): BridgeContext & { __sent: any[] } {
  const sent: any[] = [];
  const bc: any = {
    pi: {} as any,
    connection: { send: (msg: any) => sent.push(msg) } as any,
    sessionId: "s1",
    cachedCtx: undefined,
    cachedModelRegistry: undefined,
    cachedHasUI: undefined,
    lastModel: undefined,
    lastThinkingLevel: undefined,
    lastSessionFile: undefined,
    lastSessionDir: undefined,
    lastFirstMessage: undefined,
    lastGitBranch: undefined,
    lastGitPrNumber: undefined,
    lastGitWorktreeJson: undefined,
    lastSessionName: undefined,
    lastCwdMissing: undefined,
    hasRegisteredOnce: false,
    __sent: sent,
  };
  return bc;
}

describe("sendCwdMissingIfChanged", () => {
  it("emits cwd_missing when cwd does NOT exist", () => {
    const bc = makeBc();
    sendCwdMissingIfChanged(bc, "/gone", () => false);
    expect(bc.__sent).toEqual([{ type: "cwd_missing", sessionId: "s1" }]);
    expect(bc.lastCwdMissing).toBe(true);
  });

  it("stays silent when cwd EXISTS", () => {
    const bc = makeBc();
    sendCwdMissingIfChanged(bc, "/here", () => true);
    expect(bc.__sent).toEqual([]);
    expect(bc.lastCwdMissing).toBeUndefined();
  });

  it("debounces: second tick after a flip does NOT re-emit", () => {
    const bc = makeBc();
    sendCwdMissingIfChanged(bc, "/gone", () => false);
    sendCwdMissingIfChanged(bc, "/gone", () => false);
    expect(bc.__sent).toHaveLength(1);
  });

  it("no spam on repeated stable-existing ticks", () => {
    const bc = makeBc();
    for (let i = 0; i < 5; i++) sendCwdMissingIfChanged(bc, "/here", () => true);
    expect(bc.__sent).toEqual([]);
  });

  it("empty cwd is a no-op", () => {
    const bc = makeBc();
    sendCwdMissingIfChanged(bc, "", () => false);
    expect(bc.__sent).toEqual([]);
  });

  it("after flip-true, cwd reappearing does NOT reset (per design D9 + tasks 3.1 note)", () => {
    const bc = makeBc();
    sendCwdMissingIfChanged(bc, "/x", () => false); // flip
    sendCwdMissingIfChanged(bc, "/x", () => true); // would-be reappear
    expect(bc.lastCwdMissing).toBe(true);
    expect(bc.__sent).toHaveLength(1);
  });
});
