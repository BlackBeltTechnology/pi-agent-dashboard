/**
 * obs-websocket enablement (design D10).
 *
 * | OBS state | action |
 * | enabled + password | import into `store:<id>/password` only after consent; < 8 chars → warn + offer rotation |
 * | not running (exit observed → 2 s settle → absence re-checked right before the write), disabled or rotating | 0600 backup (3 kept) → write → re-read verify → `service secret set <id> password` on stdin; secret failure → restore |
 * | running + disabled | UI instruction only; never write (OBS rewrites the file on exit) |
 *
 * The password is never printed, logged or put on argv; it reaches the store
 * through the CLI's stdin only. See change: add-obs-studio-plugin.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DashboardCli } from "./dashboard-cli.js";
import { ensureStateDir, websocketConfigFile } from "./paths.js";

export const SHORT_PASSWORD = 8;
const GENERATED_LENGTH = 24;
const SETTLE_MS = 2000;
const BACKUPS_KEPT = 3;

export const UI_INSTRUCTION =
  "OBS is running: open Tools → WebSocket Server Settings, tick Enable WebSocket server and Enable Authentication, press Apply, then run `pi-obs provision` again (pi-obs never edits the config while OBS runs, because OBS rewrites it on exit).";

export interface WsConfig {
  server_enabled?: boolean;
  server_port?: number;
  auth_required?: boolean;
  server_password?: string;
  [k: string]: unknown;
}

export function readWsConfig(configDir: string): { exists: boolean; config: WsConfig } {
  try {
    return { exists: true, config: JSON.parse(fs.readFileSync(websocketConfigFile(configDir), "utf8")) as WsConfig };
  } catch {
    return { exists: false, config: {} };
  }
}

/** URL-safe, 24 characters. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url").slice(0, GENERATED_LENGTH);
}

export function backupsDir(state: string): string {
  return path.join(state, "config-backups");
}

export interface EnableDeps {
  configDir: string;
  state: string;
  serviceId: string;
  findObs: () => Promise<number[]>;
  sleep: (ms: number) => Promise<void>;
  /** Yes/no question to the user (skill: via ask_user first; CLI: TTY or `--yes`). */
  consent: (question: string) => Promise<boolean>;
  cli: DashboardCli;
  now: () => number;
  generate?: () => string;
  warn: (line: string) => void;
}

export type EnableResult =
  | { action: "imported"; short: boolean; rotated: false; password: string; port: number }
  | { action: "written"; rotated: boolean; password: string; port: number }
  | { action: "instructed"; reason: "running" }
  | { action: "declined" }
  | { action: "failed"; reason: string; restored: boolean };

async function storeSecret(cli: DashboardCli, id: string, password: string): Promise<boolean> {
  const r = await cli.run(["service", "secret", "set", id, "password"], { stdin: password });
  return r.code === 0;
}

function pruneBackups(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((n) => /^config-\d+\.json$/.test(n))
    .sort((a, b) => Number(b.slice(7, -5)) - Number(a.slice(7, -5)));
  for (const n of files.slice(BACKUPS_KEPT)) fs.rmSync(path.join(dir, n), { force: true });
}

/** Write a fresh password while OBS is stopped; `rotated` when one existed. */
async function writeWhileStopped(d: EnableDeps, current: { exists: boolean; config: WsConfig }, rotated: boolean): Promise<EnableResult> {
  // Exit observed → settle → re-check immediately before the write.
  if ((await d.findObs()).length > 0) return { action: "instructed", reason: "running" };
  await d.sleep(SETTLE_MS);
  if ((await d.findObs()).length > 0) return { action: "instructed", reason: "running" };

  const file = websocketConfigFile(d.configDir);
  const bdir = backupsDir(ensureStateDir(d.state));
  fs.mkdirSync(bdir, { recursive: true, mode: 0o700 });
  let backup: string | undefined;
  if (current.exists) {
    backup = path.join(bdir, `config-${d.now()}.json`);
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
    pruneBackups(bdir);
  }
  const password = (d.generate ?? generatePassword)();
  const port = typeof current.config.server_port === "number" ? current.config.server_port : 4455;
  const next: WsConfig = { ...current.config, server_enabled: true, auth_required: true, server_password: password, server_port: port };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.pi-obs.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);

  const restore = (): boolean => {
    try {
      if (backup) fs.copyFileSync(backup, file);
      else fs.rmSync(file, { force: true });
      return true;
    } catch {
      return false;
    }
  };
  const verify = readWsConfig(d.configDir).config;
  if (verify.server_enabled !== true || verify.auth_required !== true || verify.server_password !== password) {
    return { action: "failed", reason: "config re-read did not match the write", restored: restore() };
  }
  if (!(await storeSecret(d.cli, d.serviceId, password))) {
    return { action: "failed", reason: "storing the secret failed; the previous config was restored", restored: restore() };
  }
  return { action: "written", rotated, password, port };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: decision table from design D10, one return per outcome
export async function enableWebsocket(d: EnableDeps): Promise<EnableResult> {
  const current = readWsConfig(d.configDir);
  const cfg = current.config;
  const pw = typeof cfg.server_password === "string" ? cfg.server_password : "";
  const port = typeof cfg.server_port === "number" ? cfg.server_port : 4455;
  const running = (await d.findObs()).length > 0;

  if (cfg.server_enabled === true && pw) {
    if (!(await d.consent("obs-websocket already has a password. Import it into the dashboard secret store?"))) return { action: "declined" };
    const short = pw.length < SHORT_PASSWORD;
    if (short) {
      d.warn(`the existing obs-websocket password is shorter than ${SHORT_PASSWORD} characters`);
      if (await d.consent(`Rotate it to a generated ${GENERATED_LENGTH}-character password? (OBS must be stopped)`)) {
        if (running) return { action: "instructed", reason: "running" };
        return writeWhileStopped(d, current, true);
      }
    }
    if (!(await storeSecret(d.cli, d.serviceId, pw))) return { action: "failed", reason: "storing the secret failed", restored: false };
    return { action: "imported", short, rotated: false, password: pw, port };
  }
  if (running) return { action: "instructed", reason: "running" };
  return writeWhileStopped(d, current, false);
}
