import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli.js";
import { casesBuild } from "../commands/cases.js";
import { makeEnv } from "./helpers/ctx.js";
import { judgeEnv } from "./helpers/judge-env.js";
import { mkCase, writeCaseSet } from "./helpers/run-fixture.js";
import { bash, uuid, writeSession } from "./helpers/sessions.js";

function list(root: string, dir = root, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    out.push(relative(root, p));
    if (statSync(p).isDirectory()) list(root, p, out);
  }
  return out.sort();
}

const modeOf = (p: string) => statSync(p).mode & 0o777;

/** Paths that appeared under `home`, minus the work dir, its contents and its ancestors. */
function strayPaths(env: ReturnType<typeof makeEnv>, before: string[]): string[] {
  const rootRel = relative(env.home, env.paths.root);
  const inside = (a: string) => a === rootRel || a.startsWith(rootRel + sep) || rootRel.startsWith(a + sep);
  return list(env.home).filter((p) => !before.includes(p) && !inside(p));
}

function seedExistingWorkDir(env: ReturnType<typeof makeEnv>): void {
  mkdirSync(join(env.paths.root, "cases"), { recursive: true });
  chmodSync(env.paths.root, 0o755);
  chmodSync(join(env.paths.root, "cases"), 0o755);
  writeFileSync(join(env.paths.root, "verdicts.jsonl"), "");
  chmodSync(join(env.paths.root, "verdicts.jsonl"), 0o644);
}

describe("work dir", () => {
  it.each([false, true])("E47: 0700 dirs and 0600 files, nothing written outside it (existing=%s)", async (existing) => {
    const env = makeEnv();
    writeSession(env.paths.sessionsDir, { id: uuid(1), start: "2026-01-01T10:00:00.000Z", steps: [bash("npx a", "Error: x", true)] });
    if (existing) seedExistingWorkDir(env);
    const before = list(env.home);
    expect(casesBuild(env.ctx, {})).toBe(0);
    expect(strayPaths(env, before)).toEqual([]);
    expect(modeOf(env.paths.root)).toBe(0o700);
    for (const p of list(env.paths.root)) {
      const abs = join(env.paths.root, p);
      expect(modeOf(abs), p).toBe(statSync(abs).isDirectory() ? 0o700 : 0o600);
    }
  });

  it("B1 (round 8): a symlink inside the work dir is refused, never followed out of it", async () => {
    // (a) a pre-existing verdicts.jsonl symlinked to an outside file: `judge` must not append to it.
    const a = judgeEnv();
    await a.run();
    const outside = join(a.home, "outside-verdicts.jsonl");
    writeFileSync(outside, "untouched\n");
    symlinkSync(outside, a.paths.verdicts);
    expect(await a.judge()).not.toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
    expect(a.stderr.join("")).toMatch(/symlink/i);

    // (b) a symlinked sub-directory: `run` must not create its run dir outside the work dir.
    const b = makeEnv();
    writeCaseSet(b, [mkCase({ id: "c1" })]);
    const elsewhere = join(b.home, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, b.paths.runsDir);
    expect(await main(["run", "--retrievers", "hermes.memory_search"], b.ctx)).not.toBe(0);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(b.stderr.join("")).toMatch(/symlink/i);
  });
});
