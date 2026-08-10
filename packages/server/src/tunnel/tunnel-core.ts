/**
 * Provider-neutral tunnel lifecycle core.
 *
 * Holds the generic machinery every CHILD-model tunnel provider shares:
 * PID files, the spawn→timeout→retry→URL-match state machine, the health
 * watchdog handoff, and orphan scavenge. Provider specifics (binary,
 * spawn args, URL regex, reserve/release, enrollment) are supplied via a
 * {@link ChildProviderSpec}. zrok is the first spec behind this seam.
 *
 * Daemon-model providers (tailscale, zerotier) do NOT use this core: their
 * tunnel is state on a long-lived daemon, so they skip the PID-file and
 * watchdog paths entirely (see `TunnelProvider.kind === "daemon"`).
 *
 * See change: add-tunnel-providers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ChildProcess, execSync, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  isProcessAlive,
  killPidWithGroup,
  killProcess,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import type { TunnelEndpoint, TunnelProviderId } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

const SPAWN_TIMEOUT_MS = 30_000;

/**
 * The provider-specific slice a {@link ChildTunnelRuntime} needs. Everything
 * here is zrok/ngrok-flavoured; the runtime owns the generic lifecycle.
 */
export interface ChildProviderSpec {
  id: TunnelProviderId;
  /** PID-file basename under `~/.pi/dashboard/` (e.g. "zrok.pid"). */
  pidFileName: string;
  /** Absolute binary path, or a bare-name fallback. */
  getBinary(): string;
  /** Binary present on PATH (cached by the spec). */
  detectBinary(): boolean;
  /** Enrolled/authenticated (zrok env present, ngrok authtoken set, …). */
  isEnrolled(): boolean;
  /** Spawn args for a reserved token, or the public fallback when `token` is undefined. */
  buildArgs(port: number, token: string | undefined): string[];
  /** Matches the public URL in combined stdout/stderr. */
  urlRegex: RegExp;
  /** Optional post-match normalization (e.g. prepend scheme to a bare host). */
  normalizeUrl?(raw: string): string;
  /** Reserve a persistent share; returns a token or null. Omit for public-only-no-reserve providers. */
  reserve?(port: number): Promise<string | null>;
  /** Release a reserved token; best-effort boolean. */
  release?(token: string): boolean;
  /**
   * `ps` line marker identifying our processes. A string is substring-matched
   * (ngrok: `"ngrok"`); a RegExp is `.test`-matched (zrok: `/\bzrok2? share\b/`,
   * so both `zrok share` and `zrok2 share` are scavenged). See change:
   * support-zrok-v2.
   */
  processMarker: string | RegExp;
  /** `ps` line marker binding a process to `port`. */
  endpointMarker(port: number): string;
  /** Map a resolved public URL to tagged endpoint(s). */
  toEndpoints(url: string): TunnelEndpoint[];
}

/**
 * Generic child-process tunnel lifecycle. One instance per provider spec.
 * Behaviour is identical to the original zrok-only `tunnel.ts` — this is the
 * same state machine, parameterized.
 */
export class ChildTunnelRuntime {
  private activeProcess: ChildProcess | null = null;
  private activeTunnelUrl: string | null = null;
  private pendingCreate: Promise<string | null> | null = null;

  constructor(private readonly spec: ChildProviderSpec) {}

  // ── PID file helpers ──────────────────────────────────────────────
  private pidPath(): string {
    return path.join(os.homedir(), ".pi", "dashboard", this.spec.pidFileName);
  }

  writePid(pid: number): void {
    fs.mkdirSync(path.dirname(this.pidPath()), { recursive: true });
    fs.writeFileSync(this.pidPath(), String(pid) + "\n");
  }

