/**
 * OpenSpec poll worker — derives per-change artifact status and serializes
 * the resulting `OpenSpecData` payload off the main event loop.
 *
 * The main thread keeps ownership of the `openspec list` CLI spawn, the
 * spawn-concurrency semaphore, the per-cwd cache, and the broadcast. This
 * worker performs only:
 *   - per-change `effectiveMtimeOr` pre-call stats (we accept pre-call mtimes
 *     from main, then compute the post-call mtime here for TOCTOU)
 *   - `deriveArtifactStatus()` for non-cached changes
 *   - `buildOpenSpecData()` assembly + design/specs promote-only overrides
 *   - optional groupId join (no async I/O — assignments are passed in)
 *   - `JSON.stringify()` of the final payload
 *
 * Output is identical (byte-for-byte) to the prior in-process derivation;
 * the parity test in `__tests__/openspec-poll-worker.test.ts` locks the contract.
 *
 * The exported `deriveAndSerialize(req)` function IS the entire worker body.
 * The `parentPort` bootstrap at the bottom just wires it onto a thread; tests
 * import the function directly to avoid spawning a real worker.
 *
 * See change: offload-openspec-poll-to-worker.
 */
import { isMainThread, parentPort } from "node:worker_threads";
import * as path from "node:path";
import {
  buildOpenSpecData,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
  deriveArtifactStatus,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  effectiveMtimeOr,
  perChangeArtifactPaths,
} from "./openspec-poll-fs-helpers.js";

export interface PollWorkerPerChangeIn {
  /** Change name (matches `listResult[i].name`). */
  name: string;
  /** Cache hit data, if any. When `gateEnabled && cached.mtimeMs === <worker-computed preCallMtime>`, the worker reuses cached artifacts. */
  cached: {
    mtimeMs: number | undefined;
    artifacts: Array<{ id: string; status: string }>;
    isComplete?: boolean;
  } | null;
}

export interface PollWorkerRequest {
  cwd: string;
  changesRoot: string;
  hasOpenspecDir: boolean;
  gateEnabled: boolean;
  listResult: Array<{ name: string; status: string; completedTasks: number; totalTasks: number }>;
  perChange: PollWorkerPerChangeIn[];
  /** Per-change `groupId` map (typically read from `openspec-group-store` on the main thread). Empty map = no join. */
  groupAssignments: Record<string, string>;
}

export interface PollWorkerResponse {
  cwd: string;
  data: OpenSpecData;
  /** `JSON.stringify(data)` — done in-worker so the main loop never stringifies the large payload. */
  serialized: string;
  /** Per-change mtime to stamp into the main-thread cache. Racy entries omit `stampMtime` and appear in `racyNames`. */
  stampMtimes: Record<string, number | undefined>;
  racyNames: string[];
}

/**
 * Pure derivation + serialization. Safe to call on the main thread (fallback)
 * or inside a `worker_threads` Worker (normal path).
 */
export function deriveAndSerialize(req: PollWorkerRequest): PollWorkerResponse {
  const { cwd, changesRoot, hasOpenspecDir, gateEnabled, listResult, perChange, groupAssignments } = req;

  const designFactory = createFsProbeFactory(cwd);
  const specsFactory = createFsSpecsProbeFactory(cwd);

  const statusResults = new Map<
    string,
    { artifacts?: Array<{ id: string; status: string }>; isComplete?: boolean } | null
  >();
  const stampMtimes: Record<string, number | undefined> = {};
  const racyNames: string[] = [];

  const perChangeByName = new Map(perChange.map((p) => [p.name, p]));

  for (const c of listResult) {
    const entry = perChangeByName.get(c.name);
    const cached = entry?.cached ?? null;
    // Compute pre-call mtime in the worker. Pre + post bracket the local
    // derive (`deriveArtifactStatus`) — same window the pre-worker code
    // measured in `directory-service.ts::pollOne()`. See change:
    // offload-openspec-poll-to-worker.
    const preCallMtime = effectiveMtimeOr(perChangeArtifactPaths(changesRoot, c.name));

    // Gated cache hit — reuse cached artifacts; stamp current preCallMtime
    // (matches pre-worker behavior at directory-service.ts).
    if (gateEnabled && cached && cached.mtimeMs !== undefined && cached.mtimeMs === preCallMtime) {
      statusResults.set(c.name, {
        artifacts: cached.artifacts,
        ...(cached.isComplete !== undefined ? { isComplete: cached.isComplete } : {}),
      });
      stampMtimes[c.name] = preCallMtime;
      continue;
    }

    // Derive locally — matches the in-process force===false path.
    const status = deriveArtifactStatus(path.join(changesRoot, c.name), c, {
      design: designFactory(c.name),
      specs: specsFactory(c.name),
    });

    // TOCTOU re-stat: discard if any tracked artifact moved during derivation.
    const postCallMtime = effectiveMtimeOr(perChangeArtifactPaths(changesRoot, c.name));
    if (preCallMtime !== postCallMtime) {
      racyNames.push(c.name);
      if (cached) {
        // Reuse prior cached status so the payload doesn't render an empty
        // artifact list for this tick (matches directory-service behavior).
        statusResults.set(c.name, {
          artifacts: cached.artifacts,
          ...(cached.isComplete !== undefined ? { isComplete: cached.isComplete } : {}),
        });
      }
      // Omit stampMtime → main thread skips cache.changes write for this name.
      continue;
    }

    statusResults.set(c.name, status);
    stampMtimes[c.name] = preCallMtime;
  }

  let data: OpenSpecData = buildOpenSpecData(
    { changes: listResult },
    statusResults,
    designFactory,
    specsFactory,
  );
  data = { ...data, hasOpenspecDir };

  // Optional groupId join. Inlined here (same shape as
  // `joinGroupIdsToOpenSpecData` in `openspec-group-store.ts`) so the worker
  // doesn't take a server-internal dependency.
  if (Object.keys(groupAssignments).length > 0 && Array.isArray(data.changes)) {
    data = {
      ...data,
      changes: data.changes.map((c) => ({
        ...c,
        groupId: groupAssignments[c.name] ?? null,
      })),
    };
  } else if (Array.isArray(data.changes)) {
    // Normalize missing groupId to null so payloads with and without an
    // enrichment map remain byte-identical in shape (parity test relies on
    // strict equality with the in-process baseline, which uses the same
    // unenriched shape).
    // No-op: leave changes untouched when assignments is empty. The
    // in-process baseline omits groupId too.
  }

  const serialized = JSON.stringify(data);
  return { cwd, data, serialized, stampMtimes, racyNames };
}

// ── Worker bootstrap ────────────────────────────────────────────────
// Only runs when this module is loaded as the entry of a `worker_threads`
// Worker. Direct imports (tests, in-process fallback) skip this block.
if (!isMainThread && parentPort !== null) {
  parentPort.on("message", (msg: { id: number; payload: PollWorkerRequest } | { type: "shutdown" }) => {
    if ("type" in msg && msg.type === "shutdown") {
      parentPort!.close();
      return;
    }
    const { id, payload } = msg as { id: number; payload: PollWorkerRequest };
    try {
      const response = deriveAndSerialize(payload);
      parentPort!.postMessage({ id, ok: true, response });
    } catch (err) {
      parentPort!.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
