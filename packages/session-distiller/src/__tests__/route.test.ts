import { describe, it, expect } from "vitest";
import { buildRoutePlan, sinkFor, type ExistsFn } from "../route.js";
import { distill } from "../distill.js";
import type { HeldCluster } from "../cluster.js";
import type { SignalClass } from "../types.js";

function cluster(signal: SignalClass, signature: string, extra: Record<string, unknown> = {}): HeldCluster {
  return {
    signature,
    signal,
    sessionIds: ["s1", "s2", "s3"],
    lastSeen: "",
    sample: { signal, sessionId: "s1", signature, verified: true, ...extra } as never,
  };
}

describe("sink routing (task 4.4)", () => {
  it("maps each signal class to the correct sink", () => {
    expect(sinkFor("procedure")).toEqual({ sink: "skill_manage" });
    expect(sinkFor("fault")).toMatchObject({ sink: "memory", memoryTarget: "failure" });
    expect(sinkFor("ask_user_decision")).toMatchObject({ sink: "memory", memoryTarget: "project", memoryCategory: "convention" });
    expect(sinkFor("documentation")).toEqual({ sink: "docs" });
  });

  it("flags AGENTS.md patch for a rule-establishing correction", () => {
    const c = cluster("user_correction", "correction:always-grep-docs-first", { rule: true, correction: "always grep docs first" });
    const a = distill(c, { n: 3 });
    const plan = buildRoutePlan([a], {
      clustersBySignature: new Map([[a.signature, c]]),
    });
    expect(plan.entries[0].patchesAgentsMd).toBe(true);
    expect(plan.entries[0].memoryCategory).toBe("correction");
  });

  it("does not flag AGENTS.md for a non-rule correction", () => {
    const c = cluster("user_correction", "correction:use-forks", { rule: false, correction: "use forks" });
    const a = distill(c, { n: 3 });
    const plan = buildRoutePlan([a], { clustersBySignature: new Map([[a.signature, c]]) });
    expect(plan.entries[0].patchesAgentsMd).toBe(false);
  });
});

describe("dedup + dry-run (tasks 4.4, 4.5)", () => {
  it("defaults to dry-run and writes nothing", () => {
    const a = distill(cluster("fault", "fault:bash:enoent"), { n: 3 });
    const plan = buildRoutePlan([a]);
    expect(plan.dryRun).toBe(true);
  });

  it("re-apply over an existing corpus merges instead of creating duplicates", () => {
    const a = distill(cluster("fault", "fault:bash:enoent"), { n: 3 });
    const alwaysExists: ExistsFn = () => true;
    const plan = buildRoutePlan([a], { dryRun: false, exists: alwaysExists });
    expect(plan.entries.every((e) => e.action === "merge")).toBe(true);
    expect(plan.entries.filter((e) => e.action === "create").length).toBe(0);
  });

  it("creates when the sink has no matching entry", () => {
    const a = distill(cluster("procedure", "procedure:read>write>bash"), { n: 3 });
    const plan = buildRoutePlan([a], { dryRun: false, exists: () => false });
    expect(plan.entries[0].action).toBe("create");
  });
});
