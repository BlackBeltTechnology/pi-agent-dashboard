/**
 * Negative-assertion lock-in: the bridge SHALL NOT honor the deleted
 * pi-queue-mutation messages, and no bridge source calls a `pi.clear*Queue`.
 *
 * Pi's ExtensionAPI (verified through 1.5.0) exposes no queue-mutation
 * primitives. The three Phase-3 pi-mutation types stay PERMANENTLY DELETED:
 * a stale client sending one must cause no pi call, no buffer change and no
 * `queue_update`. Driven through the real `handleInboundMessage` over real
 * steer + follow-up buffers.
 *
 * Steers held by the BRIDGE are cancellable (`remove_steering_entry` /
 * `clear_steering_entries`, see bridge-steer-handoff.test.ts); this file only
 * guards the deleted pi-mutation surface.
 *
 * Covers bridge-owned-cancellable-steer test-plan row E26.
 *
 * @structural-pin "no pi.clear*Queue call anywhere" is an absence over every bridge source file, which only a source scan can assert; the dispatch half is behavioural
 * See changes: honest-mid-turn-queue-surface, rework-mid-turn-prompt-queue,
 * bridge-owned-cancellable-steer.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleInboundMessage } from "../bridge-handlers/dispatch.js";
import { createFollowupBuffer } from "../followup-buffer.js";
import { createSteerBuffer } from "../steer-buffer.js";
import { makeStubInstance } from "./helpers/bridge-instance-stub.js";

/** Every `.ts` file under `dir`, skipping tests and node_modules. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(p);
    return name.endsWith(".ts") ? [p] : [];
  });
}

// Names that stay PERMANENTLY DELETED (pi-mutation semantics, never
// re-introduced). edit/remove/promote_followup_entry are NOT here — they are
// reused with bridge-buffer-only semantics (bridge-followup-mutation.test.ts).
const QUEUE_MUTATION_TYPES = ["clear_steering_queue", "clear_followup_slot", "edit_followup_slot"] as const;

function makeRig() {
  const steer = createSteerBuffer("n");
  const followUp = createFollowupBuffer();
  steer.push({ text: "existing-steer" });
  followUp.push({ text: "existing-followup" });
  const emitQueueUpdate = vi.fn();
  const handle = vi.fn(async () => undefined);
  const { inst, pi } = makeStubInstance({
    bridgeSteer: steer,
    bridgeFollowUp: followUp,
    emitQueueUpdate,
    sendCommandFeedback: vi.fn(),
    commandHandler: { handle } as never,
    pathGate: { onServerMessage: () => false } as never,
    polling: {} as never,
  });
  const piMethods = { sendUserMessage: vi.fn(), clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };
  Object.assign(pi, piMethods);
  return { inst, steer, followUp, emitQueueUpdate, handle, piMethods };
}

describe("bridge: stale queue-mutation messages produce zero side effects", () => {
  for (const type of QUEUE_MUTATION_TYPES) {
    it(`${type}: pi.sendUserMessage not called, pi.clear* not called, buffers unchanged, no queue_update`, async () => {
      const r = makeRig();
      await handleInboundMessage(r.inst, { type, sessionId: "S1", index: 0, text: "new", images: undefined });

      expect(r.piMethods.sendUserMessage).not.toHaveBeenCalled();
      expect(r.piMethods.clearSteeringQueue).not.toHaveBeenCalled();
      expect(r.piMethods.clearFollowUpQueue).not.toHaveBeenCalled();
      expect(r.steer.views().map((v) => v.text)).toEqual(["existing-steer"]);
      expect(r.followUp.views().map((v) => v.text)).toEqual(["existing-followup"]);
      expect(r.emitQueueUpdate).not.toHaveBeenCalled();
    });
  }

  it("non-vacuous: a live buffer mutation through the same dispatch DOES emit", async () => {
    const r = makeRig();
    await handleInboundMessage(r.inst, { type: "clear_steering_entries", sessionId: "S1" });
    expect(r.steer.length).toBe(0);
    expect(r.emitQueueUpdate).toHaveBeenCalledTimes(1);
    expect(r.piMethods.clearSteeringQueue).not.toHaveBeenCalled();
  });

  it("no source under packages/extension/src calls pi.clear*Queue(", () => {
    const hits = sourceFiles(join(__dirname, "..")).filter((p) => /\bpi\.clear\w*Queue\(/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
});
