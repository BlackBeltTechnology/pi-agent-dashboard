import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

/**
 * A rescued row: the server's over-ceiling image-bytes rescue blanked the
 * base64 and marked the block `imageTruncated`. Unlike a two-phase placeholder
 * it carries NO `attachmentId` — the rescue only ever fires for blocks the fit
 * declined (animated GIF, unfittable mime, no fit worker), which are exactly
 * the blocks `prepareEventForIngest` never stamped an id on. The block must
 * still reach `images` so the row shows an "image unavailable" slot instead of
 * silently pretending the user attached nothing.
 * See change: fix-pasted-image-message-vanishes.
 */
function rescuedRow(block: Record<string, unknown>): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: 1,
    data: {
      message: {
        role: "user",
        content: [{ type: "text", text: "here is the screenshot" }, block],
      },
    },
  };
}

const userMsg = (s: ReturnType<typeof createInitialState>) =>
  s.messages.filter((m) => m.role === "user");

describe("rescued (imageTruncated) image blocks", () => {
  it("flat-shape rescued block renders as a failed attachment slot", () => {
    const state = reduceEvent(
      createInitialState(),
      rescuedRow({ type: "image", data: "", mimeType: "image/png", imageTruncated: true }),
    );
    const msgs = userMsg(state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("here is the screenshot");
    expect(msgs[0].images).toHaveLength(1);
    expect(msgs[0].images![0].mimeType).toBe("image/png");
    expect(msgs[0].images![0].data).toBe("");
    // "failed" is the state ChatView already renders as "image unavailable";
    // the bytes are gone for good, so the slot must not stay pending forever.
    expect(msgs[0].images![0].attachmentState).toBe("failed");
  });

  it("nested-shape rescued block renders as a failed attachment slot", () => {
    const state = reduceEvent(
      createInitialState(),
      rescuedRow({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "" },
        imageTruncated: true,
      }),
    );
    const img = userMsg(state)[0].images![0];
    expect(img.mimeType).toBe("image/png");
    expect(img.attachmentState).toBe("failed");
  });

  it("a two-phase pending placeholder is NOT downgraded to failed", () => {
    const state = reduceEvent(
      createInitialState(),
      rescuedRow({
        type: "image",
        data: "",
        mimeType: "image/png",
        attachmentId: "a".repeat(64),
        attachmentState: "pending",
      }),
    );
    expect(userMsg(state)[0].images![0].attachmentState).toBe("pending");
  });

  it("a truncated block with no mime is still not renderable", () => {
    const state = reduceEvent(
      createInitialState(),
      rescuedRow({ type: "image", data: "", imageTruncated: true }),
    );
    expect(userMsg(state)[0].images).toBeUndefined();
  });
});
