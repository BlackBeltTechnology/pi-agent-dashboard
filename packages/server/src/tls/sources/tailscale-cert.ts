/**
 * Tailscale certificate source: obtains a certificate for the node's own
 * MagicDNS name from the local `tailscaled` via `tailscale cert`.
 *
 * - Own 120 s runner (NOT the provider's 4 s readiness default): first issuance
 *   is slow. The runner kills the child; a promise-level race reports the
 *   timeout even when an injected runner cannot be killed.
 * - Never touches the network in `readiness()`/`names()`: they read a cached
 *   `status --json` (30 s TTL, `force` re-reads).
 * - Daemon down / binary missing / logged out → unmet `tailscale-running` gate
 *   and `names()` = `null` (the manager must not prune a held cert on an outage).
 * - Tailnet HTTPS disabled → unmet `https-certs` gate (shared
 *   `tailnetHttpsEnabled` helper — same verdict as the funnel gate).
 * - Runs `tailscale cert` into a private 0700 temp dir and returns PEM strings;
 *   only the CertManager writes files.
 *
 * See change: add-tailscale-cert-tls (design D4).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { type AsyncCmdResult, type AsyncCmdRunner, asyncRunner } from "../../tunnel-providers/daemon-exec.js";
import {
  isBackendRunning,
  selfDnsName,
  selfMeshIpv4,
  tailnetHttpsEnabled,
} from "../../tunnel-providers/tailscale.js";
import type { CertSource, CertSourceDeps, CertSourceType, Gate, ObtainedCert, SourceReadiness } from "../types.js";

const TAILSCALE_CERT_TIMEOUT_MS = 120_000;
const STATUS_TTL_MS = 30_000;
const ERROR_MAX = 500;

const resolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });
const getBinary = (): string => resolver.which("tailscale") ?? "tailscale";

export interface TailscaleCertSourceOptions {
  id?: string;
  /** Directory the per-attempt private temp dirs live under. */
  dataDir: string;
  /** Runner for `status --json` (default: 4 s readiness runner). */
  runStatus?: AsyncCmdRunner;
  /** Runner for `cert` (default: 120 s runner). */
  runCert?: AsyncCmdRunner;
  now?: () => number;
}

interface StatusSnapshot {
  at: number;
  json: unknown;
  running: boolean;
}

export class TailscaleCertSource implements CertSource {
  readonly id: string;
  readonly type = "tailscale";
  /** Above the 120 s CLI bound, so the source's own timeout message wins over the manager's generic one. */
  readonly attemptTimeoutMs = TAILSCALE_CERT_TIMEOUT_MS + 60_000;

  private readonly dataDir: string;
  private readonly runStatus: AsyncCmdRunner;
  private readonly runCert: AsyncCmdRunner;
  private readonly now: () => number;
  private snapshot?: StatusSnapshot;
  private reading?: Promise<StatusSnapshot>;

  constructor(opts: TailscaleCertSourceOptions) {
    this.id = opts.id ?? "tailscale";
    this.dataDir = opts.dataDir;
    this.runStatus = opts.runStatus ?? asyncRunner(getBinary);
    this.runCert = opts.runCert ?? asyncRunner(getBinary, TAILSCALE_CERT_TIMEOUT_MS);
    this.now = opts.now ?? Date.now;
  }

  private async read(force: boolean): Promise<StatusSnapshot> {
    if (!force && this.snapshot && this.now() - this.snapshot.at < STATUS_TTL_MS) return this.snapshot;
    if (this.reading !== undefined) return this.reading;
    this.reading = (async () => {
      let json: unknown = null;
      try {
        const r = await this.runStatus(["status", "--json"]);
        if (r.code === 0) json = JSON.parse(r.stdout);
      } catch {
        json = null;
      }
      const snap: StatusSnapshot = { at: this.now(), json, running: isBackendRunning(json) };
      this.snapshot = snap;
      return snap;
    })().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  async names(): Promise<string[] | null> {
    const snap = await this.read(false);
    if (!snap.running) return null;
    const dns = selfDnsName(snap.json);
    return dns ? [dns.toLowerCase()] : [];
  }

  configFingerprint(name: string): string {
    return createHash("sha256").update(`tailscale:v1:${name}`).digest("hex").slice(0, 16);
  }

  async readiness(opts?: { force?: boolean }): Promise<SourceReadiness> {
    const snap = await this.read(opts?.force === true);
    if (!snap.running) {
      return {
        gates: [
          {
            id: "tailscale-running",
            ok: false,
            hint: "Tailscale is not running or is not signed in. Start Tailscale and sign in, then check again.",
          },
        ],
      };
    }
    const gates: Gate[] = [];
    if (tailnetHttpsEnabled(snap.json) === false) {
      gates.push({
        id: "https-certs",
        ok: false,
        hint: "Enable HTTPS certificates for your tailnet in the Tailscale admin console (DNS → HTTPS Certificates).",
      });
    }
    const ipv4 = selfMeshIpv4(snap.json);
    return { gates, ...(ipv4 ? { details: { ipv4 } } : {}) };
  }

  async obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert> {
    onStage("requesting");
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = await fs.mkdtemp(path.join(this.dataDir, ".issue-"));
    try {
      await fs.chmod(tmp, 0o700);
      const certFile = path.join(tmp, "x.crt");
      const keyFile = path.join(tmp, "x.key");
      const r = await this.withTimeout(
        this.runCert(["cert", "--cert-file", certFile, "--key-file", keyFile, name]),
        TAILSCALE_CERT_TIMEOUT_MS,
      );
      if (r.code !== 0) {
        const msg = (r.stderr || r.stdout).trim().slice(0, ERROR_MAX);
        throw new Error(msg || `tailscale cert exited with code ${r.code}`);
      }
      const [certPem, keyPem] = await Promise.all([fs.readFile(certFile, "utf8"), fs.readFile(keyFile, "utf8")]);
      return { certPem, keyPem, advertise: true, kind: "magicdns" };
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private withTimeout(p: Promise<AsyncCmdResult>, ms: number): Promise<AsyncCmdResult> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tailscale cert timed out after ${ms / 1000} s`)), ms);
      timer.unref?.();
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}

export const tailscaleSourceType: CertSourceType = {
  type: "tailscale",
  defaultId: "tailscale",
  validate: () => null,
  create: (_entry: Record<string, unknown>, id: string, deps: CertSourceDeps) =>
    new TailscaleCertSource({ id, dataDir: deps.dataDir }),
};
