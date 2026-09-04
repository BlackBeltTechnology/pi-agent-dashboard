/**
 * Matcher worker body — tests ONE `{ idx, pattern, customType }` per message
 * and posts back `{ idx, matched }` (design D3: one pattern per message is
 * what makes the offending group identifiable when the main thread kills the
 * worker on timeout).
 *
 * Spawned by `CustomEventGroupMatcher`; never imported for its exports.
 * See change: add-custom-event-group-filters.
 */
import { parentPort } from "node:worker_threads";

interface MatcherRequest {
  idx: number;
  pattern: string;
  customType: string;
}

export interface MatcherResponse {
  idx: number;
  matched: boolean;
}

if (parentPort !== null) {
  parentPort.on("message", (req: MatcherRequest) => {
    let matched = false;
    try {
      // Uncompilable patterns are already filtered at config load; belt and
      // braces — a compile failure here is a non-match, never a crash.
      matched = new RegExp(req.pattern).test(req.customType);
    } catch {
      matched = false;
    }
    parentPort!.postMessage({ idx: req.idx, matched } satisfies MatcherResponse);
  });

  // Readiness banner: the driver's per-message deadline bounds ONLY regex
  // execution, never thread boot + module load. Sent once, when this module
  // has fully loaded inside the thread.
  parentPort!.postMessage({ ready: true });
}
