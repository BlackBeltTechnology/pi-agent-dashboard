#!/usr/bin/env node
/**
 * Out-of-band memory probe for the browser-E2E Docker harness.
 *
 * Samples the container's cgroup and resident `pi` processes from the HOST, via
 * `docker exec`. Deliberately out-of-band (design D5): reading the cgroup from
 * inside a Playwright test would need `docker exec` from the test process and
 * could not attribute anything, so the count budget lives in-band and the
 * memory BOUND is verified here instead.
 *
 * The harness image has no `ps`, so resident processes are enumerated from
 * /proc/[0-9]*&#47;status (Name + VmRSS).
 *
 * NOTE on the two memory figures: summed VmRSS OVERCOUNTS relative to
 * `memory.current`, because forked pi processes share copy-on-write pages that
 * VmRSS attributes to each process in full. `memory.current` (the cgroup's own
 * accounting) is the authoritative number; the sum is useful for per-process
 * attribution only.
 *
 * Usage:
 *   node scripts/probe-harness-memory.mjs                 # human-readable
 *   node scripts/probe-harness-memory.mjs --json          # one JSON line
 *   node scripts/probe-harness-memory.mjs --label before  # tag the sample
 *
 * Container is resolved from .pi-test-harness.json (never a hardcoded name/port).
 *
 * See change: fix-e2e-harness-memory-exhaustion (tasks 1.2, 6.0).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(REPO_ROOT, ".pi-test-harness.json");

/** Resolve the harness container name from the state file the harness writes. */
export function resolveContainer() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `${STATE_FILE} not found — start the harness first (docker/test-up.sh -d).`,
    );
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  if (state.containerName) return state.containerName;
  // Fall back to the compose project's dashboard service.
  const project = state.composeProject ?? state.project;
  if (!project) {
    throw new Error(`no containerName/composeProject in ${STATE_FILE}: ${JSON.stringify(state)}`);
  }
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const first = out.split("\n").filter(Boolean)[0];
  if (!first) throw new Error(`no running container for compose project ${project}`);
  return first;
}

function exec(container, script) {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Read one cgroup v2 file, tolerating absence (cgroup v1 hosts). */
function cgroupValue(container, file) {
  try {
    return exec(container, `cat /sys/fs/cgroup/${file} 2>/dev/null`).trim();
  } catch {
    return "";
  }
}

export function sample(container, label = "") {
  const memMax = cgroupValue(container, "memory.max");
  const memCurrent = cgroupValue(container, "memory.current");
  const memEvents = cgroupValue(container, "memory.events");
  const pidsCurrent = cgroupValue(container, "pids.current");

  // Enumerate resident processes from /proc — the image has no `ps`.
  // Emits "<name> <rssKb>" per process.
  const procScript = `
    for d in /proc/[0-9]*; do
      [ -r "$d/status" ] || continue
      n=$(awk '/^Name:/{print $2; exit}' "$d/status" 2>/dev/null)
      r=$(awk '/^VmRSS:/{print $2; exit}' "$d/status" 2>/dev/null)
      [ -n "$n" ] && printf '%s %s %s\\n' "$n" "\${r:-0}" "\${d#/proc/}"
    done
  `;
  const procOut = exec(container, procScript);

  let piCount = 0;
  let piRssKb = 0;
  let totalRssKb = 0;
  const piPids = [];
  for (const line of procOut.split("\n")) {
    const [name, rss, pid] = line.trim().split(/\s+/);
    if (!name) continue;
    const kb = Number.parseInt(rss ?? "0", 10) || 0;
    totalRssKb += kb;
    // pi processes report as `pi`, or as `node` running the pi entrypoint.
    if (name === "pi") {
      piCount += 1;
      piRssKb += kb;
      const n = Number.parseInt(pid ?? "", 10);
      if (Number.isInteger(n)) piPids.push(n);
    }
  }

  const memEventsMax = /max (\d+)/.exec(memEvents)?.[1] ?? "0";

  return {
    label,
    timestamp: new Date().toISOString(),
    container,
    memoryMaxBytes: Number.parseInt(memMax, 10) || null,
    memoryCurrentBytes: Number.parseInt(memCurrent, 10) || null,
    memoryEventsMax: Number.parseInt(memEventsMax, 10),
    pidsCurrent: Number.parseInt(pidsCurrent, 10) || null,
    residentPiCount: piCount,
    residentPiRssKb: piRssKb,
    residentPiPids: piPids,
    totalRssKb,
  };
}

/**
 * Compare the resident session processes against the dashboard's live-session
 * records — the comparison a human previously had to eyeball via `docker exec`.
 *
 * `orphaned` is the number this change exists to drive to zero: a process with
 * no live session record is a leak (measured pre-fix: 21 resident pi vs 0
 * session records). `unaccounted` is the mirror image — a session record whose
 * process is not resident — which is a bookkeeping bug rather than a leak.
 *
 * Pure and set-based so the disjoint / overlapping / equal cases are assertable
 * without a container. See change: fix-tmux-session-shutdown-leak
 * (design D4, test-plan #C3).
 */
export function compareResidentToSessions(residentPids, liveSessionPids) {
  const resident = [...new Set(residentPids)];
  const live = new Set(liveSessionPids);
  const orphaned = resident.filter((pid) => !live.has(pid));
  const matched = resident.filter((pid) => live.has(pid));
  const unaccounted = [...live].filter((pid) => !resident.includes(pid));
  return {
    orphaned,
    matched,
    unaccounted,
    orphanedCount: orphaned.length,
    clean: orphaned.length === 0,
  };
}

function fmtMb(bytes) {
  return bytes == null ? "n/a" : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function render(s) {
  const pct =
    s.memoryCurrentBytes && s.memoryMaxBytes
      ? ` (${((s.memoryCurrentBytes / s.memoryMaxBytes) * 100).toFixed(1)}% of cap)`
      : "";
  return [
    `── harness memory probe ${s.label ? `[${s.label}] ` : ""}${s.timestamp}`,
    `   container        ${s.container}`,
    `   memory.current   ${fmtMb(s.memoryCurrentBytes)}${pct}`,
    `   memory.max       ${fmtMb(s.memoryMaxBytes)}`,
    `   memory.events max=${s.memoryEventsMax}`,
    `   pids.current     ${s.pidsCurrent}`,
    `   resident pi      ${s.residentPiCount} process(es), ${fmtMb(s.residentPiRssKb * 1024)} summed VmRSS`,
    `   all procs        ${fmtMb(s.totalRssKb * 1024)} summed VmRSS (overcounts shared pages)`,
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "";
  const s = sample(resolveContainer(), label);
  console.log(args.includes("--json") ? JSON.stringify(s) : render(s));
}
