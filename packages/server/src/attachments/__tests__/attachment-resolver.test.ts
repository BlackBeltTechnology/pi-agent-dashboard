import { describe, expect, it, vi } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createAttachmentResolver } from "../attachment-resolver.js";
import {
  ATTACHMENT_FITTED_EVENT,
  prepareEventForIngest,
} from "../attachment-ingest.js";
import {
  createMemoryEventStore,
  DEFAULT_MAX_EVENT_DATA_SIZE,
} from "../../persistence/memory-event-store.js";
import type { FitWorkerPool } from "../fit-worker-pool.js";

/** Pool stub that echoes a small fitted payload per block. */
function fakePool(overrides: Partial<FitWorkerPool> = {}): FitWorkerPool {
  return {
    fit: vi.fn(async (req: any) => ({
      jobId: 1,
      results: req.blocks.map((b: any) => ({
        blockIndex: b.blockIndex,
        data: "RklUVEVE",
        mimeType: b.mimeType,
        fitted: true,
      })),
    })),
    dispose: vi.fn(async () => {}),
    inFlight: () => 0,
    ...overrides,
  } as FitWorkerPool;
}

function imageEvent(data: string): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: Date.now(),
    data: {
      message: {
        role: "user",
        content: [
          { type: "text", text: "replayed screenshot" },
          { type: "image", data, mimeType: "image/png" },
        ],
      },
    },
  };
}

describe("attachment-resolver", () => {
  it("E9: a replayed 5 MB inline image yields a bounded row plus a fitted event", async () => {
    const store = createMemoryEventStore(() => false);
    const emitted: Array<{ seq: number; event: DashboardEvent }> = [];
    const resolver = createAttachmentResolver({
      eventStore: store,
      fitWorkerPool: fakePool(),
      emit: (_s, seq, event) => emitted.push({ seq, event }),
    });

    // Mirrors the hydration path: strip, insert, then resolve.
    const { event, pending } = prepareEventForIngest(imageEvent("Z".repeat(5_000_000)));
    store.insertEvent("s1", event);
    await resolver.resolve("s1", pending);

    const row = store.getEvent("s1", 1) as any;
    expect(row.data.__truncated).toBeUndefined();
    expect(row.data.message.role).toBe("user");
    expect(Buffer.byteLength(JSON.stringify(row.data))).toBeLessThanOrEqual(
      DEFAULT_MAX_EVENT_DATA_SIZE,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.eventType).toBe(ATTACHMENT_FITTED_EVENT);
    expect((emitted[0].event.data as any).state).toBe("ready");
    expect((emitted[0].event.data as any).attachmentId).toBe(pending[0].attachmentId);
  });

  it("emits one resolution per block, in block order", async () => {
    const store = createMemoryEventStore(() => false);
    const emitted: DashboardEvent[] = [];
    const resolver = createAttachmentResolver({
      eventStore: store,
      fitWorkerPool: fakePool(),
      emit: (_s, _q, event) => emitted.push(event),
    });
    await resolver.resolve("s1", [
      { attachmentId: "a".repeat(64), blockIndex: 1, data: "AA", mimeType: "image/png" },
      { attachmentId: "b".repeat(64), blockIndex: 3, data: "BB", mimeType: "image/png" },
    ]);
    expect(emitted).toHaveLength(2);
    expect(emitted.map((e) => (e.data as any).attachmentId)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("X7: a failing pool resolves every placeholder to failed rather than stranding it", async () => {
    const store = createMemoryEventStore(() => false);
    const emitted: DashboardEvent[] = [];
    const pool = fakePool({ fit: vi.fn(async () => { throw new Error("pool down"); }) });
    const resolver = createAttachmentResolver({
      eventStore: store,
      fitWorkerPool: pool,
      emit: (_s, _q, event) => emitted.push(event),
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolver.resolve("s1", [
      { attachmentId: "c".repeat(64), blockIndex: 1, data: "AA", mimeType: "image/png" },
      { attachmentId: "d".repeat(64), blockIndex: 2, data: "BB", mimeType: "image/png" },
    ]);
    err.mockRestore();

    expect(emitted).toHaveLength(2);
    for (const e of emitted) expect((e.data as any).state).toBe("failed");
  });

  it("a failed individual block resolves failed without affecting its siblings", async () => {
    const store = createMemoryEventStore(() => false);
    const emitted: DashboardEvent[] = [];
    const pool = fakePool({
      fit: vi.fn(async (req: any) => ({
        jobId: 1,
        results: req.blocks.map((b: any, i: number) =>
          i === 0
            ? { blockIndex: b.blockIndex, data: "", mimeType: b.mimeType, fitted: false, failed: true }
            : { blockIndex: b.blockIndex, data: "T0s=", mimeType: b.mimeType, fitted: true },
        ),
      })),
    });
    const resolver = createAttachmentResolver({
      eventStore: store,
      fitWorkerPool: pool,
      emit: (_s, _q, event) => emitted.push(event),
    });
    await resolver.resolve("s1", [
      { attachmentId: "e".repeat(64), blockIndex: 1, data: "AA", mimeType: "image/png" },
      { attachmentId: "f".repeat(64), blockIndex: 2, data: "BB", mimeType: "image/png" },
    ]);
    expect((emitted[0].data as any).state).toBe("failed");
    expect((emitted[1].data as any).state).toBe("ready");
  });

  it("no pending blocks is a no-op (no events, no pool call)", async () => {
    const store = createMemoryEventStore(() => false);
    const pool = fakePool();
    const emitted: DashboardEvent[] = [];
    const resolver = createAttachmentResolver({
      eventStore: store,
      fitWorkerPool: pool,
      emit: (_s, _q, e) => emitted.push(e),
    });
    await resolver.resolve("s1", []);
    expect(emitted).toEqual([]);
    expect(pool.fit).not.toHaveBeenCalled();
  });
});
