import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SessionState } from "../../chat/event-reducer.js";
import { end, event, random, row, start, text } from "./tool-map-ownership.js";
import { expect } from "vitest";

type Expected = { status: string; result?: string; nested?: { id: string; parentId: string; status: string; result?: string }[] };
export interface Action {
  event: DashboardEvent;
  noWrite?: boolean;
  expected: [string, Expected][];
}

/** Expected transitions are annotated while constructing valid inputs, not folded from reducer output. */
export function lifecycle(seed: number) {
  const draw = random(seed);
  const id = `read-${seed}`;
  const root = `root-${seed}`;
  const result = `done-${draw(10000)}`;
  const actions: Action[] = [];
  const expected = new Map<string, Expected>();
  const add = (e: DashboardEvent, noWrite = false) => actions.push({ event: e, noWrite, expected: structuredClone([...expected]) });
  const streak = 1 + draw(4);
  for (let i = 0; i < streak; i++) add(text(`prefix-${seed}-${i}`), true);
  expected.set(id, { status: "running" }); add(start(id));
  expected.set(id, { status: "running", result: "partial" });
  add(event("tool_execution_update", { toolCallId: id, partialResult: "partial" }), true);
  for (let i = 0; i < streak; i++) add(event("turn_end"), true);
  expected.set(id, { status: "complete", result }); add(end(id, result));
  // A late synthetic heal is ignored after a real outcome.
  add(event("tool_execution_end", { toolCallId: id, healedBy: "session_ended", result: "wrong", isError: true }), true);
  expected.set(root, { status: "running" }); add(start(root, "codemode"));
  const nested: NonNullable<Expected["nested"]> = [];
  const depth = 1 + draw(3);
  let parentId = root;
  for (let level = 0; level < depth; level++) {
    const child = `${parentId}/1`;
    nested.push({ id: child, parentId, status: "running" });
    expected.set(root, { status: "running", nested: structuredClone(nested) });
    add(event("tool_execution_start", { toolCallId: child, parentToolCallId: parentId, toolName: "read" }));
    parentId = child;
  }
  nested[depth - 1].result = "nested partial";
  expected.set(root, { status: "running", nested: structuredClone(nested) });
  add(event("tool_execution_update", { toolCallId: parentId, parentToolCallId: nested[depth - 1].parentId, partialResult: "nested partial" }));
  const childFirst = draw(2) === 1;
  if (childFirst) {
    nested[depth - 1] = { ...nested[depth - 1], status: "complete", result: "child done" };
    expected.set(root, { status: "running", nested: structuredClone(nested) });
    add(event("tool_execution_end", { toolCallId: parentId, parentToolCallId: nested[depth - 1].parentId, toolName: "read", result: "child done" }));
  }
  for (const entry of nested) if (entry.status === "running") entry.status = "unfinished";
  expected.set(root, { status: "complete", result: "root done", nested: structuredClone(nested) });
  add(end(root, "root done", "codemode"));
  nested[depth - 1] = { ...nested[depth - 1], status: "complete", result: "late child" };
  expected.set(root, { status: "complete", result: "root done", nested: structuredClone(nested) });
  add(event("tool_execution_end", { toolCallId: parentId, parentToolCallId: nested[depth - 1].parentId, toolName: "read", result: "late child" }));
  return { actions, depth, childFirst, streak };
}

export function assertLifecycle(state: SessionState, expected: Action["expected"]) {
  for (const [id, entry] of expected) {
    expect(state.toolCalls.get(id)?.status).toBe(entry.status);
    expect(row(state, id)?.toolStatus).toBe(entry.status);
    expect(row(state, id)?.result).toBe(entry.result);
    if (entry.nested) {
      expect(state.toolCalls.get(id)?.nested).toMatchObject(entry.nested);
      expect(row(state, id)?.nested).toMatchObject(entry.nested);
      for (const child of entry.nested) {
        expect(state.toolCalls.has(child.id)).toBe(false);
        expect(row(state, child.id)).toBeUndefined();
      }
    }
  }
}
