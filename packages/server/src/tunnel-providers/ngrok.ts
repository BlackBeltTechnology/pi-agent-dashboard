/**
 * ngrok provider — the second child-model `TunnelProvider`, proving the seam.
 *
 * Reuses `ChildTunnelRuntime` unchanged (PID/watchdog/scavenge). ngrok has no
 * reserve step: the optional reserved *domain* (config `tunnel.ngrok.domain`)
 * rides the runtime's `reservedToken` slot and becomes `--url https://<domain>`.
 * The public URL is parsed from ngrok's structured log (`--log-format json`)
 * via the spec's `urlRegex`. public-only. See change: add-tunnel-providers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import type {
  ProviderEndpoints,
  ProviderStatus,
  TunnelConnectOpts,
  TunnelEndpoint,
  TunnelMode,
  TunnelProvider,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { providerSupportsMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { type ChildProviderSpec, ChildTunnelRuntime } from "../tunnel/tunnel-core.js";

const ngrokResolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });

let ngrokAvailable: boolean | null = null;
let ngrokBinaryPath: string | null = null;

// Internal: the provider object exposes it as `detectBinary`; nothing imports
// the free function. See change: fix-spawn-correlation-ttl-coupling (ratchet).
function detectNgrokBinary(): boolean {
  if (ngrokAvailable !== null) return ngrokAvailable;
  ngrokBinaryPath = ngrokResolver.which("ngrok");
  ngrokAvailable = ngrokBinaryPath !== null;
  return ngrokAvailable;
}

function getNgrokBinary(): string {
  if (ngrokBinaryPath) return ngrokBinaryPath;
  detectNgrokBinary();
  return ngrokBinaryPath ?? "ngrok";
}

/**
 * PUBLIC invalidation of the module-scope binary memo.
 *
 * `ngrokAvailable` is memoized once and never re-consulted, so an install or
 * removal done in a terminal is invisible for the life of the process.
 * `ToolRegistry.rescan()` clears the registry's cache, not this one. Readiness
 * needs a supported entry point rather than the test-only
 * `_resetNgrokBinaryCache`. See change: add-zrok-custom-reserved-name (D6.2).
 */
function invalidateNgrokBinaryCache(): void {
  ngrokAvailable = null;
  ngrokBinaryPath = null;
}

export function _resetNgrokBinaryCache(): void {
  ngrokAvailable = null;
  ngrokBinaryPath = null;
}

export function _setNgrokBinaryAvailable(available: boolean): void {
  ngrokAvailable = available;
  if (!available) ngrokBinaryPath = null;
}

/** Candidate ngrok config file locations across ngrok v3 (per-OS) and v2. */
export function ngrokConfigCandidates(homedir: string = os.homedir()): string[] {
  const out: string[] = [];
  if (process.env.NGROK_CONFIG) out.push(process.env.NGROK_CONFIG);
  if (process.platform === "darwin") {
    out.push(path.join(homedir, "Library", "Application Support", "ngrok", "ngrok.yml"));
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(homedir, "AppData", "Local");
    out.push(path.join(local, "ngrok", "ngrok.yml"));
  }
  out.push(path.join(homedir, ".config", "ngrok", "ngrok.yml"));
  out.push(path.join(homedir, ".ngrok2", "ngrok.yml")); // legacy v2
  return out;
}

/** Enrolled when any ngrok config file carries an `authtoken:`. */
export function isNgrokEnrolled(): boolean {
  for (const p of ngrokConfigCandidates()) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      if (/^\s*authtoken\s*:\s*\S+/m.test(raw)) return true;
    } catch {
      // missing file — try next candidate
    }
  }
  return false;
}

/** The ngrok slice for the generic child runtime. */
export const ngrokChildSpec: ChildProviderSpec = {
  id: "ngrok",
  pidFileName: "ngrok.pid",
  getBinary: getNgrokBinary,
  detectBinary: detectNgrokBinary,
  isEnrolled: isNgrokEnrolled,
  buildArgs: (port, domain) => {
    const base = ["http", String(port), "--log", "stdout", "--log-format", "json"];
    if (!domain) return base;
    const url = domain.startsWith("http") ? domain : `https://${domain}`;
    return [...base, "--url", url];
  },
  // Matches the public URL from ngrok's json log (`"url":"https://…"`) or the
  // logfmt form (`url=https://…`). Never localhost (that is the `addr` field).
  urlRegex: /(?<=url=)https:\/\/\S+|(?<="url":")https:\/\/[^"]+/,
  processMarker: "ngrok",
  endpointMarker: (port) => `http ${port}`,
  toEndpoints: (url): TunnelEndpoint[] => [{ kind: "public", url, tls: url.startsWith("https://") }],
};

export const ngrokRuntime = new ChildTunnelRuntime(ngrokChildSpec);

/** ngrok as a `TunnelProvider`. */
export class NgrokProvider implements TunnelProvider {
  readonly id = "ngrok" as const;
  readonly kind = "child" as const;
  supportsMode(mode: TunnelMode): boolean {
    return providerSupportsMode("ngrok", mode);
  }
  detectBinary(): boolean {
    return detectNgrokBinary();
  }
  /**
   * Drop the module-scope binary memo so the NEXT `detectBinary()` re-resolves.
   * Readiness calls this before probing, because `ToolRegistry.rescan()` cannot
   * reach a memo this module holds. See change: add-zrok-custom-reserved-name.
   */
  invalidateBinaryCache(): void {
    invalidateNgrokBinaryCache();
  }
  isEnrolled(): boolean {
    return isNgrokEnrolled();
  }
  async connect(port: number, _mode: TunnelMode, opts?: TunnelConnectOpts): Promise<ProviderEndpoints> {
    // opts.reservedToken carries the reserved domain, if configured.
    const url = await ngrokRuntime.createTunnel(port, opts?.reservedToken);
    return { endpoints: url ? ngrokChildSpec.toEndpoints(url) : [] };
  }
  async disconnect(port: number): Promise<void> {
    await ngrokRuntime.deleteTunnel(port);
  }
  status(): ProviderStatus {
    const url = ngrokRuntime.getTunnelUrl();
    return url
      ? { active: true, endpoints: ngrokChildSpec.toEndpoints(url) }
      : { active: false, endpoints: [] };
  }
}
