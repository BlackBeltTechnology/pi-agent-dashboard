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

import * as path from "node:path";
import { isMainThread, parentPort } from "node:worker_threads";
import {
  buildOpenSpecData,
  buildOpenSpecDataFromStatusAll,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
  deriveArtifactStatus,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import {
  classifyStatusAll,
  type StatusAllRaw,
  type TrackedExtras,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { computeDependencies, summarizeDependencyGraph } from "./openspec-dependency-inputs.js";
import {
  effectiveMtimeOr,
  type ProbeRequest,
  type ProbeResponse,
  perChangeArtifactPaths,
  probeTrackedPaths,
} from "./openspec-poll-fs-helpers.js";
import { computeSchemaStatus, type SchemaStatusResult } from "./workflow-schema-status.js";

export type { ProbeRequest, ProbeResponse };
export { probeTrackedPaths };

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
 * Attach `hasOpenspecDir` and the optional groupId join. Inlined (same shape as
 * `joinGroupIdsToOpenSpecData` in `openspec-group-store.ts`) so the worker
 * doesn't take a server-internal dependency. With no assignments the changes
 * are left untouched, keeping payloads byte-identical to the unenriched
 * in-process baseline the parity test compares against.
 */
function finishPayload(
  built: OpenSpecData,
  hasOpenspecDir: boolean,
  groupAssignments: Record<string, string>,
): OpenSpecData {
  let data: OpenSpecData = { ...built, hasOpenspecDir };
  if (Object.keys(groupAssignments).length > 0 && Array.isArray(data.changes)) {
    data = {
      ...data,
      changes: data.changes.map((c) => ({ ...c, groupId: groupAssignments[c.name] ?? null })),
    };
  }
  return data;
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

  const data = finishPayload(
    buildOpenSpecData({ changes: listResult }, statusResults, designFactory, specsFactory),
    hasOpenspecDir,
    groupAssignments,
  );

  const serialized = JSON.stringify(data);
  return { cwd, data, serialized, stampMtimes, racyNames };
}

// ── `openspec status --all` build request ───────────────────────────
//
// The main thread owns the CLI spawn; the worker owns everything after it:
// envelope classification, JSON parsing, local task counting, the post-call
// TOCTOU re-probe, payload build and serialization.
// See change: use-openspec-status-all.

export interface StatusAllBuildRequest {
  cwd: string;
  /** Server-canonical `<cwd>/openspec` directory (realpath). */
  openspecDir: string;
  hasOpenspecDir: boolean;
  raw: StatusAllRaw;
  /** The request the pre-call probe ran with (the post-call re-probe reuses it). */
  probeReq: ProbeRequest;
  /** The pre-call probe result. */
  pre: ProbeResponse;
  /** Previously cached changes, preserved for racy names. */
  cachedChanges: Record<string, OpenSpecChange>;
  groupAssignments: Record<string, string>;
}

export type StatusAllBuildResponse =
  | { cwd: string; kind: "unsupported" }
  | { cwd: string; kind: "failed"; reason: string }
  | {
      cwd: string;
      kind: "ok";
      data: OpenSpecData;
      serialized: string;
      /** Stamp per non-racy change (pre-call mtime, or the new-set mtime when the tracked set changed). */
      stampMtimes: Record<string, number | undefined>;
      /** Changed during the call (or created between probe and spawn): keep prior entry / leave unstamped. */
      racyNames: string[];
      /** Pre-call cwd-level stamp; `undefined` when a cwd-level path changed during the call. */
      cwdStamp: number | undefined;
      /** Tracked extras per change for the next probe and the watcher filter. */
      extras: Record<string, TrackedExtras>;
      /**
       * Capability ids touched by an active delta, stored with the gate stamp:
       * the next probe stats their main-spec paths. See change: add-openspec-change-dependencies.
       */
      capabilityIds: string[];
    };

function sameExtras(a: TrackedExtras | undefined, b: TrackedExtras | undefined): boolean {
  if (!a || !b) return a === b;
  const key = (e: TrackedExtras) => JSON.stringify([[...e.files].sort(), [...e.globPrefixes].sort()]);
  return key(a) === key(b);
}

const debugEnabled = () => typeof process !== "undefined" && /pi-dashboard|openspec-poll/.test(process.env?.DEBUG ?? "");

interface TocTouResult {
  changes: OpenSpecChange[];
  stampMtimes: Record<string, number | undefined>;
  racyNames: string[];
  /** Changes whose tracked set grew: they need a stamp over the NEW set. */
  needNewSetStamp: string[];
}

/**
 * Compare the pre- and post-call probes per change. Deleted during the call →
 * pruned (beats preservation); created between probe and spawn → applied but
 * left unstamped; changed during the call → previous entry kept (racy).
 */
function reconcileWithPostProbe(
  built: OpenSpecChange[],
  extras: Record<string, TrackedExtras>,
  req: StatusAllBuildRequest,
  post: ProbeResponse,
): TocTouResult {
  const { pre, probeReq, cachedChanges } = req;
  const preNames = new Set(pre.names);
  const postNames = new Set(post.names);
  const out: TocTouResult = { changes: [], stampMtimes: {}, racyNames: [], needNewSetStamp: [] };
  for (const change of built) {
    const name = change.name;
    if (!postNames.has(name)) continue;
    if (!preNames.has(name)) {
      out.racyNames.push(name);
      out.changes.push(change);
    } else if (pre.changes[name] !== post.changes[name]) {
      out.racyNames.push(name);
      if (debugEnabled()) {
        // eslint-disable-next-line no-console
        console.warn(
          `[fix-openspec-mtime-gate-toctou] discarded racy status for ${name} (pre=${pre.changes[name]} post=${post.changes[name]})`,
        );
      }
      out.changes.push(cachedChanges[name] ?? change);
    } else {
      out.changes.push(change);
      out.stampMtimes[name] = pre.changes[name];
      if (!sameExtras(probeReq.extras?.[name], extras[name])) out.needNewSetStamp.push(name);
    }
  }
  return out;
}

export async function buildFromStatusAll(req: StatusAllBuildRequest): Promise<StatusAllBuildResponse> {
  const { cwd, openspecDir, hasOpenspecDir, raw, probeReq, pre, groupAssignments } = req;
  const classified = classifyStatusAll(raw);
  if (classified.kind === "unsupported") return { cwd, kind: "unsupported" };
  if (classified.kind === "failed") return { cwd, kind: "failed", reason: classified.reason };

  const built = await buildOpenSpecDataFromStatusAll({
    cwd,
    openspecDir,
    rootPath: classified.root.path,
    entries: classified.entries,
    orderMtimes: pre.changes,
  });

  // TOCTOU: re-take the same probe after the call.
  const post = await probeTrackedPaths(probeReq);
  const rec = reconcileWithPostProbe(built.data.changes, built.extras, req, post);

  // The tracked set a change is stamped over must be the one the NEXT gated
  // tick will probe, else the first tick after a cold poll always re-spawns.
  if (rec.needNewSetStamp.length > 0) {
    const reprobe = await probeTrackedPaths({ openspecDir, extras: built.extras });
    for (const name of rec.needNewSetStamp) rec.stampMtimes[name] = reprobe.changes[name];
  }

  // Dependency graph: always recomputed from the files read in THIS build, for
  // every change — including racy ones whose other fields keep the previous
  // entry — so `blocks` / `blockedBy` stay inverse within one payload.
  const dep = await computeDependencies(
    openspecDir,
    rec.changes.map((c) => c.name),
    post.changes,
  );
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.debug(summarizeDependencyGraph(dep.graph, dep.ms));
  }
  const changes = rec.changes.map((c) => ({ ...c, dependencies: dep.graph[c.name] }));

  // The cwd-level stamp must cover the paths the NEXT probe will stat; when the
  // touched capability set moved, re-take the cwd-level mtime over the new set.
  const prevCaps = probeReq.capabilityIds ? [...probeReq.capabilityIds].sort().join("\n") : null;
  let cwdStamp = pre.cwdMtime === post.cwdMtime ? pre.cwdMtime : undefined;
  if (cwdStamp !== undefined && prevCaps !== dep.capabilityIds.join("\n")) {
    const restamp = (await probeTrackedPaths({ openspecDir, extras: built.extras, capabilityIds: dep.capabilityIds })).cwdMtime;
    // The new stamp is taken AFTER the main-spec reads it covers. A spec sync landing in between would be inside
    // the stamp but missing from the graph, and the next gated tick would reuse the stale payload. Re-read once
    // (warm: per-file parses are cached); keep the stamp only if the graph did not move.
    const again = await computeDependencies(
      openspecDir,
      rec.changes.map((c) => c.name),
      post.changes,
    );
    const same = again.capabilityIds.join("\n") === dep.capabilityIds.join("\n") && JSON.stringify(again.graph) === JSON.stringify(dep.graph);
    cwdStamp = same ? restamp : undefined;
  }

  const data = finishPayload({ initialized: true, changes }, hasOpenspecDir, groupAssignments);
  return {
    cwd,
    kind: "ok",
    data,
    serialized: JSON.stringify(data),
    stampMtimes: rec.stampMtimes,
    racyNames: rec.racyNames,
    cwdStamp,
    extras: built.extras,
    capabilityIds: dep.capabilityIds,
  };
}

// ── `schemaStatus` request ──────────────────────────────────────────
//
// Filesystem part of `OpenSpecData.workflowSchema`, computed on every poll tick
// (gate hit or not). The main thread resolves the CLI-dependent inputs and runs
// the `newer`/`conflict` `schema validate` for the returned fingerprint.
// See change: move-workflow-schema-status-to-poll-worker.

export interface SchemaStatusRequest {
  cwd: string;
  /** Resolved CLI version; `""` when unknown. */
  localVersion: string;
  /** `<openspec package>/schemas`, `null` = unknown. Resolved on main. */
  packageSchemasDir: string | null;
  /** User-level schemas dir. Resolved on main. */
  userSchemasDir: string;
}

export type SchemaStatusResponse = SchemaStatusResult;

/** The whole worker body of the `schemaStatus` request (also the default in-process implementation). */
export function computeSchemaStatusFor(req: SchemaStatusRequest): Promise<SchemaStatusResponse> {
  return computeSchemaStatus(req.cwd, {
    localVersion: req.localVersion,
    packageSchemasDir: req.packageSchemasDir,
    userSchemasDirPath: req.userSchemasDir,
    fingerprint: "when-needed",
  });
}

// ── Worker bootstrap ────────────────────────────────────────────────
// Only runs when this module is loaded as the entry of a `worker_threads`
// Worker. Direct imports (tests, in-process fallback) skip this block.
export type PollWorkerKind = "derive" | "probe" | "build" | "schemaStatus";

/**
 * Run one request body. Exhaustive over the request kind: an unknown kind
 * rejects instead of silently running another request's body.
 */
export async function handlePollWorkerMessage(kind: PollWorkerKind | undefined, payload: unknown): Promise<unknown> {
  switch (kind) {
    case undefined: // legacy messages without a kind are `derive`
    case "derive":
      return deriveAndSerialize(payload as PollWorkerRequest);
    case "probe":
      return probeTrackedPaths(payload as ProbeRequest);
    case "build":
      return buildFromStatusAll(payload as StatusAllBuildRequest);
    case "schemaStatus":
      return computeSchemaStatusFor(payload as SchemaStatusRequest);
    default: {
      const unknownKind: never = kind;
      throw new Error(`unknown poll worker request kind: ${String(unknownKind)}`);
    }
  }
}

if (!isMainThread && parentPort !== null) {
  parentPort.on(
    "message",
    async (msg: { id: number; kind?: PollWorkerKind; payload: unknown } | { type: "shutdown" }) => {
      if ("type" in msg && msg.type === "shutdown") {
        parentPort!.close();
        return;
      }
      const { id, kind, payload } = msg as { id: number; kind?: PollWorkerKind; payload: unknown };
      try {
        const response = await handlePollWorkerMessage(kind, payload);
        parentPort!.postMessage({ id, ok: true, response });
      } catch (err) {
        parentPort!.postMessage({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
