/**
 * Store test environment: a real `TeamStore` + `TeamPersistence` over a real
 * temp directory, an injected `FakeClock` and a capturing logger. `restart()`
 * builds a NEW store/persistence over the SAME directory WITHOUT flushing, so
 * what the new instance sees is exactly what a killed process left on disk.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodePersistFs, type PersistFs, TeamPersistence } from "../../server/persistence.js";
import { TeamStore } from "../../server/store.js";
import type { Logger } from "../../server/types.js";
import type { Clock } from "../../shared/clock.js";
import { FakeClock } from "./fake-clock.js";

export interface CapturedLogs {
  info: string[];
  warn: string[];
  error: string[];
}

export function capturingLogger(): { logger: Logger; logs: CapturedLogs } {
  const logs: CapturedLogs = { info: [], warn: [], error: [] };
  const logger: Logger = {
    info: (m: string) => void logs.info.push(m),
    warn: (m: string) => void logs.warn.push(m),
    error: (m: string) => void logs.error.push(m),
  };
  return { logger, logs };
}

export function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-test-"));
}

export interface StoreEnvOptions {
  /** Plugin data dir (default: a fresh temp dir). */
  dataDir?: string;
  clock?: Clock;
  fs?: PersistFs;
  maxMailLogBytes?: () => number;
  closedRetentionDays?: () => number;
  idFactory?: () => string;
  maxMailLog?: number;
}

export interface StoreEnv {
  readonly store: TeamStore;
  readonly persistence: TeamPersistence;
  readonly clock: Clock;
  readonly dataDir: string;
  readonly teamsDir: string;
  readonly logs: CapturedLogs;
  /** New instance over the same directory, loaded from disk, NOT flushed first. */
  restart(over?: Partial<StoreEnvOptions>): StoreEnv;
}

export function createStoreEnv(opts: StoreEnvOptions = {}): StoreEnv {
  const dataDir = opts.dataDir ?? tmpDataDir();
  const teamsDir = path.join(dataDir, "teams");
  const clock = opts.clock ?? new FakeClock(1_700_000_000_000);
  const { logger, logs } = capturingLogger();
  const persistence = new TeamPersistence({
    dir: teamsDir,
    clock,
    logger,
    fs: opts.fs ?? nodePersistFs,
    ...(opts.maxMailLogBytes ? { maxMailLogBytes: opts.maxMailLogBytes } : {}),
    ...(opts.closedRetentionDays ? { closedRetentionDays: opts.closedRetentionDays } : {}),
  });
  const store = new TeamStore({
    clock,
    logger,
    persistence,
    ...(opts.idFactory ? { idFactory: opts.idFactory } : {}),
    ...(opts.maxMailLog ? { maxMailLog: opts.maxMailLog } : {}),
  });
  store.hydrate(persistence.load());
  return {
    store,
    persistence,
    clock,
    dataDir,
    teamsDir,
    logs,
    restart: (over = {}) => createStoreEnv({ ...opts, ...over, dataDir, clock: over.clock ?? clock }),
  };
}

/** Minimal valid member record for store tests. */
export function memberFixture(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    spawnToken: `tok-${name}`,
    cwd: "/work",
    status: "idle" as const,
    guardActive: true,
    noMcp: true,
    noContextFiles: true,
    lastSettleId: 0,
    ...over,
  };
}
