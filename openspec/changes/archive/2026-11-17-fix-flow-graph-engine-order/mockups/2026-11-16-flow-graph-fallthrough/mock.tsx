// Live mock: the flows-plugin graph draws a different control flow than the pi-flows engine runs.
// Engine (pi-flows flow-execution.ts): agent steps group into a parallel DAG segment, EVERY other
// step (code, code-decision, fork, agent-decision) is its own segment; after a segment the program
// counter falls through to the NEXT DECLARED step unless a branch / on_complete / on_error jumps.
// Dashboard (flow-edges.ts + FlowGraph.computeLayout): `code` is not a separator, fall-through is
// only drawn for edge-less roots (from the last decision), and terminal on_error targets are
// excluded from the graph even when a success path also reaches them.
// Current = real FlowGraph fed the step data of the repo flows notes-to-issues + update-dashboard, and the
// 10-step code-chain shape of ship-dispatch's earlier revision (now 4 steps: start, dispatch, retire, report).
// Proposed = the SAME real FlowGraph fed the engine's order (fall-through added as blockedBy,
// report no longer collapsed into the error sink): a data-level preview of the edge-rule fix.
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { FLOW_SHOW_ERROR_ROUTES_KEY } from "@flows/client/flow-collapse-storage.ts";
import { computeLayout, FlowGraph, type FlowGraphStep } from "@flows/client/FlowGraph.tsx";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

// Rings are placed from computeLayout with error routes hidden (the shipped default).
try { localStorage.removeItem(FLOW_SHOW_ERROR_ROUTES_KEY); } catch { /* private mode */ }
const registry = createHostPrimitiveRegistry();

type S = FlowGraphStep;
const st = (id: string, type: S["type"] | undefined, extra: Partial<S> = {}): S =>
  ({ id, label: id, status: "pending", blockedBy: [], ...(type ? { type } : {}), ...extra });

// ---- code-chain shape (ship-dispatch's earlier 10-step revision), mid-run: init running ----
const shipCurrent: S[] = [
  st("start", "code-decision", { status: "complete", branches: { run: "pick", busy: "report" } }),
  st("pick", "code-decision", { status: "complete", branches: { go: "worktree", none: "retire" }, onError: "report" }),
  st("worktree", "code", { status: "complete", onError: "fail" }),
  st("init", "code", { status: "running", onError: "fail" }),
  st("spawn", "code", { onError: "fail" }),
  st("record", "code-decision", { branches: { more: "loop", stop: "retire" }, onError: "report" }),
  st("fail", "code-decision", { branches: { more: "loop", stop: "retire" }, onError: "report" }),
  st("loop", "code-decision", { branches: { next: "pick", done: "retire" } }),
  st("retire", "code", { onError: "report" }),
  st("report", "code"),
];
const shipProposed: S[] = shipCurrent.map((s) => {
  const fall: Record<string, string[]> = { init: ["worktree"], spawn: ["init"], record: ["spawn"], report: ["retire"] };
  const { onError, ...rest } = s;
  return { ...rest, ...(onError && onError !== "report" ? { onError } : {}), ...(fall[s.id] ? { blockedBy: fall[s.id] } : {}) };
});

// ---- notes-to-issues, mid-run: triage running ----
const notesCurrent: S[] = [
  st("read", "code-decision", { status: "complete", branches: { none: "report", some: "triage" }, onError: "report" }),
  st("triage", undefined, { status: "running", onError: "report" }),
  st("cleanup", "code", { onError: "report" }),
  st("report", "code"),
];
const notesProposed: S[] = [
  st("read", "code-decision", { status: "complete", branches: { none: "report", some: "triage" } }),
  st("triage", undefined, { status: "running" }),
  st("cleanup", "code", { blockedBy: ["triage"] }),
  st("report", "code", { blockedBy: ["cleanup"] }),
];

// ---- update-dashboard, mid-run: resolve running after a conflict ----
const updCurrent: S[] = [
  st("pull", "code-decision", { status: "complete", branches: { ok: "build", diverged: "rebase" }, onError: "report" }),
  st("rebase", "code-decision", { status: "complete", branches: { ok: "build", conflict: "resolve" }, onError: "resolve" }),
  st("resolve", undefined, { status: "running", onError: "report" }),
  st("check", "code-decision", { branches: { retry: "resolve", ok: "build" }, onError: "report" }),
  st("build", "code-decision", { branches: { ok: "launch", fail: "resolve" }, onError: "report" }),
  st("launch", "code", { onError: "report" }),
  st("report", "code"),
];
const updProposed: S[] = updCurrent.map((s) => {
  const fall: Record<string, string[]> = { check: ["resolve"], report: ["launch"] };
  const { onError: _drop, ...rest } = s;
  return { ...rest, ...(fall[s.id] ? { blockedBy: fall[s.id] } : {}) };
});

