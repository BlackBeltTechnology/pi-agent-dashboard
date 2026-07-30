import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NestedProcessSupervisor } from "../nested-process-supervisor.js";

class FakeChild extends EventEmitter {
  pid = 42;
  sent: unknown[] = [];

  send(message: unknown) {
    this.sent.push(message);
    return true;
  }
}

const request = { runId: "run-1", cwd: "/tmp", prompt: "work" };

afterEach(() => vi.useRealTimers());

describe("NestedProcessSupervisor", () => {
  it("correlates concurrent runs and ignores cross-run and late events", async () => {
    const children = [new FakeChild(), new FakeChild()];
    const onEvent = vi.fn();
    const supervisor = new NestedProcessSupervisor({
      spawn: () => children.shift() as unknown as ChildProcess,
    });
    const childA = children[0];
    const childB = children[1];
    const runA = supervisor.run(request, { onEvent });
    const runB = supervisor.run({ ...request, runId: "run-2" }, { onEvent });

    childA.emit("message", { type: "event", runId: "run-2", event: "wrong" });
    childA.emit("message", { type: "result", runId: "run-1", result: "a" });
    childA.emit("message", { type: "event", runId: "run-1", event: "late" });
    childB.emit("message", { type: "result", runId: "run-2", result: "b" });

    await expect(runA).resolves.toMatchObject({ runId: "run-1", status: "completed", result: "a" });
    await expect(runB).resolves.toMatchObject({ runId: "run-2", status: "completed", result: "b" });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("settles once after cooperative abort", async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const supervisor = new NestedProcessSupervisor({ spawn: () => child as unknown as ChildProcess });
    const run = supervisor.run(request, { signal: controller.signal });

    controller.abort();
    expect(child.sent).toContainEqual({ type: "abort", runId: "run-1" });
    child.emit("message", { type: "result", runId: "run-1", result: "stopped" });
    child.emit("exit", 0);

    await expect(run).resolves.toMatchObject({ status: "aborted" });
  });

  it("escalates a non-cooperative child from SIGTERM to SIGKILL", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const controller = new AbortController();
    const killGroup = vi.fn();
    const supervisor = new NestedProcessSupervisor({
      cooperativeGraceMs: 20,
      killGraceMs: 10,
      spawn: () => child as unknown as ChildProcess,
      killGroup,
    });
    const run = supervisor.run(request, { signal: controller.signal });

    controller.abort();
    await vi.advanceTimersByTimeAsync(20);
    expect(killGroup).toHaveBeenCalledWith(42, "SIGTERM");
    await vi.advanceTimersByTimeAsync(10);
    expect(killGroup).toHaveBeenCalledWith(42, "SIGKILL");
    await expect(run).resolves.toMatchObject({ status: "forced" });
  });

  it("reports an event-loop-blocked child as forced when it exits after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const controller = new AbortController();
    const supervisor = new NestedProcessSupervisor({
      cooperativeGraceMs: 20,
      spawn: () => child as unknown as ChildProcess,
      killGroup: () => child.emit("exit", null, "SIGTERM"),
    });
    const run = supervisor.run(request, { signal: controller.signal });

    controller.abort();
    await vi.advanceTimersByTimeAsync(20);

    await expect(run).resolves.toMatchObject({ status: "forced" });
  });

  it("fails instead of waiting forever when a child makes no progress", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const killGroup = vi.fn();
    const supervisor = new NestedProcessSupervisor({
      idleTimeoutMs: 20,
      cooperativeGraceMs: 10,
      killGraceMs: 5,
      spawn: () => child as unknown as ChildProcess,
      killGroup,
    });
    const run = supervisor.run(request);

    await vi.advanceTimersByTimeAsync(20);
    expect(child.sent).toContainEqual({ type: "abort", runId: "run-1" });
    await vi.advanceTimersByTimeAsync(10);
    expect(killGroup).toHaveBeenCalledWith(42, "SIGTERM");
    await vi.advanceTimersByTimeAsync(5);
    expect(killGroup).toHaveBeenCalledWith(42, "SIGKILL");
    await expect(run).resolves.toMatchObject({ status: "error", error: "Nested run timed out without progress." });
  });

  it("extends the no-progress deadline while the worker reports active work", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const supervisor = new NestedProcessSupervisor({
      idleTimeoutMs: 20,
      spawn: () => child as unknown as ChildProcess,
    });
    const run = supervisor.run(request);

    await vi.advanceTimersByTimeAsync(19);
    child.emit("message", { type: "event", runId: "run-1", event: { type: "worker_active_tool" } });
    await vi.advanceTimersByTimeAsync(19);
    child.emit("message", { type: "result", runId: "run-1", result: "build finished" });

    await expect(run).resolves.toMatchObject({ status: "completed", result: "build finished" });
  });
});
