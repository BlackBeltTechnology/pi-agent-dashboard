// Stub for `pi-dashboard service exec <id> -- <child…>`: runs the child with
// INHERITED stdio (like the real exec, cli-service.ts:367), writes nothing to
// stdout itself, forwards no signals, exits with the child's code.
// `STUB_IGNORE_EOF=1` replaces the child with one that ignores stdin EOF; with
// `STUB_CHILD_PID_FILE=<file>` that child's pid is written there synchronously
// right after spawn, so the test can reap the orphan (#1071).
// See change: add-obs-studio-plugin (test-plan X3), stabilize-flaky-unit-tests.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
let child;
if (process.env.STUB_IGNORE_EOF) {
  child = spawn(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" });
  if (process.env.STUB_CHILD_PID_FILE) writeFileSync(process.env.STUB_CHILD_PID_FILE, String(child.pid));
} else {
  child = spawn(argv[dash + 1], argv.slice(dash + 2), { stdio: "inherit", env: { ...process.env, SVC_OBS_PASSWORD: "pw" } });
}
child.on("exit", (code) => process.exit(code ?? 1));