// ---- graph + ring overlay ----
type Ring = { at: string; n: number; tip: string };
function Graph({ steps, rings, kind }: { steps: S[]; rings: Ring[]; kind: "issue" | "fix" }): ReactNode {
  const L = computeLayout(steps, { showErrorRoutes: false });
  const w = Math.max(L.width, 150);
  const h = Math.max(L.height, 50);
  const Ring = kind === "issue" ? Issue : Fix;
  return (
    <UiPrimitiveProvider value={registry}>
      <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 overflow-auto">
        <div style={{ position: "relative", width: w, height: h }}>
          <FlowGraph steps={steps} />
          {rings.map((r) => {
            const node = L.nodes.find((x) => x.id === r.at);
            if (!node) return null;
            return (
              <div key={r.n} style={{ position: "absolute", left: node.x - 3, top: node.y - 3, width: node.width + 6, height: node.height + 6 }}>
                <Ring n={r.n} tip={r.tip} block><div style={{ width: node.width + 6, height: node.height + 6 }} /></Ring>
              </div>
            );
          })}
        </div>
      </div>
    </UiPrimitiveProvider>
  );
}

const mock: Mock = {
  title: "Flow graph - next step after a node",
  category: "Flows plugin",
  frames: [
    {
      title: "Code chain (ship-dispatch earlier revision)",
      width: 1040,
      why: "Code steps run in order worktree, init, spawn, record; the graph fans them out from pick.",
      current: <Graph steps={shipCurrent} kind="issue" rings={[
        { at: "worktree", n: 1, tip: "Dead end: what runs after worktree?" },
        { at: "init", n: 2, tip: "Runs after worktree, drawn off pick" },
        { at: "spawn", n: 3, tip: "Runs after init, drawn off pick" },
        { at: "record", n: 4, tip: "Runs after spawn, drawn off pick" },
        { at: "retire", n: 5, tip: "report runs next but is not drawn" },
        { at: "start", n: 6, tip: "busy -> report edge dropped" },
      ]} />,
      proposed: <Graph steps={shipProposed} kind="fix" rings={[
        { at: "worktree", n: 1, tip: "worktree -> init" },
        { at: "init", n: 2, tip: "Chained in engine order" },
        { at: "spawn", n: 3, tip: "init -> spawn" },
        { at: "record", n: 4, tip: "spawn -> record" },
        { at: "report", n: 5, tip: "retire -> report, last step shown" },
        { at: "start", n: 6, tip: "busy branch reaches report" },
      ]} />,
    },
    {
      title: "notes-to-issues - agent then code",
      width: 760,
      why: "triage (agent) falls through to cleanup, then report; the graph shows triage as a dead end.",
      current: <Graph steps={notesCurrent} kind="issue" rings={[
        { at: "triage", n: 1, tip: "Running: no next step drawn" },
        { at: "cleanup", n: 2, tip: "Runs after triage, drawn off read" },
        { at: "read", n: 3, tip: "none -> report edge dropped" },
      ]} />,
      proposed: <Graph steps={notesProposed} kind="fix" rings={[
        { at: "triage", n: 1, tip: "triage -> cleanup" },
        { at: "cleanup", n: 2, tip: "cleanup -> report" },
        { at: "read", n: 3, tip: "none branch reaches report" },
      ]} />,
    },
    {
      title: "update-dashboard - loop back through resolve",
      width: 1040,
      why: "After resolve the engine runs check; the graph draws check after rebase and hides report.",
      current: <Graph steps={updCurrent} kind="issue" rings={[
        { at: "resolve", n: 1, tip: "Running: no next step drawn" },
        { at: "check", n: 2, tip: "Runs after resolve, drawn off rebase" },
        { at: "launch", n: 3, tip: "report runs next but is not drawn" },
      ]} />,
      proposed: <Graph steps={updProposed} kind="fix" rings={[
        { at: "resolve", n: 1, tip: "resolve -> check" },
        { at: "check", n: 2, tip: "check after resolve" },
        { at: "report", n: 3, tip: "launch -> report, last step shown" },
      ]} />,
    },
  ],
};
export default mock;
