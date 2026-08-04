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
import { fitImageBlockForDisplay, type ImageBlockInput, type FitResult } from "./display-fit.js";

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
  const results: Array<FitResult & { blockIndex: number }> = [];
  for (const block of req.blocks) {
    const fit = await fitImageBlockForDisplay({ data: block.data, mimeType: block.mimeType });
    results.push({ ...fit, blockIndex: block.blockIndex });
  }
  return { jobId: req.jobId, results };
}

// ── Worker bootstrap ────────────────────────────────────────────────
// Only runs when this module is the entry of a `worker_threads` Worker.
// Direct imports (tests, in-process fallback) skip this block.
if (!isMainThread && parentPort !== null) {
  parentPort.on("message", (msg: FitRequest | { type: "shutdown" }) => {
    if ("type" in msg && (msg as { type: string }).type === "shutdown") {
      parentPort!.close();
      return;
    }
    void fitBlocks(msg as FitRequest).then((out) => parentPort!.postMessage(out));
  });
}
