/**
 * ZeroTier provider — DAEMON-model, PRIVATE-ONLY.
 *
 * Rides the same daemon pattern as Tailscale (idempotent control commands, no
 * PID/watchdog we own) but is the sharp asymmetry in the matrix: ZeroTier has
 * NO public mode and NO URL — only a raw mesh IP on a virtual network. It hands
 * out `http://<mesh-ip>:PORT` (no TLS, no name), which the read-time pairing
 * gate drops → ZeroTier is **Link-QR-only** (no pairing payload / bearer). The
 * node must also be AUTHORIZED in the ZeroTier controller (out-of-band) before
 * it gets an IP. `disconnect` maps to the destructive `leave`.
 *
 * All CLI access goes through an injectable {@link CmdRunner}. See change:
 * add-tunnel-providers.
 */

import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type {
  ProviderEndpoints,
  ProviderStatus,
  TunnelEndpoint,
  TunnelMode,
  TunnelProvider,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { providerSupportsMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import type { CmdResult, CmdRunner } from "./tailscale.js";

const ztResolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });

function defaultRunner(getBinary: () => string): CmdRunner {
  return (args) => {
    try {
      // argv form (D3): args passed as an array, never joined into a shell
      // command line — networkId cannot inject shell metacharacters.
      const stdout = execFileSync(getBinary(), args, {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
      return { code: 0, stdout, stderr: "" };
    } catch (e: any) {
      return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? String(e.message ?? e) };
    }
  };
}

// ── Pure helpers (unit-tested without a daemon) ─────────────────────

/** Find the network entry for `netid` in `zerotier-cli -j listnetworks` output. */
function findNetwork(listnetworksJson: any, netid: string): any {
  if (!Array.isArray(listnetworksJson)) return null;
  return listnetworksJson.find((n) => n?.nwid === netid || n?.id === netid) ?? null;
}

/** First IPv4 (CIDR suffix stripped) from a network's assignedAddresses. */
export function parseAssignedIpv4(listnetworksJson: any, netid: string): string | null {
  const net = findNetwork(listnetworksJson, netid);
  const addrs: string[] = net?.assignedAddresses ?? [];
  for (const a of addrs) {
    const ip = a.split("/")[0];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  }
  return null;
}

/** Authorized = joined network status OK AND an IPv4 was assigned by the controller. */
export function isNetworkAuthorized(listnetworksJson: any, netid: string): boolean {
  const net = findNetwork(listnetworksJson, netid);
  if (!net || net.status !== "OK") return false;
  return parseAssignedIpv4(listnetworksJson, netid) !== null;
}

/** The sole endpoint ZeroTier can produce: a no-TLS, no-name mesh IP. */
export function deriveMeshEndpoint(ip: string, port: number): TunnelEndpoint {
  return { kind: "mesh", url: `http://${ip}:${port}`, tls: false };
}

// ── Provider ────────────────────────────────────────────────────────

export class ZeroTierProvider implements TunnelProvider {
  readonly id = "zerotier" as const;
  readonly kind = "daemon" as const;

  private binaryPath: string | null = null;
  private lastEndpoints: TunnelEndpoint[] = [];
  private readonly networkId?: string;
  private readonly run: CmdRunner;

  constructor(opts?: { networkId?: string; run?: CmdRunner }) {
    this.networkId = opts?.networkId;
    this.run = opts?.run ?? defaultRunner(() => this.getBinary());
  }

  private getBinary(): string {
    if (this.binaryPath) return this.binaryPath;
    this.binaryPath = ztResolver.which("zerotier-cli");
    return this.binaryPath ?? "zerotier-cli";
  }

  private listNetworks(): any {
    const r: CmdResult = this.run(["-j", "listnetworks"]);
    try { return JSON.parse(r.stdout); } catch { return null; }
  }

  supportsMode(mode: TunnelMode): boolean {
    return providerSupportsMode("zerotier", mode); // private only
  }

  detectBinary(): boolean {
    return ztResolver.which("zerotier-cli") !== null;
  }

  isEnrolled(): boolean {
    if (!this.networkId) return false;
    return isNetworkAuthorized(this.listNetworks(), this.networkId);
  }

  async connect(port: number, mode: TunnelMode): Promise<ProviderEndpoints> {
    if (!this.supportsMode(mode)) throw new Error(`zerotier does not support mode ${mode} (private-only)`);
    if (!this.networkId) throw new Error("zerotier: networkId not configured");
    // Idempotent — re-joining an already-joined network is a no-op.
    this.run(["join", this.networkId]);
    const ip = parseAssignedIpv4(this.listNetworks(), this.networkId);
    // No IP yet ⇒ node not authorized in the controller (out-of-band step).
    this.lastEndpoints = ip ? [deriveMeshEndpoint(ip, port)] : [];
    return { endpoints: this.lastEndpoints };
  }

  async disconnect(_port: number): Promise<void> {
    // DESTRUCTIVE: `leave` removes network membership entirely (ZeroTier has no
    // transient disconnect). Only run when a networkId is known.
    if (this.networkId) this.run(["leave", this.networkId]);
    this.lastEndpoints = [];
  }

  status(): ProviderStatus {
    return { active: this.lastEndpoints.length > 0, endpoints: this.lastEndpoints };
  }
}
