/**
 * Phase-2 driver for the two-phase attachment render, shared by the two paths
 * that admit an image into the store: live `event_forward` (event-wiring) and
 * session hydration from the transcript (subscription-handler).
 *
 * Extracted rather than duplicated because the spec requires fitting on EVERY
 * such path — a replayed session whose images were not fitted would collapse
 * to `{__truncated}` exactly like the original bug, so the two paths must not
 * be able to drift.
 *
 * See change: fit-attachments-for-display (tasks 5.2, 5.3; test-plan #E9).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import { buildFittedEvent, type PendingAttachment } from "./attachment-ingest.js";
import type { FitWorkerPool } from "./fit-worker-pool.js";

export interface AttachmentResolverDeps {
  eventStore: EventStore;
  fitWorkerPool: FitWorkerPool;
  /** Deliver a stored resolution event to whoever is watching this session. */
  emit: (sessionId: string, seq: number, event: DashboardEvent) => void;
}

export interface AttachmentResolver {
  /**
   * Fit the stripped originals off the event loop and emit one resolution
   * event per block. Never rejects — the row is already stored, so the worst
   * case is an attachment resolving to an honest failed state.
   */
  resolve(sessionId: string, pending: PendingAttachment[]): Promise<void>;
}

export function createAttachmentResolver(deps: AttachmentResolverDeps): AttachmentResolver {
  const { eventStore, fitWorkerPool, emit } = deps;

  function publish(sessionId: string, event: DashboardEvent): void {
    const seq = eventStore.insertEvent(sessionId, event);
    emit(sessionId, seq, eventStore.getEvent(sessionId, seq) ?? event);
  }

  return {
    async resolve(sessionId, pending) {
      if (pending.length === 0) return;
      try {
        const { results } = await fitWorkerPool.fit({
          blocks: pending.map((p) => ({
            blockIndex: p.blockIndex,
            data: p.data,
            mimeType: p.mimeType,
          })),
        });
        for (const result of results) {
          const source = pending.find((p) => p.blockIndex === result.blockIndex);
          if (!source) continue;
          publish(
            sessionId,
            buildFittedEvent({
              attachmentId: source.attachmentId,
              data: result.failed ? "" : result.data,
              mimeType: result.mimeType,
              state: result.failed ? "failed" : "ready",
            }),
          );
        }
      } catch (err) {
        // A pool that cannot deliver at all must still not strand placeholders.
        console.error(`[attachments] fit failed for session ${sessionId}:`, err);
        for (const p of pending) {
          publish(
            sessionId,
            buildFittedEvent({
              attachmentId: p.attachmentId,
              data: "",
              mimeType: p.mimeType,
              state: "failed",
            }),
          );
        }
      }
    },
  };
}
