import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

const ATT = "a".repeat(64);

/** A user message_start whose image block is a pending placeholder. */
function pendingRow(attachmentId = ATT): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: 1,
    data: {
      message: {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          {
            type: "image",
            data: "",
            mimeType: "image/png",
            attachmentId,
            attachmentState: "pending",
          },
        ],
      },
    },
  };
}

function fitted(
  attachmentId: string,
  state: "ready" | "failed",
  data = "ZmFrZQ==",
): DashboardEvent {
  return {
    eventType: "attachment_fitted",
    timestamp: 2,
    data: { attachmentId, data, mimeType: "image/png", state },
  };
}

const userMsg = (s: ReturnType<typeof createInitialState>) =>
  s.messages.filter((m) => m.role === "user");

describe("attachment_fitted reduction (two-phase render)", () => {
  it("F1: the row renders immediately with a pending placeholder image", () => {
    const state = reduceEvent(createInitialState(), pendingRow());
    const msgs = userMsg(state);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("look at this");
    // The placeholder must survive into `images` even though it has no bytes —
    // otherwise the attachment position is lost and phase 2 has nothing to fill.
    expect(msgs[0].images).toHaveLength(1);
    expect(msgs[0].images![0].attachmentState).toBe("pending");
    expect(msgs[0].images![0].data).toBe("");
  });

  it("F2: the fitted image replaces its placeholder in the same position", () => {
    let state = reduceEvent(createInitialState(), pendingRow());
    state = reduceEvent(state, fitted(ATT, "ready", "UNJTRUQ="));
    const msgs = userMsg(state);
    expect(msgs).toHaveLength(1); // row count unchanged — no duplicate row
    expect(msgs[0].content).toBe("look at this"); // surrounding message unchanged
    expect(msgs[0].images).toHaveLength(1);
    expect(msgs[0].images![0].data).toBe("UNJTRUQ=");
    expect(msgs[0].images![0].attachmentState).toBe("ready");
  });

  it("F3: a failed fit resolves to an explicit failed state, never stays pending", () => {
    let state = reduceEvent(createInitialState(), pendingRow());
    state = reduceEvent(state, fitted(ATT, "failed", ""));
    const img = userMsg(state)[0].images![0];
    expect(img.attachmentState).toBe("failed");
    expect(img.data).toBe("");
  });

  it("targets the right message when several rows carry attachments", () => {
    const A = "1".repeat(64);
    const B = "2".repeat(64);
    let state = reduceEvent(createInitialState(), pendingRow(A));
    state = reduceEvent(state, pendingRow(B));
    state = reduceEvent(state, fitted(B, "ready", "Qg=="));

    const msgs = userMsg(state);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].images![0].attachmentState).toBe("pending"); // untouched
    expect(msgs[1].images![0].data).toBe("Qg==");
    expect(msgs[1].images![0].attachmentState).toBe("ready");
  });

  it("an unknown attachmentId is ignored without disturbing state", () => {
    const state = reduceEvent(createInitialState(), pendingRow());
    const after = reduceEvent(state, fitted("f".repeat(64), "ready"));
    expect(userMsg(after)).toHaveLength(1);
    expect(userMsg(after)[0].images![0].attachmentState).toBe("pending");
  });

  it("F7: replay order (row then resolution) converges to the fitted image", () => {
    // Replay redelivers both events in sequence; folding must land on ready.
    let state = createInitialState();
    for (const e of [pendingRow(), fitted(ATT, "ready", "UkVQTEFZ")]) {
      state = reduceEvent(state, e);
    }
    expect(userMsg(state)[0].images![0].data).toBe("UkVQTEFZ");
    expect(userMsg(state)[0].images![0].attachmentState).toBe("ready");
  });

  it("a legacy image block with inline bytes still renders (no regression)", () => {
    const legacy: DashboardEvent = {
      eventType: "message_start",
      timestamp: 1,
      data: {
        message: {
          role: "user",
          content: [
            { type: "text", text: "old style" },
            { type: "image", data: "TEVHQUNZ", mimeType: "image/png" },
          ],
        },
      },
    };
    const state = reduceEvent(createInitialState(), legacy);
    const img = userMsg(state)[0].images![0];
    expect(img.data).toBe("TEVHQUNZ");
    expect(img.attachmentState).toBeUndefined();
  });
});
