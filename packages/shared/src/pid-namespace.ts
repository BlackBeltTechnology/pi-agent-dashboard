/**
 * The ONE builder for a pi process's pid-namespace report. Used at every bridge
 * `session_register` site, in-process by the ACP bridge, and by the server for
 * its own `ServerPidContext` — so both sides compare like with like.
 *
 * - `kind`/`distro`: `"wsl"` + `WSL_DISTRO_NAME` when that env var is non-empty.
 * - `nsId`: Linux only, the `/proc/self/ns/pid` link.
 * - `hostId`: Linux `/proc/sys/kernel/random/boot_id` (no hostname fallback);
 *   elsewhere `os.hostname()` (a weak discriminator, documented in design Risks).
 * - Unreadable fields are omitted, never `null`; the builder never throws.
 *
 * Node-only (fs/os): never import from the client bundle.
 * See change: scope-pids-to-namespace.
 */
import { readFileSync, readlinkSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import type { PidNamespace } from "./types.js";

export type { PidNamespace } from "./types.js";

/** Injectable seams (tests); every field defaults to the real process/OS. */
export interface PidNamespaceOpts {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  readlink?: (path: string) => string;
  readFile?: (path: string) => string;
  hostname?: () => string;
}

/** The server's own namespace, computed once at startup. */
export interface ServerPidContext {
  platform: string;
  hostId?: string;
  nsId?: string;
}

const NS_LINK = "/proc/self/ns/pid";
const BOOT_ID = "/proc/sys/kernel/random/boot_id";

function attempt(read: () => string): string | undefined {
  try {
    const v = read().trim();
    return v === "" ? undefined : v;
  } catch {
    return undefined;
  }
}

export function buildPidNamespace(opts: PidNamespaceOpts = {}): PidNamespace {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const readlink = opts.readlink ?? ((p: string) => readlinkSync(p));
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const hostname = opts.hostname ?? osHostname;

  const distro = env.WSL_DISTRO_NAME;
  const ns: PidNamespace = distro ? { platform, kind: "wsl", distro } : { platform, kind: "host" };

  if (platform === "linux") {
    const nsId = attempt(() => readlink(NS_LINK));
    if (nsId !== undefined) ns.nsId = nsId;
    const hostId = attempt(() => readFile(BOOT_ID));
    if (hostId !== undefined) ns.hostId = hostId;
  } else {
    const hostId = attempt(hostname);
    if (hostId !== undefined) ns.hostId = hostId;
  }
  return ns;
}

let processNs: PidNamespace | undefined;

/**
 * THIS process's namespace, built once and reused: every register a bridge
 * sends (first, reattach, provisional) therefore carries the identical value.
 */
export function processPidNamespace(): PidNamespace {
  processNs ??= buildPidNamespace();
  return processNs;
}

/** The server's context: the same builder, reduced to the compared fields. */
export function buildServerPidContext(opts: PidNamespaceOpts = {}): ServerPidContext {
  const { platform, hostId, nsId } = buildPidNamespace(opts);
  return { platform, ...(hostId !== undefined ? { hostId } : {}), ...(nsId !== undefined ? { nsId } : {}) };
}
