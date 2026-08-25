/**
 * The drain's PAYLOAD contract, exercised against the real buffer and the real
 * content builder.
 *
 * `bridge-followup-queue-drain.test.ts` covers the drain's GATES (idle,
 * TUI-coexistence, re-entrancy, empty-buffer) with a synchronous mirror. This
 * file covers what `fix-bridge-followup-image-drop` changes: what the drain
 * hands pi, and what happens to an entry's image bytes when it does. The
 * pop-before-send and no-re-push invariants are re-asserted HERE with entries
 * carrying images, because that is where losing them would be silent.
 *
 * The mirror below wires the REAL `createFollowupBuffer` and the REAL
 * `buildUserMessageContent`, so a regression in either fails these cases.
 *
 * Covers test-plan rows E3, E4, X1, X2, X3.
 *
 * See change: fix-bridge-followup-image-drop.
 */
import { describe, expect, it, vi } from "vitest";
import { buildUserMessageContent } from "../command-handler.js";
import { createFollowupBuffer, type FollowUpEntry } from "../followup-buffer.js";

const PNG = { type: "image" as const, data: "PNGBYTES", mimeType: "image/png" };

function makeDrain(opts: { initial?: FollowUpEntry[]; throwOnSend?: boolean; maxBytes?: number } = {}) {
  const callLog: string[] = [];
  const buffer = createFollowupBuffer({ maxBytes: opts.maxBytes });
  for (const entry of opts.initial ?? []) expect(buffer.push(entry).ok).toBe(true);

  const sendUserMessage = vi.fn((...args: unknown[]) => {
    callLog.push(`send:${args.length}`);
    if (opts.throwOnSend) throw new Error("pi exploded");
  });

  // Mirrors bridge.ts drainFollowupQueue AFTER its gates pass: pop first, emit,
  // then hand pi the built content with NO send options.
  const drainOnce = (): void => {
    if (buffer.length === 0) return;
    const entry = buffer.shift()!;
    callLog.push("shift");
    try {
      sendUserMessage(buildUserMessageContent(entry.text, entry.images));
    } catch {
      // INTENTIONAL: no re-push. Double-shipping is worse than dropping.
    }
  };

  return { buffer, sendUserMessage, callLog, drainOnce };
}

describe("follow-up drain payload", () => {
  it("hands pi a text+image content array and ZERO send options (E3)", () => {
    const d = makeDrain({ initial: [{ text: "describe", images: [PNG] }] });
    d.drainOnce();

    expect(d.sendUserMessage).toHaveBeenCalledWith([
      { type: "text", text: "describe" },
      { type: "image", data: "PNGBYTES", mimeType: "image/png" },
    ]);
    // `{deliverAs:"followUp"}` here would mean the entry never drains — pi has
    // already exited getFollowUpMessages(). The absence of a second argument is
    // the invariant, not an accident of the mock.
    expect(d.sendUserMessage.mock.calls[0]).toHaveLength(1);
  });

  it("hands pi a BARE STRING for a text-only entry — no options (E4)", () => {
    const d = makeDrain({ initial: [{ text: "plain" }] });
    d.drainOnce();

    expect(d.sendUserMessage).toHaveBeenCalledWith("plain");
    expect(d.sendUserMessage.mock.calls[0]).toHaveLength(1);
  });

  it("pops the entry BEFORE handing it to pi (X3)", () => {
    const d = makeDrain({ initial: [{ text: "a", images: [PNG] }] });
    d.drainOnce();

    expect(d.callLog.indexOf("shift")).toBeLessThan(d.callLog.findIndex((s) => s.startsWith("send:")));
  });

  it("drops the entry when pi throws — never re-pushed (X1)", () => {
    const d = makeDrain({ initial: [{ text: "a" }], throwOnSend: true });
    d.drainOnce();

    expect(d.buffer.entries()).toEqual([]);
    d.drainOnce(); // empty-buffer gate: no second send
    expect(d.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("releases an image-bearing entry's BYTES when pi throws (X2)", () => {
    const d = makeDrain({
      initial: [{ text: "a", images: [{ ...PNG, data: "A".repeat(900) }] }],
      maxBytes: 1024,
      throwOnSend: true,
    });
    expect(d.buffer.totalBytes()).toBeGreaterThan(900);

    d.drainOnce();

    expect(d.buffer.entries()).toEqual([]);
    expect(d.buffer.totalBytes()).toBe(0);
    // The budget really is free again — a full-size entry is admitted.
    expect(d.buffer.push({ text: "b".repeat(1000) })).toEqual({ ok: true });
  });

  it("drains one entry per call, in FIFO order, images intact", () => {
    const d = makeDrain({
      initial: [{ text: "first" }, { text: "second", images: [PNG] }],
    });

    d.drainOnce();
    expect(d.sendUserMessage).toHaveBeenLastCalledWith("first");
    expect(d.buffer.views()).toEqual([{ text: "second", imageCount: 1 }]);

    d.drainOnce();
    expect(d.sendUserMessage).toHaveBeenLastCalledWith([
      { type: "text", text: "second" },
      { type: "image", data: "PNGBYTES", mimeType: "image/png" },
    ]);
  });
});
