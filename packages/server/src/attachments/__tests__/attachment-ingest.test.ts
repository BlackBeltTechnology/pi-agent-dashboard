import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  ATTACHMENT_FITTED_EVENT,
  buildFittedEvent,
  prepareEventForIngest,
} from "../attachment-ingest.js";
import {
  createMemoryEventStore,
  DEFAULT_MAX_EVENT_DATA_SIZE,
} from "../../persistence/memory-event-store.js";

/** A user message_start carrying `text` plus N base64 image blocks. */
function userMessage(images: Array<{ data: string; mimeType: string }>): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: Date.now(),
    data: {
      message: {
        role: "user",
        content: [
          { type: "text", text: "here is the screenshot" },
          ...images.map((i) => ({ type: "image", ...i })),
        ],
      },
    },
  };
}

const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

describe("attachment-ingest", () => {
  it("E7: a 10.5 MB attachment leaves the row event tiny and keeps data.message", () => {
    // The observed max real payload. Before this change the whole event
    // collapsed to {__truncated} and the user's row vanished silently.
    const huge = "A".repeat(10_500_000);
    const { event, pending } = prepareEventForIngest(userMessage([
      { data: huge, mimeType: "image/png" },
    ]));

    const msg = (event.data as any).message;
    expect(msg.role).toBe("user");
    expect(msg.content[0].text).toBe("here is the screenshot");
    expect(bytesOf(event.data)).toBeLessThan(DEFAULT_MAX_EVENT_DATA_SIZE);
    expect(pending).toHaveLength(1);
    expect(pending[0].data).toBe(huge); // originals handed to the worker intact
  });

  it("E7b: the stripped row survives the store instead of becoming {__truncated}", () => {
    const store = createMemoryEventStore(() => false);
    const huge = "B".repeat(10_500_000);
    const { event } = prepareEventForIngest(userMessage([{ data: huge, mimeType: "image/png" }]));
    store.insertEvent("s1", event);
    const stored = store.getEvent("s1", 1) as any;

    expect(stored.data.__truncated).toBeUndefined();
    expect(stored.data.message.role).toBe("user");
    expect(bytesOf(stored.data)).toBeLessThanOrEqual(DEFAULT_MAX_EVENT_DATA_SIZE);
  });

  it("the placeholder marks the block pending and carries a content-hash id", () => {
    const { event, pending } = prepareEventForIngest(userMessage([
      { data: "Q".repeat(400_000), mimeType: "image/png" },
    ]));
    const block = (event.data as any).message.content[1];
    expect(block.type).toBe("image");
    expect(block.data).toBe("");
    expect(block.attachmentState).toBe("pending");
    expect(block.attachmentId).toMatch(/^[0-9a-f]{64}$/);
    expect(block.attachmentId).toBe(pending[0].attachmentId);
    expect(block.mimeType).toBe("image/png");
  });

  it("identical bytes produce the same attachment id (content-addressed)", () => {
    const data = "R".repeat(300_000);
    const a = prepareEventForIngest(userMessage([{ data, mimeType: "image/png" }]));
    const b = prepareEventForIngest(userMessage([{ data, mimeType: "image/png" }]));
    expect(a.pending[0].attachmentId).toBe(b.pending[0].attachmentId);
  });

  it("E8: 20 attachments all become pending and the row stays bounded", () => {
    const blocks = Array.from({ length: 20 }, (_, i) => ({
      data: String.fromCharCode(97 + i).repeat(2_000_000),
      mimeType: "image/png",
    }));
    const { event, pending } = prepareEventForIngest(userMessage(blocks));
    expect(pending).toHaveLength(20);
    expect(bytesOf(event.data)).toBeLessThan(DEFAULT_MAX_EVENT_DATA_SIZE);
    const content = (event.data as any).message.content;
    for (let i = 1; i <= 20; i++) {
      expect(content[i].attachmentState).toBe("pending");
      expect(content[i].data).toBe("");
    }
    expect(pending.map((p) => p.blockIndex)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("leaves events without image blocks untouched (same reference)", () => {
    const plain: DashboardEvent = {
      eventType: "message_start",
      timestamp: Date.now(),
      data: { message: { role: "user", content: [{ type: "text", text: "no images" }] } },
    };
    const { event, pending } = prepareEventForIngest(plain);
    expect(event).toBe(plain);
    expect(pending).toEqual([]);
  });

  it("leaves non-message events untouched", () => {
    const other: DashboardEvent = {
      eventType: "agent_start",
      timestamp: Date.now(),
      data: { foo: "bar" },
    };
    const { event, pending } = prepareEventForIngest(other);
    expect(event).toBe(other);
    expect(pending).toEqual([]);
  });

  it("E10: a fitted derivative at the measured 212 KB max fits the ceiling", () => {
    const fitted = "F".repeat(212_000);
    const evt = buildFittedEvent({
      attachmentId: "a".repeat(64),
      data: fitted,
      mimeType: "image/png",
      state: "ready",
    });
    expect(evt.eventType).toBe(ATTACHMENT_FITTED_EVENT);

    const store = createMemoryEventStore(() => false);
    store.insertEvent("s1", evt);
    const stored = store.getEvent("s1", 1) as any;
    expect(stored.data.__truncated).toBeUndefined();
    expect(stored.data.data).toBe(fitted); // survives intact, no truncation
    expect(bytesOf(stored.data)).toBeLessThanOrEqual(DEFAULT_MAX_EVENT_DATA_SIZE);
  });

  it("a failed fit builds an explicit failed resolution, never a pending one", () => {
    const evt = buildFittedEvent({
      attachmentId: "b".repeat(64),
      data: "",
      mimeType: "image/png",
      state: "failed",
    });
    expect((evt.data as any).state).toBe("failed");
    expect((evt.data as any).attachmentId).toBe("b".repeat(64));
  });
});
