import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dockerDownScript, type Runner } from "../runner.ts";
import { setState } from "../scheduler.ts";
import type { Outcome } from "../types.ts";
import { cleanupFixtures, FakeDashboard, makeFixture, readState, seedGroup, sh } from "./fake-dashboard.ts";

afterEach(cleanupFixtures);

/** Start `x` for real, then hand it to teardown with the given outcome. */
async function toTeardown(
  outcome: Outcome,
  opts: { sessionStatus?: "ended" | "idle" | "streaming"; before?: (fd: FakeDashboard, fx: ReturnType<typeof makeFixture>) => void; override?: Parameters<FakeDashboard["runner"]>[1] } = {},
) {
  const fx = makeFixture();
  const fd = new FakeDashboard(fx);
  seedGroup(fd, ["x"]);
  opts.before?.(fd, fx);
  const runner = fd.runner(["--group", "g"], opts.override);
  await fd.boot(runner);
  await runner.tick(); // starts x
  const item = runner.state.items[0];
  fd.setStatus(item.sessionId as string, opts.sessionStatus ?? "ended");
  item.outcome = outcome;
  setState(item, "teardown", fd.now());
  fd.tick(31_000); // the bus has been up for a settle window: decisions are allowed
  return { fx, fd, runner, item, wt: fd.worktree("x") };
}

const removes = (fd: FakeDashboard) => fd.callsTo("POST", "/api/git/worktree/remove");
const archiveCalls = (fd: FakeDashboard) => fd.calls.filter((c) => /\/api\/session\/[^/]+\/archive/.test(c.path));

describe("#X5 archive confirmation", () => {
  it("(a) pending, then the session ends archived: the worktree step runs after", async () => {
    const { fd, runner, item, wt } = await toTeardown("incomplete", { sessionStatus: "idle" });
    await runner.tick();
    expect(item.state).toBe("teardown");
    expect(removes(fd)).toHaveLength(0);
    fd.endAndArchive(item.sessionId as string);
    fd.tick();
    await runner.tick();
    expect(item.state).toBe("incomplete");
    expect(removes(fd)).toHaveLength(1);
    expect(fs.existsSync(wt)).toBe(false);
    const order = fd.log.filter((l) => /archive|worktree\/remove/.test(l));
    expect(order.indexOf("POST /api/git/worktree/remove")).toBeGreaterThan(order.indexOf(`POST /api/session/${item.sessionId}/archive`));
  });

  it("(b) pending, intent expires, session ended unarchived: archive is re-issued, then the worktree step", async () => {
    const { fd, runner, item } = await toTeardown("incomplete", { sessionStatus: "idle" });
    await runner.tick();
    expect(archiveCalls(fd)).toHaveLength(1);
    fd.endUnarchived(item.sessionId as string);
    fd.tick();
    await runner.tick();
    expect(archiveCalls(fd)).toHaveLength(2);
    expect(removes(fd)).toHaveLength(1);
    expect(item.state).toBe("incomplete");
  });

  it("(c) 409 live for 3 minutes: item kept 'session not archivable', no git / remove calls", async () => {
    const { fd, runner, item, wt } = await toTeardown("incomplete", { sessionStatus: "streaming" });
    fd.archiveMode.set(item.sessionId as string, "conflict");
    for (let i = 0; i < 20; i++) {
      await runner.tick();
      fd.tick();
    }
    expect(item).toMatchObject({ state: "kept", reason: "session not archivable" });
    expect(removes(fd)).toHaveLength(0);
    expect(fs.existsSync(wt)).toBe(true);
    expect(fd.log.some((l) => l.startsWith("docker.down"))).toBe(false);
  });
});

describe("#X6 live-session guard", () => {
  it("another non-ended session in the worktree keeps the item and the worktree", async () => {
    const { fd, runner, item, wt } = await toTeardown("incomplete", { before: () => {} });
    fd.addSession("intruder", wt, "idle");
    await runner.tick();
    expect(item.state).toBe("kept");
    expect(item.reason).toMatch(/live session/);
    expect(removes(fd)).toHaveLength(0);
    expect(fs.existsSync(wt)).toBe(true);
  });
});