  readPid(): number | null {
    try {
      const content = fs.readFileSync(this.pidPath(), "utf-8").trim();
      const pid = parseInt(content, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  removePid(): void {
    try {
      fs.unlinkSync(this.pidPath());
    } catch {
      // File may not exist — fine
    }
  }

  // ── Stale process cleanup ─────────────────────────────────────────
  async cleanupStale(): Promise<void> {
    const pid = this.readPid();
    if (pid === null) return;
    if (isProcessAlive(pid)) {
      try {
        const result = await killProcess(pid, { timeoutMs: 2000 });
        if (result.ok) console.log(`Killed stale ${this.spec.id} process (PID ${pid})`);
      } catch (err: any) {
        console.warn(`Failed to kill stale ${this.spec.id} process (PID ${pid}): ${err.message}`);
      }
    }
    this.removePid();
  }

  // ── Orphan scavenge ───────────────────────────────────────────────
  scavengeOrphans(port: number): number[] {
    const killed: number[] = [];
    let output = "";
    try {
      output = execSync("ps -ax -o pid=,args=", { encoding: "utf-8", timeout: 5_000 }).toString();
    } catch {
      return killed;
    }
    const endpointMarker = this.spec.endpointMarker(port);
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const marker = this.spec.processMarker;
      const markerHit = typeof marker === "string" ? trimmed.includes(marker) : marker.test(trimmed);
      if (!markerHit) continue;
      if (!trimmed.includes(endpointMarker)) continue;
      const m = trimmed.match(/^(\d+)\s+/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (pid === process.pid) continue; // never kill ourselves
      try {
        killPidWithGroup(pid, "SIGTERM");
        killed.push(pid);
        console.log(`Scavenged orphan ${this.spec.id} process (PID ${pid})`);
      } catch {
        // Process may have exited between ps and kill — ignore
      }
    }
    return killed;
  }

  // ── Tunnel creation ───────────────────────────────────────────────
  createTunnel(port: number, reservedToken?: string, retriesLeft = 1): Promise<string | null> {
    if (this.pendingCreate) return this.pendingCreate;
    if (this.activeTunnelUrl) return Promise.resolve(this.activeTunnelUrl);
    const promise = this.createInner(port, reservedToken, retriesLeft);
    this.pendingCreate = promise;
    promise.finally(() => {
      if (this.pendingCreate === promise) this.pendingCreate = null;
    });
    return promise;
  }

  private createInner(port: number, reservedToken?: string, retriesLeft = 1): Promise<string | null> {
    return new Promise(async (resolve) => {
      if (!this.spec.detectBinary()) {
        resolve(null);
        return;
      }
      if (!this.spec.isEnrolled()) {
        console.warn(`${this.spec.id} not enrolled — skipping tunnel creation`);
        resolve(null);
        return;
      }

      const callerProvidedToken = !!reservedToken;
      let token = reservedToken;
      if (!token && this.spec.reserve) {
        token = (await this.spec.reserve(port)) ?? undefined;
      }

      let resolved = false;
      let output = "";
      const args = this.spec.buildArgs(port, token);
      const child = spawn(this.spec.getBinary(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn(`${this.spec.id} tunnel creation timed out (30s)`);
          try {
            if (child.pid != null) killPidWithGroup(child.pid, "SIGTERM");
            else child.kill("SIGTERM");
          } catch { /* already dead */ }
          setTimeout(() => {
            try {
              if (child.pid != null) killPidWithGroup(child.pid, "SIGKILL");
              else child.kill("SIGKILL");
            } catch { /* already dead */ }
          }, 2_000);
          if (token && !callerProvidedToken) this.spec.release?.(token);
          this.removePid();
          resolve(null);
        }
      }, SPAWN_TIMEOUT_MS);

      const handleOutput = (chunk: Buffer) => {
        output += chunk.toString();
        const urlMatch = output.match(this.spec.urlRegex);
        if (urlMatch && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          const url = this.spec.normalizeUrl ? this.spec.normalizeUrl(urlMatch[0]) : urlMatch[0];
          this.activeTunnelUrl = url;
          this.activeProcess = child;
          this.writePid(child.pid!);
          resolve(url);
        }
      };

      child.stdout!.on("data", handleOutput);
      child.stderr!.on("data", handleOutput);

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.warn(`${this.spec.id} tunnel spawn failed: ${err.message}`);
          resolve(null);
        }
      });

      child.on("exit", (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          if (token && callerProvidedToken && retriesLeft > 0) {
            // Reserved name (caller-provided): retry the SAME name; NEVER
            // release/regenerate it (a reserved name must survive to keep a
            // stable URL). See change: support-zrok-v2.
            console.warn(`${this.spec.id} share failed (code ${code}); retrying same reserved name...`);
            resolve(this.createInner(port, token, retriesLeft - 1));
          } else if (token && !callerProvidedToken && retriesLeft > 0) {
            console.warn(`Reserved share failed (code ${code}), releasing token (redacted) and creating new reservation...`);
            this.spec.release?.(token);
            resolve(this.createInner(port, undefined, retriesLeft - 1));
          } else if (token && !callerProvidedToken) {
            console.warn(`Reserved share failed (code ${code}) and retry budget exhausted; releasing token (redacted)`);
            this.spec.release?.(token);
            resolve(null);
          } else {
            console.warn(`${this.spec.id} process exited before producing URL (code ${code})`);
            resolve(null);
          }
        } else if (this.activeProcess === child) {
          console.warn(`${this.spec.id} tunnel process exited unexpectedly (code ${code})`);
          this.activeProcess = null;
          this.activeTunnelUrl = null;
          this.removePid();
        }
      });
    });
  }

  async deleteTunnel(port?: number): Promise<void> {
    const child = this.activeProcess;
    this.activeProcess = null;
    this.activeTunnelUrl = null;
    if (child) {
      try {
        if (child.pid != null) await killProcess(child.pid, { timeoutMs: 2000 });
        else child.kill("SIGTERM");
      } catch (err: any) {
        console.warn(`${this.spec.id} tunnel cleanup failed: ${err.message}`);
      }
    }
    this.removePid();
    if (typeof port === "number") {
      try { this.scavengeOrphans(port); } catch { /* best-effort */ }
    }
  }

  getTunnelUrl(): string | null {
    return this.activeTunnelUrl;
  }
}
