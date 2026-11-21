import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupFixtures, FakeDashboard, makeFixture, readState, seedGroup } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

const started = async () => {
  const fx = makeFixture();
  const fd = new FakeDashboard(fx);
  seedGroup(fd, ["x"]);
  const runner = fd.runner();
  await fd.boot(runner);
  await runner.tick();
  return { fx, fd, runner, id: runner.state.items[0].sessionId as string };
};

describe("#X12 no decision without a live view", () => {
  it("(a) a session missing from the snapshot (not archived) is never settled; it resumes when it reappears", async () => {
    const { fx, fd, runner, id } = await started();
    const session = fd.sessions.get(id);
    if (!session) throw new Error("no session");
    fd.sessions.delete(id);
    const before = fd.calls.length;
    for (let i = 0; i < 12; i++) {
      fd.tick(10_000); // 2 minutes
      await runner.tick();
    }
    expect(readState(fx).items[0].state).toBe("running");
    const sideEffects = fd.calls.slice(before).filter((c) => c.method === "POST");
    expect(sideEffects).toEqual([]);
    fd.sessions.set(id, session);
    fd.tick(10_000);
    await runner.tick();
    expect(readState(fx).items[0]).toMatchObject({ state: "running", sessionId: id });
  });

  it("(b) a bus outage: backoff 1 s, 2 s, 4 s, no actions while down, --status says unreachable", async () => {
    const { fx, fd, runner } = await started();
    fd.disconnect();
    fd.connectFailures = 3;
    const callsBefore = fd.calls.length;
    const spawnedBefore = fd.spawned.length;
    for (const wait of [0, 1_000, 2_000, 4_000]) {
      fd.tick(wait);
      await runner.tick();
      if (wait < 4_000) {
        expect(fd.calls.length).toBe(callsBefore); // nothing touched the dashboard while down
        expect(readState(fx).unreachableSince).not.toBeNull();
      }
    }
    const delays = fs
      .readFileSync(path.join(fx.repo, ".worktrees", ".ship-batch", "g.events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { ev: string; what?: string; delayMs?: number })
      .filter((e) => e.ev === "error" && e.what === "bus_reconnect")
      .map((e) => e.delayMs);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(fd.spawned.length).toBe(spawnedBefore);
    expect(readState(fx).unreachableSince ?? null).toBeNull(); // reconnected on the 4th attempt
  });

  it("--status prints 'dashboard unreachable' while the outage lasts", async () => {
    const { fd, runner } = await started();
    fd.disconnect();
    fd.connectFailures = 99;
    await runner.tick();
    const out: string[] = [];
    expect(await fd.main(["--status"], { out: (l) => void out.push(l) })).toBe(0);
    expect(out.join("\n")).toMatch(/dashboard unreachable/);
    expect(out.join("\n")).toContain("x");
  });
});

describe("questions", () => {
  it("a questioned item is never torn down or timed out, and frees its slot for the next change", async () => {
    const fx = makeFixture();
    const fd = new FakeDashboard(fx);
    seedGroup(fd, ["a", "b", "c"]);
    const runner = fd.runner(["--group", "g", "--parallel", "1"]);
    await fd.boot(runner);
    await runner.tick();
    const a = runner.state.items[0];
    fd.questions.add(a.sessionId as string);
    fd.setStatus(a.sessionId as string, "idle");
    for (let i = 0; i < 40; i++) {
      fd.tick(10_000);
      await runner.tick();
    }
    expect(a.state).toBe("question");
    expect(fd.spawned.map((s) => s.attachProposal)).toEqual(["a", "b"]); // b took the freed slot
    expect(fd.calls.filter((c) => /archive|worktree\/remove/.test(c.path))).toEqual([]);
  });
});
