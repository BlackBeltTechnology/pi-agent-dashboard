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
import { DISPLAY_MAX_BYTES } from "./display-fit.js";
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
    try {
      emit(sessionId, seq, eventStore.getEvent(sessionId, seq) ?? event);
    } catch (err) {
      // The resolution is already PERSISTED; only the broadcast failed. Letting
      // this escape reached the outer catch, which appended a failed event for
      // every attachment — rewriting a stored `ready` resolution as `failed`
      // over a pure transport problem, and rejecting `resolve` despite its
      // fire-and-forget contract. A subscriber that missed the frame gets it
      // from replay, because the stored event is intact.
      console.error(`[attachments] emit failed for session ${sessionId}:`, err);
    }
  }

  /**
   * Settle every placeholder the pool did not answer for.
   *
   * The publish loop is driven by `results`, so a pool returning fewer results
   * than blocks — or a `blockIndex` outside `pending` — would leave those
   * placeholders spinning forever, the one outcome this module exists to
   * prevent. Explicitly failed beats indefinitely pending.
   */
  function settleUnanswered(
    sessionId: string,
    pending: PendingAttachment[],
    settled: ReadonlySet<number>,
  ): void {
    for (let i = 0; i < pending.length; i++) {
      if (settled.has(i)) continue;
      console.warn(
        `[attachments] no fit result for ${pending[i].attachmentId.slice(0, 12)}; resolving failed`,
      );
      publishFailed(sessionId, pending[i]);
    }
  }

  /** Resolve one placeholder to its honest failed state. */
  function publishFailed(
    sessionId: string,
    a: { attachmentId: string; mimeType: string },
  ): void {
    publish(
      sessionId,
      buildFittedEvent({
        attachmentId: a.attachmentId,
        data: "",
        mimeType: a.mimeType,
        state: "failed",
      }),
    );
  }

  return {
    async resolve(sessionId, pending) {
      if (pending.length === 0) return;
      try {
        // Index into `pending` — NOT the message-relative blockIndex. Hydration
        // aggregates blocks from MANY message rows, so blockIndex repeats across
        // rows; matching on it made a later result resolve the first attachment
        // again and strand its own placeholder pending forever.
        const { results } = await fitWorkerPool.fit({
          blocks: pending.map((p, i) => ({
            blockIndex: i,
            data: p.data,
            mimeType: p.mimeType,
          })),
        });
        // Which ORDINALS actually got an event. The loop below is driven by
        // `results`, so a pool that returns fewer results than blocks — or one
        // whose `blockIndex` falls outside `pending` — would otherwise leave
        // those placeholders spinning forever, the one thing this module exists
        // to prevent.
        const settled = new Set<number>();
        for (const result of results) {
          const source = pending[result.blockIndex];
          if (!source) continue;
          settled.add(result.blockIndex);
          // Last line of defence for the "never an indefinite placeholder"
          // invariant: an over-budget payload would make THIS event exceed the
          // per-event ceiling, and the store would replace it with
          // `{__truncated}` — which drops `attachmentId`, so the client could
          // never match it and the placeholder would spin forever. Degrade to
          // an explicit failed state instead of shipping an unpublishable one.
          const overBudget =
            !result.failed && Buffer.byteLength(result.data, "utf8") > DISPLAY_MAX_BYTES;
          if (overBudget) {
            console.warn(
              `[attachments] fitted derivative ${source.attachmentId.slice(0, 12)} exceeded the display budget; resolving failed`,
            );
          }
          const failed = result.failed || overBudget;
          publish(
            sessionId,
            buildFittedEvent({
              attachmentId: source.attachmentId,
              data: failed ? "" : result.data,
              mimeType: result.mimeType,
              state: failed ? "failed" : "ready",
            }),
          );
        }

        settleUnanswered(sessionId, pending, settled);
      } catch (err) {
        // A pool that cannot deliver at all must still not strand placeholders.
        console.error(`[attachments] fit failed for session ${sessionId}:`, err);
        for (const p of pending) publishFailed(sessionId, p);
      }
    },
  };
}
