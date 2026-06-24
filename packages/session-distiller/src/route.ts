/**
 * Dedup + route + dry-run (tasks 4.4, 4.5).
 * Maps each distilled artifact to its sink, queries the sink for an existing
 * entry (injectable) to decide merge-vs-create, and defaults to dry-run: a
 * routing plan is emitted and nothing is written unless --apply is given.
 *
 * Routing (design.md "Signal -> anchor -> sink map"):
 *   procedure         -> skill_manage
 *   fault             -> memory(failure)               [tool-quirk]
 *   user_correction   -> memory(failure)               [correction] (+AGENTS.md if rule)
 *   ask_user_decision -> memory(project)               [convention]
 *   documentation     -> docs/ + ctx_index
 */
import type { Artifact } from "./distill.js";
import type { CorrectionCandidate, SignalClass } from "./types.js";
import type { HeldCluster } from "./cluster.js";

export type Sink = "skill_manage" | "memory" | "docs";
export type MemoryTarget = "failure" | "project" | "user";

export interface RouteEntry {
  signature: string;
  signal: SignalClass;
  sink: Sink;
  memoryTarget?: MemoryTarget;
  memoryCategory?: string;
  patchesAgentsMd: boolean;
  action: "create" | "merge";
  stale: boolean;
  artifact: Artifact;
}

export interface RoutePlan {
  entries: RouteEntry[];
  dryRun: boolean;
}

/** Does this artifact's promoted cluster establish a reusable rule? */
function establishesRule(cluster: HeldCluster | undefined): boolean {
  return (
    cluster?.signal === "user_correction" &&
    (cluster.sample as CorrectionCandidate).rule === true
  );
}

interface SinkSpec {
  sink: Sink;
  memoryTarget?: MemoryTarget;
  memoryCategory?: string;
}

export function sinkFor(signal: SignalClass): SinkSpec {
  switch (signal) {
    case "procedure":
      return { sink: "skill_manage" };
    case "fault":
      return { sink: "memory", memoryTarget: "failure", memoryCategory: "tool-quirk" };
    case "user_correction":
      return { sink: "memory", memoryTarget: "failure", memoryCategory: "correction" };
    case "ask_user_decision":
      return { sink: "memory", memoryTarget: "project", memoryCategory: "convention" };
    case "documentation":
      return { sink: "docs" };
  }
}

/** A predicate that reports whether the target sink already holds this artifact. */
export type ExistsFn = (artifact: Artifact, spec: SinkSpec) => boolean;

const NEVER_EXISTS: ExistsFn = () => false;

export interface PlanOptions {
  dryRun?: boolean;
  exists?: ExistsFn;
  clustersBySignature?: Map<string, HeldCluster>;
}

/** Build the routing plan from distilled artifacts. */
export function buildRoutePlan(artifacts: Artifact[], opts: PlanOptions = {}): RoutePlan {
  const exists = opts.exists ?? NEVER_EXISTS;
  const clusters = opts.clustersBySignature;
  const entries: RouteEntry[] = artifacts.map((artifact) => {
    const spec = sinkFor(artifact.signal);
    const cluster = clusters?.get(artifact.signature);
    return {
      signature: artifact.signature,
      signal: artifact.signal,
      sink: spec.sink,
      memoryTarget: spec.memoryTarget,
      memoryCategory: spec.memoryCategory,
      patchesAgentsMd: establishesRule(cluster),
      action: exists(artifact, spec) ? "merge" : "create",
      stale: artifact.stale,
      artifact,
    };
  });
  return { entries, dryRun: opts.dryRun ?? true };
}

/** Human-readable summary of a plan (used by the skill's dry-run review). */
export function summarizePlan(plan: RoutePlan): string {
  const lines = [
    `Routing plan (${plan.dryRun ? "DRY-RUN — no writes" : "APPLY"}): ${plan.entries.length} artifact(s)`,
  ];
  for (const e of plan.entries) {
    const tgt =
      e.sink === "memory" ? `memory(${e.memoryTarget}/${e.memoryCategory})` : e.sink;
    const flags = [
      e.action,
      e.patchesAgentsMd ? "+AGENTS.md" : "",
      e.stale ? "STALE" : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`  - ${e.signal} -> ${tgt} [${flags}] conf=${e.artifact.provenance.confidence.toFixed(2)}`);
  }
  return lines.join("\n");
}