describe("#X7 harness down before removal", () => {
  const stubbed = (fd: FakeDashboard, fx: ReturnType<typeof makeFixture>) => {
    fs.mkdirSync(path.join(fx.repo, "docker"));
    const script = path.join(fx.repo, "docker", "test-down.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho "$PWD" >> "$PWD/../.stub-log"\n', { mode: 0o755 });
    sh(fx.repo, "add", "-A");
    sh(fx.repo, "commit", "-q", "-m", "stub test-down");
    sh(fx.repo, "push", "-q", "origin", "develop");
    void fd;
  };

  it("runs docker/test-down.sh once from the worktree before the remove call", async () => {
    let logAtRemove: string | null = null;
    const { fd, runner, wt, fx } = await toTeardown("incomplete", { before: stubbed, override: { dockerDown: dockerDownScript } });
    fs.writeFileSync(path.join(wt, ".pi-test-harness.json"), "{}");
    fd.on("POST /api/git/worktree/remove", () => {
      const f = path.join(fx.repo, ".worktrees", ".stub-log");
      logAtRemove = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
      return undefined;
    });
    await runner.tick();
    expect(logAtRemove).not.toBeNull();
    expect((logAtRemove as unknown as string).trim().split("\n")).toEqual([wt]);
    expect(removes(fd)).toHaveLength(1);
  });

  it("without .pi-test-harness.json the stub is never invoked", async () => {
    const { fd, runner, fx } = await toTeardown("incomplete", { before: stubbed, override: { dockerDown: dockerDownScript } });
    await runner.tick();
    expect(fs.existsSync(path.join(fx.repo, ".worktrees", ".stub-log"))).toBe(false);
    expect(removes(fd)).toHaveLength(1);
  });
});

const originFiles = (fx: { origin: string }, branch: string) =>
  sh(fx.origin, "diff-tree", "--no-commit-id", "--name-only", "-r", branch).split("\n").filter(Boolean).sort();

describe("#X8 WIP commit + push + remove", () => {
  it("commits tracked + untracked work (never .pi/settings.json), pushes, removes without deleting the branch", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("incomplete");
    fs.appendFileSync(path.join(wt, "README.md"), "more\n");
    fs.writeFileSync(path.join(wt, "new.ts"), "export {};\n");
    fs.writeFileSync(path.join(wt, ".pi", "settings.json"), '{"local":true}\n');
    fs.mkdirSync(path.join(wt, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(wt, "node_modules", "junk.js"), "x");
    await runner.tick();
    expect(sh(fx.origin, "log", "-1", "--format=%s", "os/x")).toBe("wip(ship-batch): x incomplete");
    expect(originFiles(fx, "os/x")).toEqual(["README.md", "new.ts"]);
    expect(removes(fd).map((c) => c.body)).toEqual([{ cwd: wt, force: true, deleteBranch: false }]);
    expect(sh(fx.repo, "rev-parse", "--verify", "refs/heads/os/x")).toBeTruthy();
    expect(item.state).toBe("incomplete");
  });
});

describe("#X9 blocked keeps the worktree", () => {
  it("pushes WIP without the gitignored hand-back, removes nothing", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("blocked");
    fs.appendFileSync(path.join(wt, "README.md"), "wip\n");
    const blocked = path.join(wt, "openspec", "changes", "x", "SHIP_IT_BLOCKED.md");
    fs.mkdirSync(path.dirname(blocked), { recursive: true });
    fs.writeFileSync(blocked, "blocked\n");
    await runner.tick();
    expect(originFiles(fx, "os/x")).toEqual(["README.md"]);
    expect(removes(fd)).toHaveLength(0);
    expect(fs.existsSync(wt) && fs.existsSync(blocked)).toBe(true);
    expect(item.state).toBe("kept");
  });
});

describe("#X10 push failure keeps the worktree", () => {
  it("an unwritable origin: kept, worktree on disk, no remove, the report names the path", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("incomplete");
    fs.appendFileSync(path.join(wt, "README.md"), "wip\n");
    sh(fx.repo, "remote", "set-url", "origin", path.join(fx.root, "missing.git"));
    await runner.tick();
    expect(item.state).toBe("kept");
    expect(item.reason).toMatch(/push failed/);
    expect(removes(fd)).toHaveLength(0);
    expect(fs.existsSync(wt)).toBe(true);
    expect(runner.report().join("\n")).toContain(wt);
  });
});

describe("#X11 mid-merge is not committed", () => {
  it("MERGE_HEAD present: no commit, no push, no remove, kept", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("incomplete");
    fs.appendFileSync(path.join(wt, "README.md"), "side A\n");
    sh(wt, "commit", "-q", "-am", "a");
    sh(fx.repo, "branch", "other", "develop");
    const other = path.join(fx.root, "other-wt");
    sh(fx.repo, "worktree", "add", other, "other");
    fs.appendFileSync(path.join(other, "README.md"), "side B\n");
    sh(other, "commit", "-q", "-am", "b");
    expect(() => sh(wt, "merge", "other")).toThrow();
    const head = sh(wt, "rev-parse", "HEAD");
    await runner.tick();
    expect(sh(wt, "rev-parse", "HEAD")).toBe(head);
    expect(() => sh(fx.origin, "rev-parse", "--verify", "os/x")).toThrow(); // nothing pushed
    expect(removes(fd)).toHaveLength(0);
    expect(item.state).toBe("kept");
  });
});

describe("#X18 shipped, worktree already gone", () => {
  it("prunes, deletes the local branch, calls remove zero times", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("shipped");
    fs.rmSync(wt, { recursive: true, force: true }); // ship-change removed it; the admin entry may linger
    await runner.tick();
    expect(removes(fd)).toHaveLength(0);
    expect(sh(fx.repo, "worktree", "list", "--porcelain")).not.toContain("os-x");
    expect(() => sh(fx.repo, "rev-parse", "--verify", "--quiet", "refs/heads/os/x")).toThrow();
    expect(item.state).toBe("shipped");
  });

  it("a shipped worktree with only .pi/settings.json dirt is removed and its branch deleted", async () => {
    const { fx, fd, runner, item, wt } = await toTeardown("shipped");
    fs.writeFileSync(path.join(wt, ".pi", "settings.json"), '{"local":true}\n');
    await runner.tick();
    expect(removes(fd).map((c) => c.body)).toEqual([{ cwd: wt, force: true, deleteBranch: false }]);
    expect(() => sh(fx.repo, "rev-parse", "--verify", "--quiet", "refs/heads/os/x")).toThrow();
    expect(item.state).toBe("shipped");
  });
});

// keep the Runner import used for type documentation of the helper above
export type _R = Runner;
void readState;
