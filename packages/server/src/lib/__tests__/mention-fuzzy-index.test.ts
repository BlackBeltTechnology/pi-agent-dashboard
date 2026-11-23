/**
 * Unit tests for the tracked-file fuzzy index used by mention recovery (design D5): size / buffer /
 * timeout budgets, single-flight, TTL, and failure isolation. `git` is stubbed through the injected
 * `execFile`, so nothing here spawns a process.
 *
 * See change: rich-chat-links (tasks 2.7, 2.8; test-plan #E18, #X4).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMentionFuzzyIndex, type ExecFileLike, MAX_BUFFER_BYTES, MAX_ENTRIES, TTL_MS } from "../mention-fuzzy-index.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mfi-")));
  // The index only spawns git inside something that looks like a repo (a `.git` entry on the way up).
  await fsp.mkdir(path.join(cwd, ".git"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fsp.rm(cwd, { recursive: true, force: true });
});

/** `execFile` stub: `rev-parse` answers the cwd; `ls-files` answers `lsFiles()`. */
function stub(lsFiles: () => Promise<{ stdout: string }> | { stdout: string }): ExecFileLike & ReturnType<typeof vi.fn> {
  return vi.fn(async (_file: string, args: readonly string[]) => {
    if (args[0] === "rev-parse") return { stdout: `${cwd}\n` };
    return lsFiles();
  }) as unknown as ExecFileLike & ReturnType<typeof vi.fn>;
}

const nul = (n: number): string => `${Array.from({ length: n }, (_, i) => `d/p${i}.ts`).join("\0")}\0`;
const lsFilesCalls = (fn: ReturnType<typeof vi.fn>): number => fn.mock.calls.filter((c) => (c[1] as string[])[0] === "ls-files").length;

