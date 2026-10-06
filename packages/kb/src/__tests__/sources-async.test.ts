/**
 * Async remote resolution (change: improve-kb-settings-sources-and-search, D6):
 * git runs through promisified `execFile` with a bound, the harden change's argv
 * is preserved verbatim, and an unapproved source fails with a classifiable error.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { file: string; args: string[]; opts: Record<string, unknown> };
const calls: Call[] = [];
let failClone: Error | null = null;

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  const execFile = (file: string, args: string[], opts: Record<string, unknown>, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    calls.push({ file, args, opts });
    if (args.includes("clone") && failClone) return cb(failClone);
    if (args.includes("clone")) {
      // create the .git dir so a follow-up exists-check would pass
      real.execFileSync("mkdir", ["-p", join(args[args.length - 1], ".git")]);
    }
    cb(null, { stdout: args.includes("rev-parse") ? "abc1234\n" : args.includes("version") ? "git version 2.50.1\n" : "", stderr: "" });
  };
  return { ...real, execFile };
});

const { gitResolver, KbUntrustedSourceError } = await import("../sources.js");
const { recordTrust } = await import("../trust.js");

describe("async git resolution", () => {
  let cacheDir: string;
  let trustFile: string;
  const saved = process.env.KB_SOURCE_TRUST_PATH;
  beforeAll(() => {
    trustFile = join(tmpdir(), `kb-trust-async-${Date.now()}.json`);
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.KB_SOURCE_TRUST_PATH;
    else process.env.KB_SOURCE_TRUST_PATH = saved;
    rmSync(trustFile, { force: true });
  });
  beforeEach(() => {
    calls.length = 0;
    failClone = null;
    cacheDir = mkdtempSync(join(tmpdir(), "kb-async-"));
  });

  const spec = { kind: "git" as const, ref: "git:https://93.184.216.34/o/r" };

  it("E31 untrusted spec rejects with KbUntrustedSourceError and never spawns git", async () => {
    const untrusted = { kind: "git" as const, ref: "git:https://93.184.216.35/o/never" };
    await expect(
      gitResolver.resolve(untrusted, { cwd: cacheDir, cacheDir, promptTrust: async () => false }),
    ).rejects.toBeInstanceOf(KbUntrustedSourceError);
    expect(calls).toHaveLength(0);
  });

  it("E32 hardening argv is preserved verbatim and every call is bounded (timeout + maxBuffer)", async () => {
    recordTrust(spec);
    await gitResolver.resolve(spec, { cwd: cacheDir, cacheDir });
    const clone = calls.find((c) => c.args.includes("clone"));
    expect(clone).toBeDefined();
    const head = clone?.args.slice(0, clone.args.indexOf("clone")).join(" ");
    expect(head).toContain("-c protocol.allow=never -c protocol.https.allow=always");
    expect(head).toContain("-c http.followRedirects=false");
    for (const c of calls) {
      expect(c.file).toBe("git");
      expect(c.opts.timeout).toBe(120_000);
      expect(c.opts.maxBuffer).toBe(16 * 1024 * 1024);
    }
  });

  it("X5 a timed-out/killed git rejects (node kills the child at `timeout`)", async () => {
    recordTrust(spec);
    failClone = Object.assign(new Error("Command failed: git clone"), { killed: true, signal: "SIGTERM" });
    await expect(gitResolver.resolve(spec, { cwd: cacheDir, cacheDir })).rejects.toThrow(/Command failed/);
    expect(calls.find((c) => c.args.includes("clone"))?.opts.timeout).toBe(120_000);
  });
});
