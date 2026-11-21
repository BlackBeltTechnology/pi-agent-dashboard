/**
 * Child process for the #X13 signal test: runs the real `runMain` + the real
 * signal handlers against a fake dashboard until it is signalled.
 *
 *   FIXTURE_ROOT=<dir> node --import tsx signal-child.ts
 */
import path from "node:path";
import { parseArgs } from "../args.ts";
import { installSignalHandlers, type Runner, runMain } from "../runner.ts";
import { FakeDashboard, seedGroup } from "./fake-dashboard.ts";

const root = process.env.FIXTURE_ROOT as string;
const fd = new FakeDashboard({ root, repo: path.join(root, "repo"), origin: path.join(root, "origin.git") });
seedGroup(fd, ["a", "b"]);
let announced = false;
fd.sleep = async (ms: number) => {
  fd.t += ms;
  await new Promise((r) => setTimeout(r, 15));
  if (!announced && fd.spawned.length === 2) {
    announced = true;
    process.stdout.write("READY\n");
  }
};

let runner: Runner | undefined;
installSignalHandlers(() => runner);
const parsed = parseArgs(["--group", "g"]);
if (!parsed.ok) throw new Error(parsed.error);
const code = await runMain({ ...parsed.args, cwd: path.join(root, "repo") }, fd.deps({ sleep: fd.sleep }), { onRunner: (r) => (runner = r) });
const bad = fd.calls.filter((c) => /\/archive$|worktree\/remove/.test(c.path)).length;
process.stdout.write(`CALLS_BAD ${bad}\n`);
process.exit(code);