describe("MentionFuzzyIndex — entry cap (E18)", () => {
  it.each([[MAX_ENTRIES - 1], [MAX_ENTRIES]])("builds with %i entries", async (n) => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({ execFile: stub(() => ({ stdout: nul(n) })), log });
    const res = await idx.lookup(cwd, "p5.ts");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.matches).toEqual([path.join(cwd, "d", "p5.ts")]);
      expect(res.total).toBe(1);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it(`skips with a log line at ${MAX_ENTRIES + 1} entries`, async () => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({ execFile: stub(() => ({ stdout: nul(MAX_ENTRIES + 1) })), log });
    expect(await idx.lookup(cwd, "p5.ts")).toMatchObject({ status: "skipped", reason: "too-large" });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("MentionFuzzyIndex — buffer, timeout and single-flight (E18)", () => {
  it("skips when the output exceeds the 64 MiB buffer", async () => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({
      execFile: stub(() => ({ stdout: "x".repeat(MAX_BUFFER_BYTES + 1) })),
      log,
    });
    expect(await idx.lookup(cwd, "x.ts")).toMatchObject({ status: "skipped", reason: "buffer" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("skips when execFile itself reports a maxBuffer overflow", async () => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({
      execFile: stub(() => Promise.reject(Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }))),
      log,
    });
    expect(await idx.lookup(cwd, "x.ts")).toMatchObject({ status: "skipped", reason: "buffer" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("skips when git does not answer within 3 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = vi.fn();
    // The `.git` probe uses real I/O, so wait until `ls-files` is actually pending before moving the clock.
    let started!: () => void;
    const lsFilesPending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const idx = createMentionFuzzyIndex({
      execFile: stub(() => {
        started();
        return new Promise(() => {});
      }),
      log,
    });
    const pending = idx.lookup(cwd, "x.ts");
    await lsFilesPending;
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ status: "skipped", reason: "timeout" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("two concurrent builds spawn `git ls-files` once (single-flight)", async () => {
    const exec = stub(() => ({ stdout: nul(3) }));
    const idx = createMentionFuzzyIndex({ execFile: exec });
    const [a, b] = await Promise.all([idx.lookup(cwd, "p1.ts"), idx.lookup(cwd, "p2.ts")]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(lsFilesCalls(exec)).toBe(1);
  });

  it("serves from cache inside the TTL and rebuilds after it", async () => {
    let t = 1_000;
    const exec = stub(() => ({ stdout: nul(3) }));
    const idx = createMentionFuzzyIndex({ execFile: exec, now: () => t });
    await idx.lookup(cwd, "p1.ts");
    t += TTL_MS - 1;
    expect(await idx.lookup(cwd, "p2.ts")).toMatchObject({ status: "ok", cached: true });
    expect(lsFilesCalls(exec)).toBe(1);
    t += 2;
    expect(await idx.lookup(cwd, "p2.ts")).toMatchObject({ status: "ok", cached: false });
    expect(lsFilesCalls(exec)).toBe(2);
  });

  it("a skipped build is remembered for the TTL, so a batch does not respawn git per mention", async () => {
    const exec = stub(() => Promise.reject(new Error("boom")));
    const idx = createMentionFuzzyIndex({ execFile: exec, log: () => undefined });
    await idx.lookup(cwd, "a.ts");
    await idx.lookup(cwd, "b.ts");
    expect(lsFilesCalls(exec)).toBe(1);
  });
});

describe("MentionFuzzyIndex — matching (E16)", () => {
  const files = ["src/a.ts", "xa/b.ts", "pkg/a/b.ts", "x/tasks.md", "y/tasks.md", "Readme.md"];
  const make = () => createMentionFuzzyIndex({ execFile: stub(() => ({ stdout: `${files.join("\0")}\0` })) });

  it("a bare name matches by basename", async () => {
    const res = await make().lookup(cwd, "tasks.md");
    expect(res).toMatchObject({ status: "ok", total: 2 });
  });

  it("a path mention matches by suffix on a segment boundary only", async () => {
    const res = await make().lookup(cwd, "a/b.ts");
    expect(res).toMatchObject({ status: "ok", total: 1, matches: [path.join(cwd, "pkg", "a", "b.ts")] });
  });

  it("a leading ./ is ignored; `..` and absolute mentions are not eligible", async () => {
    const idx = make();
    expect(await idx.lookup(cwd, "./src/a.ts")).toMatchObject({ status: "ok", total: 1 });
    expect(await idx.lookup(cwd, "../src/a.ts")).toMatchObject({ status: "skipped", reason: "not-eligible" });
    expect(await idx.lookup(cwd, "/src/a.ts")).toMatchObject({ status: "skipped", reason: "not-eligible" });
  });

  it("returns at most 25 matches but the true total", async () => {
    const many = `${Array.from({ length: 40 }, (_, i) => `d${i}/tasks.md`).join("\0")}\0`;
    const idx = createMentionFuzzyIndex({ execFile: stub(() => ({ stdout: many })) });
    const res = await idx.lookup(cwd, "tasks.md");
    expect(res.status === "ok" && res.total).toBe(40);
    expect(res.status === "ok" && res.matches.length).toBe(25);
  });
});

describe("MentionFuzzyIndex — failure isolation (X4)", () => {
  it("`git rev-parse` failing skips fuzzy with one log line and never throws", async () => {
    const log = vi.fn();
    const exec = vi.fn(async () => {
      throw new Error("fatal: not a git repository");
    });
    const idx = createMentionFuzzyIndex({ execFile: exec as unknown as ExecFileLike, log });
    await expect(idx.lookup(cwd, "x.ts")).resolves.toMatchObject({ status: "skipped", reason: "rev-parse-failed" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("`git ls-files` exiting non-zero skips fuzzy with one log line", async () => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({
      execFile: stub(() => Promise.reject(Object.assign(new Error("exit 128"), { code: 128 }))),
      log,
    });
    await expect(idx.lookup(cwd, "x.ts")).resolves.toMatchObject({ status: "skipped", reason: "ls-files-failed" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("`git ls-files` killed by execFile's own 3 s timeout skips fuzzy with one log line", async () => {
    const log = vi.fn();
    const idx = createMentionFuzzyIndex({
      execFile: stub(() => Promise.reject(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }))),
      log,
    });
    await expect(idx.lookup(cwd, "x.ts")).resolves.toMatchObject({ status: "skipped", reason: "timeout" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("outside any git repository no process is spawned", async () => {
    await fsp.rm(path.join(cwd, ".git"), { recursive: true });
    const exec = stub(() => ({ stdout: "" }));
    const idx = createMentionFuzzyIndex({ execFile: exec });
    await expect(idx.lookup(cwd, "x.ts")).resolves.toMatchObject({ status: "skipped", reason: "not-a-repo" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("passes the 3 s timeout and 64 MiB buffer to git, with NUL-delimited tracked-only output", async () => {
    const exec = stub(() => ({ stdout: nul(1) }));
    await createMentionFuzzyIndex({ execFile: exec }).lookup(cwd, "p0.ts");
    const call = exec.mock.calls.find((c) => (c[1] as string[])[0] === "ls-files");
    expect(call?.[0]).toBe("git");
    expect(call?.[1]).toEqual(["ls-files", "-z"]);
    expect(call?.[2]).toMatchObject({ timeout: 3000, maxBuffer: MAX_BUFFER_BYTES, cwd });
  });
});
