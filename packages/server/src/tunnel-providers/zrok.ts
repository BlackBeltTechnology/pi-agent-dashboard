/**
 * zrok provider — the first `TunnelProvider` behind the seam.
 *
 * Holds every zrok-specific detail (binary resolution, reserved-share
 * reserve/release, the `.share.zrok.io` URL regex, enrollment via the zrok
 * environment file) as a {@link ChildProviderSpec}. Generic lifecycle lives
 * in {@link ChildTunnelRuntime}. Behaviour is identical to the pre-abstraction
 * zrok-only module. See change: add-tunnel-providers.
 */
import fs from "node:fs";
import { CONFIG_FILE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type {
  ProviderEndpoints,
  ProviderStatus,
  TunnelConnectOpts,
  TunnelEndpoint,
  TunnelMode,
  TunnelProvider,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { providerSupportsMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { readZrokEnvironment, type ZrokEnvData } from "@blackbelt-technology/pi-dashboard-shared/zrok-env.js";
import { type ChildProviderSpec, ChildTunnelRuntime } from "../tunnel/tunnel-core.js";

export type ZrokEnv = ZrokEnvData;

// useLoginShell: true mirrors ToolRegistry's "where" strategy defaults so
// GUI-launched servers (whose PATH lacks /opt/homebrew/bin etc.) still find
// zrok via the user's login shell.
const zrokResolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });

// v2 renamed the binary to `zrok2` (tarball / Windows / Linux packages);
// Homebrew still ships it as `zrok`. Resolve the first that exists, preferring
// `zrok2`. See change: support-zrok-v2.
const ZROK_BINARY_NAMES = ["zrok2", "zrok"] as const;

let zrokAvailable: boolean | null = null;
let zrokBinaryPath: string | null = null;

function checkZrokOnPath(): string | null {
  for (const name of ZROK_BINARY_NAMES) {
    const p = zrokResolver.which(name);
    if (p) return p;
  }
  return null;
}

export function detectZrokBinary(): boolean {
  if (zrokAvailable !== null) return zrokAvailable;
  zrokBinaryPath = checkZrokOnPath();
  zrokAvailable = zrokBinaryPath !== null;
  return zrokAvailable;
}

function getZrokBinary(): string {
  if (zrokBinaryPath) return zrokBinaryPath;
  detectZrokBinary();
  return zrokBinaryPath ?? "zrok";
}

export function _resetBinaryCache(): void {
  zrokAvailable = null;
  zrokBinaryPath = null;
}

export function _setBinaryAvailable(available: boolean): void {
  zrokAvailable = available;
  if (!available) zrokBinaryPath = null;
}

export function loadZrokEnv(): ZrokEnv | null {
  const r = readZrokEnvironment();
  return r.found ? r.env : null;
}

/**
 * Persist the v2 reserved NAME under `tunnel.zrok.reservedName` (not a secret).
 * Returns false when the write fails so the caller can avoid serving a name that
 * would be lost on restart (and orphaned remotely).
 */
function saveReservedName(name: string): boolean {
  try {
    const raw = fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
      : {};
    raw.tunnel = { ...raw.tunnel, zrok: { ...raw.tunnel?.zrok, reservedName: name, persistent: true } };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n");
    return true;
  } catch (err: any) {
    console.warn(`Failed to save reserved name to config: ${err.message}`);
    return false;
  }
}

/**
 * DNS-safe reserved-name allow-list: a label of alphanumerics + interior
 * hyphens, no leading hyphen (so an option-like value can never reach argv),
 * ≤ 63 chars. Guards a config-sourced name before it is passed to zrok. See
 * change: support-zrok-v2.
 */
const RESERVED_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
export function isDnsSafeReservedName(name: string): boolean {
  return RESERVED_NAME_RE.test(name);
}

/** DNS-safe generated name for a fresh reservation (`pi-dash-<8 hex>`). */
function generateReservedName(): string {
  const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `pi-dash-${hex}`;
}

/**
 * Release a v2 reserved NAME: `zrok2 delete name <name>`. Invoked ONLY by the
 * explicit "forget reserved URL" path (never on normal disconnect — a reserved
 * name must survive to keep a stable URL). Best-effort boolean. argv form: the
 * name is a single argv element, never interpolated. See change: support-zrok-v2.
 */
export function releaseShare(name: string): boolean {
  if (!name) return false;
  try {
    execFileSync(getZrokBinary(), ["delete", "name", name], {
      timeout: 10_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mint (or reuse) a v2 reserved name in the `public` namespace via
 * `zrok2 create name -n public <name>`. Generates a DNS-safe name when none is
 * given. Reuse-on-exists-for-this-account; taken-by-another-account → warn +
 * return null (caller falls back to ephemeral, never silently rotates). On
 * success persists the name and returns it. See change: support-zrok-v2.
 */
export function mintReservedName(existing?: string): string | null {
  const name = existing || generateReservedName();
  if (!isDnsSafeReservedName(name)) {
    console.warn("zrok reserved name is not DNS-safe; falling back to an ephemeral tunnel");
    return null;
  }
  try {
    execFileSync(getZrokBinary(), ["create", "name", "-n", "public", name], {
      timeout: 30_000,
      stdio: ["ignore", "ignore", "pipe"],
    });
    // Persistence is the whole point of a reserved name: if the config write
    // fails, do NOT serve it (it would be lost on restart + orphaned remotely).
    if (!saveReservedName(name)) return null;
    return name;
  } catch (err: any) {
    const msg = String(err?.stderr ?? err?.message ?? err);
    // Already reserved by THIS account → reuse it (idempotent reconnect).
    if (/already exist/i.test(msg) && !/another|different account|owned by/i.test(msg)) {
      return saveReservedName(name) ? name : null;
    }
    // Taken by another account, or any other failure → ephemeral fallback.
    console.warn("zrok create name failed; falling back to an ephemeral tunnel");
    return null;
  }
}

/**
 * Resolve the reserved NAME to serve for a connect. Returns a stored name
 * verbatim, mints one when `persistent` and none is stored, or `undefined`
 * for an ephemeral share. Never mints when `persistent` is false. See change:
 * support-zrok-v2.
 */
export function ensureReservedName(opts?: { reservedName?: string; persistent?: boolean }): string | undefined {
  // Persistence is opt-in: only `persistent === true` uses/mints a reserved
  // name. A stored name with persistence off stays ephemeral (design 2a).
  if (opts?.persistent !== true) return undefined;
  if (opts.reservedName) {
    // Validate a config-sourced name before it reaches zrok argv.
    return isDnsSafeReservedName(opts.reservedName) ? opts.reservedName : undefined;
  }
  return mintReservedName() ?? undefined;
}

/** The zrok slice for the generic child runtime. */
export const zrokChildSpec: ChildProviderSpec = {
  id: "zrok",
  pidFileName: "zrok.pid",
  getBinary: getZrokBinary,
  detectBinary: detectZrokBinary,
  isEnrolled: () => loadZrokEnv() !== null,
  // v2 named-share (reserved): `share public --headless -n public:<name> localhost:<port>`;
  // ephemeral: `share public --headless localhost:<port>`. Flags precede the
  // positional target so an argv-order test is deterministic. `token` is the
  // reserved NAME (caller-provided). See change: support-zrok-v2.
  buildArgs: (port, token) =>
    token
      ? ["share", "public", "--headless", "-n", `public:${token}`, `localhost:${port}`]
      : ["share", "public", "--headless", `localhost:${port}`],
  // v1 emits `https://<t>.share.zrok.io`; v2 emits a bare `<t>.shares.zrok.io`
  // (plural, no scheme). The host is anchored: after `.zrok.io` the next char
  // MUST be a boundary (space/quote/slash/colon/end) so a spoofed
  // `x.shares.zrok.io.attacker.com` tail cannot be swallowed into the host.
  urlRegex: /(?:https?:\/\/)?[a-z0-9-]+\.shares?\.zrok\.io(?=[\s"/:]|$)(?:[:/][^\s"]*)?/i,
  normalizeUrl: (raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`),
  release: releaseShare,
  // Match BOTH `zrok share` (v1) and `zrok2 share` (v2). Used in conjunction
  // with `endpointMarker` (localhost:<port>) so a bare port line never matches.
  processMarker: /\bzrok2? share\b/,
  endpointMarker: (port) => `localhost:${port}`,
  toEndpoints: (url): TunnelEndpoint[] => [{ kind: "public", url, tls: url.startsWith("https://") }],
};

/** Shared runtime instance backing both the wrappers and the ZrokProvider. */
export const zrokRuntime = new ChildTunnelRuntime(zrokChildSpec);

/** zrok as a `TunnelProvider` — the public seam other providers implement too. */
export class ZrokProvider implements TunnelProvider {
  readonly id = "zrok" as const;
  readonly kind = "child" as const;
  supportsMode(mode: TunnelMode): boolean {
    return providerSupportsMode("zrok", mode);
  }
  detectBinary(): boolean {
    return detectZrokBinary();
  }
  isEnrolled(): boolean {
    return loadZrokEnv() !== null;
  }
  async connect(port: number, _mode: TunnelMode, opts?: TunnelConnectOpts): Promise<ProviderEndpoints> {
    // v2: serve a reserved NAME (stored or minted-when-persistent), else
    // ephemeral. The legacy v1 `reservedToken` is intentionally IGNORED — a v1
    // token is meaningless to a v2 account. See change: support-zrok-v2.
    const name = ensureReservedName({ reservedName: opts?.reservedName, persistent: opts?.persistent });
    const url = await zrokRuntime.createTunnel(port, name);
    return { endpoints: url ? zrokChildSpec.toEndpoints(url) : [] };
  }
  async disconnect(port: number): Promise<void> {
    await zrokRuntime.deleteTunnel(port);
  }
  status(): ProviderStatus {
    const url = zrokRuntime.getTunnelUrl();
    return url
      ? { active: true, endpoints: zrokChildSpec.toEndpoints(url) }
      : { active: false, endpoints: [] };
  }
}
