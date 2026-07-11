/**
 * Tailscale provider — the first DAEMON-model `TunnelProvider`.
 *
 * The tunnel is state on the long-lived `tailscaled` daemon the server does
 * NOT own: connect/disconnect are idempotent control commands and the URL is
 * read back from the daemon's status output. No PID we own → the PID-file /
 * watchdog paths are skipped (`kind === "daemon"`). Supports BOTH modes:
 * `funnel` (public, Tailscale-managed TLS) and `serve` (private mesh).
 *
 * All CLI access goes through an injectable {@link CmdRunner} so the daemon
 * commands are unit-testable without a real tailnet. Command shapes verified
 * against the current CLI: serve/funnel URLs come from `tailscale serve
 * status --json` (NOT `tailscale status --json`, which is peer/identity only).
 * See change: add-tunnel-providers.
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

const tailscaleResolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });

/** Result of a tailscale CLI invocation. */
export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Injectable CLI runner (real one uses execFileSync argv; tests pass a fake). */
export type CmdRunner = (args: string[]) => CmdResult;

function defaultRunner(getBinary: () => string): CmdRunner {
  return (args) => {
    try {
      // argv form (D3): args passed as an array, never joined into a shell
      // command line, so a value with shell metacharacters cannot break out.
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

/** Parse the auth URL tailscale prints from `tailscale up` when login is needed. */
export function parseTailscaleAuthUrl(output: string): string | null {
  const m = output.match(/https:\/\/login\.tailscale\.com\/[^\s"']+/);
  return m ? m[0] : null;
}

/** Backend is logged-in + running. */
export function isBackendRunning(statusJson: any): boolean {
  return statusJson?.BackendState === "Running";
}

/** Funnel gates that must all pass before public mode can start. */
export interface FunnelGate {
  name: string;
  ok: boolean;
  hint: string;
}

/**
 * Derive funnel readiness from `tailscale funnel status`/errors. Public mode
 * is blocked until every gate is `ok`. HTTPS certs + the Funnel node-attr are
 * admin-console gates we can detect but not automate.
 */
export function checkFunnelGates(statusJson: any, funnelStatusResult: CmdResult): FunnelGate[] {
  const httpsEnabled = statusJson?.Self?.CapMap
    ? true
    : /HTTPS|https/.test(funnelStatusResult.stdout);
  const funnelBlocked = /not allowed|Funnel is not enabled|node attribute|denied/i.test(
    funnelStatusResult.stderr + funnelStatusResult.stdout,
  );
  return [
    {
      name: "https-certs",
      ok: funnelStatusResult.code === 0 || httpsEnabled,
      hint: "Enable HTTPS certificates for your tailnet (admin console → DNS → HTTPS Certificates).",
    },
    {
      name: "funnel-acl",
      ok: funnelStatusResult.code === 0 && !funnelBlocked,
      hint: "Grant the Funnel node attribute in your tailnet ACL policy (nodeAttrs → attr: funnel).",
    },
  ];
}

/** First IPv4 (100.x mesh) address from a status JSON's Self.TailscaleIPs. */
function selfMeshIpv4(statusJson: any): string | null {
  const ips: string[] = statusJson?.Self?.TailscaleIPs ?? [];
  return ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ?? null;
}

/** MagicDNS name (trailing dot stripped) from a status JSON's Self.DNSName. */
function selfDnsName(statusJson: any): string | null {
  const dns: string | undefined = statusJson?.Self?.DNSName;
  return dns ? dns.replace(/\.$/, "") : null;
}

/**
 * Build the tagged endpoint list (4.4): a `mesh` (100.x, no-TLS) endpoint plus
 * a `magicdns` name endpoint. In public (funnel) mode the MagicDNS name carries
 * Tailscale-managed TLS → `tls:true` https. In private (serve) mode it is TLS
 * only when the serve status reports an https/443 handler (a provisioned cert);
 * otherwise it is advertised as no-TLS http.
 */
export function deriveEndpoints(
  statusJson: any,
  serveStatusJson: any,
  port: number,
  mode: TunnelMode,
): TunnelEndpoint[] {
  const out: TunnelEndpoint[] = [];
  const dns = selfDnsName(statusJson);
  const ipv4 = selfMeshIpv4(statusJson);

  // HTTPS only when serve actually terminates TLS on :443 — a Web handler keyed
  // `host:443` or a TCP :443 entry. Do NOT treat any Web key or a stray ":443"
  // substring elsewhere in the JSON as HTTPS (false-positive TLS tag).
  const serveHasHttps =
    Object.keys(serveStatusJson?.Web ?? {}).some((k) => k.endsWith(":443")) ||
    Object.keys(serveStatusJson?.TCP ?? {}).includes("443");

  if (dns) {
    if (mode === "public") {
      out.push({ kind: "magicdns", url: `https://${dns}`, tls: true });
    } else if (serveHasHttps) {
      out.push({ kind: "magicdns", url: `https://${dns}`, tls: true });
    } else {
      out.push({ kind: "magicdns", url: `http://${dns}:${port}`, tls: false });
    }
  }
  if (ipv4) {
    out.push({ kind: "mesh", url: `http://${ipv4}:${port}`, tls: false });
  }
  return out;
}

// ── Provider ────────────────────────────────────────────────────────

export class TailscaleProvider implements TunnelProvider {
  readonly id = "tailscale" as const;
  readonly kind = "daemon" as const;

  private binaryPath: string | null = null;
  private lastEndpoints: TunnelEndpoint[] = [];
  private readonly run: CmdRunner;

  constructor(run?: CmdRunner) {
    this.run = run ?? defaultRunner(() => this.getBinary());
  }

  private getBinary(): string {
    if (this.binaryPath) return this.binaryPath;
    this.binaryPath = tailscaleResolver.which("tailscale");
    return this.binaryPath ?? "tailscale";
  }

  private statusJson(): any {
    const r = this.run(["status", "--json"]);
    try { return JSON.parse(r.stdout); } catch { return null; }
  }

  private serveStatusJson(): any {
    const r = this.run(["serve", "status", "--json"]);
    try { return JSON.parse(r.stdout); } catch { return null; }
  }

  supportsMode(mode: TunnelMode): boolean {
    return providerSupportsMode("tailscale", mode);
  }

  detectBinary(): boolean {
    return tailscaleResolver.which("tailscale") !== null;
  }

  isEnrolled(): boolean {
    return isBackendRunning(this.statusJson());
  }

  /** Run `tailscale up` and capture the login URL it prints (browser-auth step). */
  captureAuthUrl(): string | null {
    const r = this.run(["up", "--json"]);
    return parseTailscaleAuthUrl(r.stdout + r.stderr);
  }

  /** Funnel readiness gates (public mode). */
  funnelGates(): FunnelGate[] {
    return checkFunnelGates(this.statusJson(), this.run(["funnel", "status"]));
  }

  async connect(port: number, mode: TunnelMode): Promise<ProviderEndpoints> {
    if (!this.supportsMode(mode)) throw new Error(`tailscale does not support mode ${mode}`);
    if (mode === "public") {
      const gates = this.funnelGates();
      const failing = gates.filter((g) => !g.ok);
      if (failing.length > 0) {
        throw new Error(`funnel gates not met: ${failing.map((g) => g.name).join(", ")}`);
      }
      // Idempotent control command — funnel proxies the local port publicly.
      this.run(["funnel", "--bg", `localhost:${port}`]);
    } else {
      // Idempotent control command — serve proxies the local port on the tailnet.
      this.run(["serve", "--bg", "--set-path=/", `localhost:${port}`]);
    }
    const endpoints = deriveEndpoints(this.statusJson(), this.serveStatusJson(), port, mode);
    this.lastEndpoints = endpoints;
    return { endpoints };
  }

  async disconnect(_port: number): Promise<void> {
    // Idempotent teardown — clears serve + funnel config. Not destructive to
    // the daemon or the node's tailnet membership.
    this.run(["serve", "reset"]);
    this.lastEndpoints = [];
  }

  status(): ProviderStatus {
    const active = this.lastEndpoints.length > 0;
    return { active, endpoints: this.lastEndpoints };
  }
}
