// Spike #744b: does autostart-lock's pid-reuse detection (E6) work here?
// Simulate: lock recorded 10s ago by a session whose pid is now held by a
// YOUNGER unrelated process (spawned just now). Correct verdict: stale.
import { spawn } from "node:child_process";
import { defaultProbes, isLockStale } from "APP/packages/extension/src/autostart-lock.ts";

const child = spawn("sleep", ["60"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 300));
const probes = defaultProbes();
const lock = { sessionPid: child.pid!, startedAt: Date.now() - 10_000, cliPath: "/x/cli.ts" };
const result = {
  platform: process.platform,
  isAlive: probes.isAlive(child.pid!),
  processStartedAt: probes.processStartedAt(child.pid!),
  verdictStale: isLockStale(lock, probes),
  expected: true,
};
console.log(JSON.stringify(result));
child.kill("SIGKILL");
