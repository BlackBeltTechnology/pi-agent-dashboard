/**
 * Out-of-band process-table probes for the docker harness container.
 *
 * Termination claims are about the CONTAINER's process table, not the
 * dashboard's own bookkeeping (a record disappearing is exactly what the #452 /
 * #459 leaks did), so these read `/proc` via `docker exec`. The container is
 * resolved from the dashboard port (`DASHBOARD_PORT`), never by name.
 *
 * Exemplar: `tests/e2e/tmux-session-shutdown.spec.ts`.
 * See change: fix-session-reclaim-tmux.
 */
import { execFileSync } from "node:child_process";
import { DASHBOARD_PORT } from "../lifecycle.js";

/** Resolve the harness container by the dashboard port it publishes. */
export function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/** True while that PID is resident IN THE CONTAINER. */
function isResident(container: string, pid: number): boolean {
  return inContainer(container, `[ -d /proc/${pid} ] && echo yes || echo no`) === "yes";
}

/** PIDs of resident `pi` processes, read from /proc (the image has no `ps`). */
export function residentPiPids(container: string): number[] {
  const out = inContainer(
    container,
    `for d in /proc/[0-9]*; do [ -r "$d/status" ] || continue; ` +
      `n=$(awk '/^Name:/{print $2; exit}' "$d/status" 2>/dev/null); ` +
      `if [ "$n" = "pi" ]; then echo "\${d#/proc/}"; fi; done; true`,
  );
  return out
    .split("\n")
    .map((l) => Number.parseInt(l, 10))
    .filter((n) => Number.isInteger(n));
}

/** Poll until `pid` leaves the container's process table; returns whether it did. */
export async function waitUntilGone(container: string, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isResident(container, pid)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !isResident(container, pid);
}
