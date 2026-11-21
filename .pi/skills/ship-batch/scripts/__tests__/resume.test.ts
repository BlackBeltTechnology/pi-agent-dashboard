import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newItem, setState } from "../scheduler.ts";
import type { BatchState, Item, ItemState } from "../types.ts";
import { cleanupFixtures, FakeDashboard, type Fixture, makeFixture, readState, seedGroup, sh } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

function writeState(fx: Fixture, fd: FakeDashboard, items: (Partial<Item> & { change: string; state: ItemState })[]): void {
  const built = items.map((spec) => {
    const it = newItem(spec.change, fd.now());
    setState(it, spec.state, fd.now());
    return Object.assign(it, spec);
  });
  const state: BatchState = {
    version: 1,
    groupId: "g",
    groupName: "G",
    repo: fx.repo,
    params: { parallel: 2, maxLive: 4, nudges: 1, settleMs: 30_000, startTimeoutMs: 300_000, model: "@coding" },
    planArchive: [],
    items: built,
    alreadyShipped: [],
    createdAt: fd.now(),
    updatedAt: fd.now(),
    notes: [],
  };
  const dir = path.join(fx.repo, ".worktrees", ".ship-batch");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "g.json"), JSON.stringify(state));
}

describe("#X14 resume, no double spawn", () => {
  it("re-attaches running sessions and adopts the starting one; spawns nothing", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b", "c"]);
    const t0 = fd.now();
    writeState(fx, fd, [
      { change: "a", state: "running", sessionId: "sA", worktree: fd.worktree("a"), lastPromptAt: t0 },
      { change: "b", state: "running", sessionId: "sB", worktree: fd.worktree("b"), lastPromptAt: t0 },
      { change: "c", state: "starting", spawnRequestedAt: t0, worktree: fd.worktree("c") },
    ]);
    fd.tick(5_000);
    fd.addSession("sA", fd.worktree("a"), "streaming", t0);
    fd.addSession("sB", fd.worktree("b"), "streaming", t0);
    fd.addSession("sC", fd.worktree("c"), "streaming", t0 + 1_000);
    const runner = fd.runner();
    await fd.boot(runner);
    await runner.tick();
    expect(fd.spawned).toHaveLength(0);
    const st = readState(fx);
    expect(st.items.map((i) => [i.change, i.state, i.sessionId])).toEqual([
      ["a", "running", "sA"],
      ["b", "running", "sB"],
      ["c", "running", "sC"],
    ]);
  });

  it("a recorded session that vanished while the runner was down is settled, never re-spawned", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a"]);
    writeState(fx, fd, [{ change: "a", state: "running", sessionId: "gone", worktree: fd.worktree("a"), lastPromptAt: fd.now(), streamedSincePrompt: true }]);
    fd.archived.add("gone");
    const runner = fd.runner();
    await fd.boot(runner);
    fd.tick(31_000);
    await runner.tick();
    expect(fd.spawned).toHaveLength(0);
    expect(readState(fx).items[0].state).toBe("settled");
  });
});

describe("#X15 fresh plan after a terminal run", () => {
  it("rotates the old state, re-queues b and c (b reuses its worktree), skips d with a live session", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b", "c", "d"]);
    fd.active = fd.active.filter((c) => c.name !== "a"); // a shipped: archived locally, no longer active
    writeState(fx, fd, [
      { change: "a", state: "shipped" },
      { change: "b", state: "kept", reason: "blocked", worktree: fd.worktree("b") },
      { change: "c", state: "incomplete" },
    ]);
    sh(fx.repo, "worktree", "add", "-b", "os/b", fd.worktree("b"), "develop");
    fs.mkdirSync(fd.worktree("d"), { recursive: true });
    fd.addSession("sD", fd.worktree("d"), "idle");

    const runner = fd.runner();
    await fd.boot(runner);
    const dir = path.join(fx.repo, ".worktrees", ".ship-batch");
    expect(fs.readdirSync(dir).filter((f) => /^g\.\d+\.json$/.test(f))).toHaveLength(1);
    const st = readState(fx);
    expect(st.items.filter((i) => i.state !== "skipped").map((i) => i.change)).toEqual(["b", "c"]);
    expect(st.items.find((i) => i.change === "d")).toMatchObject({ state: "skipped", reason: "live session present" });

    await runner.tick();
    const creates = fd.callsTo("POST", "/api/git/worktree").filter((c) => c.path === "/api/git/worktree");
    expect(creates.map((c) => (c.body as { newBranch?: string }).newBranch)).toEqual(["os/c"]); // b reused
    expect(fd.spawned.map((s) => s.attachProposal)).toEqual(["b", "c"]);
  });
});
