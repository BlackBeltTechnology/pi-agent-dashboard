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

let zrokAvailable: boolean | null = null;
let zrokBinaryPath: string | null = null;

function checkZrokOnPath(): string | null {
  return zrokResolver.which("zrok");
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

function saveReservedToken(token: string): void {
  try {
    const raw = fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
      : {};
    raw.tunnel = { ...raw.tunnel, reservedToken: token };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n");
  } catch (err: any) {
    console.warn(`Failed to save reserved token to config: ${err.message}`);
  }
}

export function releaseShare(token: string): boolean {
  if (!token) return false;
  try {
    // argv form (D3): token passed as a single argv element, never
    // string-interpolated into a shell command line.
    execFileSync(getZrokBinary(), ["release", token], {
      timeout: 10_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function reserveShare(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const result = execFileSync(
        getZrokBinary(),
        ["reserve", "public", `http://localhost:${port}`, "--json-output"],
        { timeout: 30_000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const data = JSON.parse(result.trim());
      const token = data.token ?? data.share_token ?? data.shareToken;
      if (token) {
        // Never log the reserved share token (secret). Confirm success only.
        console.log("Reserved zrok share (token redacted)");
        saveReservedToken(token);
        return resolve(token);
      }
      console.warn("zrok reserve: no token in output", result.trim());
      resolve(null);
    } catch (err: any) {
      console.warn(`zrok reserve failed: ${err.message}`);
      resolve(null);
    }
  });
}

/** The zrok slice for the generic child runtime. */
export const zrokChildSpec: ChildProviderSpec = {
  id: "zrok",
  pidFileName: "zrok.pid",
  getBinary: getZrokBinary,
  detectBinary: detectZrokBinary,
  isEnrolled: () => loadZrokEnv() !== null,
  buildArgs: (port, token) =>
    token
      ? ["share", "reserved", token, "--headless", "--override-endpoint", `http://localhost:${port}`]
      : ["share", "public", "--headless", `http://localhost:${port}`],
  urlRegex: /https?:\/\/[^\s"]*\.share\.zrok\.io[^\s"]*/,
  reserve: reserveShare,
  release: releaseShare,
  processMarker: "zrok share",
  endpointMarker: (port) => `--override-endpoint http://localhost:${port}`,
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
    const url = await zrokRuntime.createTunnel(port, opts?.reservedToken);
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
