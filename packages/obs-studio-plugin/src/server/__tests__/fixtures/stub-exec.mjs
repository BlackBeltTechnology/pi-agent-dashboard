// Stub for `pi-dashboard service exec <id> -- <child…>`: runs the child with
// INHERITED stdio (like the real exec, cli-service.ts:367), writes nothing to
// stdout itself, forwards no signals, exits with the child's code.
// `STUB_IGNORE_EOF=1` replaces the child with one that ignores stdin EOF.
// See change: add-obs-studio-plugin (test-plan X3).
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const child = process.env.STUB_IGNORE_EOF
  ? spawn(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" })
  : spawn(argv[dash + 1], argv.slice(dash + 2), { stdio: "inherit", env: { ...process.env, SVC_OBS_PASSWORD: "pw" } });
child.on("exit", (code) => process.exit(code ?? 1));
