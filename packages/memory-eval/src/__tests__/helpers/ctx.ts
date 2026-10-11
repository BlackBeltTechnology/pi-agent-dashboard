import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "../../ctx.js";
import { resolvePaths } from "../../workdir.js";

export interface TestEnv {
  home: string;
  cwd: string;
  ctx: Ctx;
  stdout: string[];
  stderr: string[];
  paths: ReturnType<typeof resolvePaths>;
}

export function makeEnv(over: Partial<Ctx> = {}): TestEnv {
  const home = mkdtempSync(join(tmpdir(), "meval-"));
  const cwd = over.cwd ?? "/synthetic/project";
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ctx: Ctx = {
    cwd,
    home,
    isTTY: false,
    piCommand: ["pi"],
    out: (s) => stdout.push(s),
    err: (s) => stderr.push(s),
    ...over,
  };
  return { home, cwd, ctx, stdout, stderr, paths: resolvePaths({ cwd, home }) };
}
