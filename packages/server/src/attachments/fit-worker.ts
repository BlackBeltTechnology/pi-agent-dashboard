/**
 * Display-fit worker — runs `fitImageBlockForDisplay` over a message's image
 * content blocks off the main event loop.
 *
 * Resize is measured at 174–874 ms per image and jimp is pure JS + single
 * threaded, so doing this inline would stall EVERY session's event processing
 * for the duration of one paste (D4). Only the fitted base64 crosses the
 * thread boundary, which is bounded by the display policy (≤212 KB measured).
 *
 * The exported `fitBlocks(req)` IS the entire worker body; tests and the
 * in-process fallback import it directly, mirroring `session-load-worker.ts`.
 *
 * See change: fit-attachments-for-display (task 5.1, D4).
 */
import { isMainThread, parentPort } from "node:worker_threads";
import { type FitResult, fitImageBlockForDisplay, type ImageBlockInput } from "./display-fit.js";

export interface FitRequest {
  jobId: number;
  /** Image blocks in the order they appear in the message content array. */
  blocks: Array<ImageBlockInput & { blockIndex: number }>;
}

export interface FitResponse {
  jobId: number;
  results: Array<FitResult & { blockIndex: number }>;
}

/**
 * Fit every block in the request. Never rejects: an individual block that
 * cannot be decoded comes back with `failed:true` so its attachment resolves
 * to an honest failed state instead of an indefinite placeholder.
 */
export async function fitBlocks(req: FitRequest): Promise<FitResponse> {
  // TOTAL by contract, not just by intent. The in-process fallback awaits this
  // directly and only calls `finish()` on the resolved value, so ANY throw here
  // stranded that caller's promise forever — and, being detached, surfaced as an
  // unhandled rejection. The worker path is no better: a throw means no
  // `postMessage`, so the job sat until its timeout. Malformed input therefore
  // resolves to `failed` results rather than raising.
  const jobId = (req as Partial<FitRequest> | undefined)?.jobId ?? 0;
  const blocks = Array.isArray(req?.blocks) ? req.blocks : [];
  const results: Array<FitResult & { blockIndex: number }> = [];

  for (const [i, block] of blocks.entries()) {
    // Keep the caller's ordinal wherever possible: the resolver matches results
    // back to placeholders by `blockIndex`, so inventing one strands a block.
    const blockIndex = typeof block?.blockIndex === "number" ? block.blockIndex : i;
    const mimeType = typeof block?.mimeType === "string" ? block.mimeType : "";
    if (typeof block?.data !== "string" || mimeType === "") {
      results.push({ data: "", mimeType, fitted: false, failed: true, blockIndex });
      continue;
    }
    try {
      const fit = await fitImageBlockForDisplay({ data: block.data, mimeType });
      results.push({ ...fit, blockIndex });
    } catch {
      results.push({ data: "", mimeType, fitted: false, failed: true, blockIndex });
    }
  }
  return { jobId, results };
}

// ── Worker bootstrap ────────────────────────────────────────────────
// Only runs when this module is the entry of a `worker_threads` Worker.
// Direct imports (tests, in-process fallback) skip this block.
if (!isMainThread && parentPort !== null) {
  parentPort.on("message", (msg: FitRequest | { type: "shutdown" }) => {
    // `"type" in msg` throws on a primitive or null, which would kill the
    // worker and strand every in-flight job on this slot.
    if (typeof msg !== "object" || msg === null) return;
    if ("type" in msg && (msg as { type: string }).type === "shutdown") {
      parentPort!.close();
      return;
    }
    // `fitBlocks` is total, but a post-back failure must still not leave the
    // pool waiting for a message that can never arrive.
    void fitBlocks(msg as FitRequest)
      .then((out) => parentPort!.postMessage(out))
      .catch(() => {
        const req = msg as Partial<FitRequest>;
        try {
          parentPort!.postMessage({ jobId: req?.jobId ?? 0, results: [] });
        } catch {
          /* port already closed — the pool's timeout owns it from here */
        }
      });
  });
}
