/**
 * Read / write the subagents PRODUCER settings file inside the harness
 * container (`docker exec`, as `expire-paired-device.ts` does). The producer
 * (`@blackbelt-technology/pi-dashboard-subagents` ≥ 0.6.0) re-reads
 * `maxConcurrent` live, so a write here changes the spawn limit of running
 * sessions within about a second — no restart.
 *
 * Unknown keys are preserved: `writeProducerSettings` merges a patch over the
 * current file. `restoreProducerSettings` puts back exactly what was read.
 *
 * See change: subagent-queue-visibility (test-plan #F1-#F8).
 */
import { execFileSync } from "node:child_process";
import { resolveContainer } from "./container-proc.js";

/** Producer settings file inside the container (HOME=/home/pi). */
const PRODUCER_SETTINGS = "/home/pi/.pi/agent/extensions/pi-dashboard-subagents/config.json";

const NODE_READ = `
  const fs = require("node:fs");
  const f = process.argv[1];
  process.stdout.write(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
`;

const NODE_WRITE = `
  const fs = require("node:fs");
  const path = require("node:path");
  const [f, body] = process.argv.slice(1);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (body === "__DELETE__") { fs.rmSync(f, { force: true }); process.exit(0); }
  const tmp = f + ".tmp-e2e";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, f);
`;

function nodeInContainer(script: string, ...args: string[]): string {
  return execFileSync("docker", ["exec", resolveContainer(), "node", "-e", script, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

/** Raw file text, or `null` when the file does not exist. */
export function readProducerSettingsRaw(): string | null {
  const raw = nodeInContainer(NODE_READ, PRODUCER_SETTINGS);
  return raw === "" ? null : raw;
}

/** Parsed settings (`{}` when absent). */
export function readProducerSettings(): Record<string, unknown> {
  const raw = readProducerSettingsRaw();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** Merge `patch` over the current file and write it atomically. */
export function writeProducerSettings(patch: Record<string, unknown>): void {
  const next = { ...readProducerSettings(), ...patch };
  nodeInContainer(NODE_WRITE, PRODUCER_SETTINGS, `${JSON.stringify(next, null, 2)}\n`);
}

/** Put back exactly the text `readProducerSettingsRaw()` returned (`null` deletes the file). */
export function restoreProducerSettings(raw: string | null): void {
  nodeInContainer(NODE_WRITE, PRODUCER_SETTINGS, raw ?? "__DELETE__");
}
