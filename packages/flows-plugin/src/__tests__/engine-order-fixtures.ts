/**
 * Engine-order fixture step lists (raw pi-flows `type`), hand-copied from the
 * repo flows. Shared by flow-edges + FlowGraph tests. See change:
 * fix-flow-graph-engine-order (test-plan.md fixture shapes).
 */
import type { FlowEdgeStep } from "../client/flow-edges.js";

/** notes-to-issues */
export const NTI: FlowEdgeStep[] = [
  { id: "read", type: "code-decision", blockedBy: [], branches: { some: "triage", none: "report" }, onError: "report" },
  { id: "triage", type: "agent", blockedBy: [], onError: "report" },
  { id: "cleanup", type: "code", blockedBy: [], onError: "report" },
  { id: "report", type: "code", blockedBy: [] },
];

/** update-dashboard */
export const UPD: FlowEdgeStep[] = [
  { id: "pull", type: "code-decision", blockedBy: [], branches: { ok: "build", diverged: "rebase" }, onError: "report" },
  { id: "rebase", type: "code-decision", blockedBy: [], branches: { ok: "build", conflict: "resolve" }, onError: "resolve" },
  { id: "resolve", type: "agent", blockedBy: [], onError: "report" },
  { id: "check", type: "code-decision", blockedBy: [], branches: { retry: "resolve", ok: "build" }, onError: "report" },
  { id: "build", type: "code-decision", blockedBy: [], branches: { ok: "launch", fail: "resolve" }, onError: "report" },
  { id: "launch", type: "code", blockedBy: [], onError: "report" },
  { id: "report", type: "code", blockedBy: [] },
];

/** ship-dispatch (current) */
export const SD4: FlowEdgeStep[] = [
  { id: "start", type: "code-decision", blockedBy: [], branches: { run: "dispatch", busy: "report" } },
  { id: "dispatch", type: "code", blockedBy: [], onError: "report" },
  { id: "retire", type: "code", blockedBy: [], onError: "report" },
  { id: "report", type: "code", blockedBy: [] },
];

/** 10-step code-chain shape (ship-dispatch's earlier revision, mock frame 1) */
export const CC10: FlowEdgeStep[] = [
  { id: "start", type: "code-decision", blockedBy: [], branches: { run: "pick", busy: "report" } },
  { id: "pick", type: "code-decision", blockedBy: [], branches: { go: "worktree", none: "retire" }, onError: "report" },
  { id: "worktree", type: "code", blockedBy: [], onError: "fail" },
  { id: "init", type: "code", blockedBy: [], onError: "fail" },
  { id: "spawn", type: "code", blockedBy: [], onError: "fail" },
  { id: "record", type: "code-decision", blockedBy: [], branches: { more: "loop", stop: "retire" }, onError: "report" },
  { id: "fail", type: "code-decision", blockedBy: [], branches: { more: "loop", stop: "retire" }, onError: "report" },
  { id: "loop", type: "code-decision", blockedBy: [], branches: { next: "pick", done: "retire" } },
  { id: "retire", type: "code", blockedBy: [], onError: "report" },
  { id: "report", type: "code", blockedBy: [] },
];

/** E8: in-segment on_error target. */
export const IN_SEGMENT_ON_ERROR: FlowEdgeStep[] = [
  { id: "s", type: "code", blockedBy: [] },
  { id: "a", type: "agent", blockedBy: [], onError: "b" },
  { id: "b", type: "agent", blockedBy: [] },
  { id: "z", type: "code", blockedBy: [] },
];
