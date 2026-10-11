import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Case } from "../../cases.js";
import { main } from "../../cli.js";
import { latestRunId } from "../../commands/run.js";
import type { Ctx } from "../../ctx.js";
import { makeEnv, type TestEnv } from "./ctx.js";
import { mkCase, writeCaseSet } from "./run-fixture.js";

const STUB = resolve(dirname(fileURLToPath(import.meta.url)), "stub-pi.mjs");

interface StubBehaviour {
  exit?: number;
  stderr?: string;
  delayMs?: number;
  rawStdout?: string;
}
interface StubConfig {
  calls?: StubBehaviour[];
  default?: StubBehaviour;
  verdicts?: { validity?: string; helpfulness?: string };
  verdictById?: Record<string, string>;
  omit?: string[];
}

export interface JudgeEnv extends TestEnv {
  logFile: string;
  pidFile: string;
  stub(cfg?: StubConfig): void;
  calls(): Array<{ argv: string[]; cwd: string; stdin: string }>;
  run(extra?: string[]): Promise<number>;
  judge(extra?: string[]): Promise<number>;
  runId(): string;
  runPath(file: string): string;
}

const MODULE_SRC = `export default [{ id: "stub.r1", version: "1", asOf: "strict", search: async () => [
  { ref: "r-1", text: "constant snippet one", timestamp: "2020-01-01T00:00:00Z" },
  { ref: "r-2", text: "constant snippet two", timestamp: "2020-01-02T00:00:00Z" } ] }];`;

export function judgeEnv(opts: { cases?: Case[]; ctx?: Partial<Ctx> } = {}): JudgeEnv {
  const env = makeEnv({ piCommand: [process.execPath, STUB], piVersion: "0.0.0-test", ...opts.ctx });
  const cases = opts.cases ?? [1, 2, 3].map((n) => mkCase({ id: `c${n}`, query: `query ${n}`, context: `context ${n}` }));
  writeCaseSet(env, cases);
  const logFile = join(env.home, "stub.log");
  const pidFile = join(env.home, "stub.pid");
  mkdirSync(dirname(env.paths.providersFile), { recursive: true });
  writeFileSync(env.paths.providersFile, JSON.stringify({ roles: { review: "openai/gpt-6.1-sol:medium" } }));
  const modPath = join(env.home, "stub-retrievers.mjs");
  writeFileSync(modPath, MODULE_SRC);
  const je = env as JudgeEnv;
  je.logFile = logFile;
  je.pidFile = pidFile;
  je.stub = (cfg = {}) => {
    const p = join(env.home, "stub.json");
    writeFileSync(p, JSON.stringify({ logFile, pidFile, ...cfg }));
    process.env.STUB_CONFIG = p;
  };
  je.calls = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  je.run = (extra = []) => main(["run", "--retriever-module", modPath, ...extra], env.ctx);
  je.judge = (extra = []) => main(["judge", "--yes", ...extra], env.ctx);
  je.runId = () => latestRunId(env.paths.runsDir);
  je.runPath = (f) => join(env.paths.runsDir, je.runId(), f);
  je.stub();
  return je;
}

export const itemsIn = (stdin: string): string[] => [...stdin.matchAll(/<item id="([^"]+)"/g)].map((m) => m[1]);
export const verdictLines = (env: TestEnv): any[] => (existsSync(env.paths.verdicts) ? readFileSync(env.paths.verdicts, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
