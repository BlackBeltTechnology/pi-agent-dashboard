/**
 * Rig for manager-/route-level dedicated tests: a REAL `DedicatedChrome` (temp
 * config dir, fake spawn / process listing / kill) under a real `RelayManager`.
 * Reusable by routes and entry tests. See change: add-dedicated-agent-browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { AuditRing } from "../audit.js";
import { type FakeChromeBehavior, FakeChromeChild } from "../dedicated/__tests__/fake-chrome.js";
import { DedicatedChrome, type DedicatedChromeDeps } from "../dedicated/chrome-process.js";
import { HiddenTargets } from "../dedicated/hidden-targets.js";
import type { ProcessInfo } from "../dedicated/process-identity.js";
import { type FakeSocket, flush, socketPair } from "../relay/__tests__/fake-socket.js";
import { type RelayConfig, RelayManager } from "../relay/relay-manager.js";

export const SELF_PID = 4242;
export const BINARY = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const silent = { info: () => {}, warn: () => {}, error: () => {} };

export interface DedicatedRigOptions {
  config?: RelayConfig;
  behavior?: FakeChromeBehavior;
  /** Process listing given the dedicated data dir. */
  list?: (dataDir: string) => ProcessInfo[];
  chrome?: Partial<DedicatedChromeDeps>;
  available?: { available: boolean; reason?: "no-chrome" | "no-display" };
  /** Overrides `available` with a live computation (e.g. `dedicatedAvailability` over injected probes). */
  availabilityFn?: () => { available: boolean; reason?: "no-chrome" | "no-display" };
  noClientMs?: number;
  /** Create the data dir up front (state `stopped` instead of `not-created`). */
  createDir?: boolean;
  onAgentTabCreated?: (instanceId: string, tabId: number) => void;
}

export interface DedicatedRig {
  manager: RelayManager;
  chrome: DedicatedChrome;
  hidden: HiddenTargets;
  audit: AuditRing;
  config: RelayConfig;
  home: string;
  children: FakeChromeChild[];
  spawn: ReturnType<typeof vi.fn>;
  killProcessGroup: ReturnType<typeof vi.fn>;
  avail: { available: boolean; reason?: "no-chrome" | "no-display" };
  statusChanges: number[];
  closedInstances: string[];
  /** Attach a CDP client to a minted `cdpUrl`; returns the client end. */
  dial(cdpUrl: string): FakeSocket;
  cleanup(): void;
}

const homes: string[] = [];

export function makeDedicatedRig(opts: DedicatedRigOptions = {}): DedicatedRig {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dedicated-mgr-"));
  homes.push(home);
  const configDir = path.join(home, ".pi", "dashboard");
  const children: FakeChromeChild[] = [];
  let nextPid = 7000;
  const spawn = vi.fn(() => {
    const c = new FakeChromeChild(nextPid++, opts.behavior);
    children.push(c);
    return c;
  });
  const killProcessGroup = vi.fn(async () => ({ ok: true, forced: false }));
  const chrome = new DedicatedChrome({
    resolveBinary: () => BINARY,
    spawn,
    listProcesses: async () => opts.list?.(path.join(configDir, "agent-chrome")) ?? [],
    killProcessGroup,
    isProcessAlive: () => false,
    processStartedAt: () => null,
    getDashboardConfigDir: () => configDir,
    selfPid: SELF_PID,
    ...opts.chrome,
  });
  if (opts.createDir) fs.mkdirSync(chrome.dataDir, { recursive: true });
  const config: RelayConfig = opts.config ?? { enabled: true, browsers: {} };
  const audit = new AuditRing();
  const hidden = new HiddenTargets();
  const avail = opts.available ?? { available: true };
  const statusChanges: number[] = [];
  const closedInstances: string[] = [];
  const manager = new RelayManager({
    audit,
    logger: silent,
    getConfig: () => config,
    getPort: () => 8123,
    canOpenChrome: () => true,
    listProfiles: async () => ({ profiles: [] }),
    onStatusChange: () => statusChanges.push(Date.now()),
    onInstanceClosed: (id) => closedInstances.push(id),
    onAgentTabCreated: opts.onAgentTabCreated,
    dedicated: { chrome, hidden, availability: opts.availabilityFn ?? (() => avail), noClientMs: opts.noClientMs },
  });
  const guidOf = (cdpUrl: string): string => cdpUrl.split("/").pop() as string;
  return {
    manager,
    chrome,
    hidden,
    audit,
    config,
    home,
    children,
    spawn,
    killProcessGroup,
    avail,
    statusChanges,
    closedInstances,
    dial(cdpUrl) {
      const [serverSide, clientSide] = socketPair();
      manager.attachCdp(guidOf(cdpUrl), serverSide);
      return clientSide;
    },
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export { flush };

/** Answer the newest not-yet-answered command named `method` on a fake Chrome. */
export function answer(child: FakeChromeChild, method: string, result: object): void {
  const cmd = [...child.written].reverse().find((m) => m.method === method);
  if (!cmd || cmd.id === undefined) throw new Error(`no ${method} written`);
  child.reply(cmd.id, result);
}
