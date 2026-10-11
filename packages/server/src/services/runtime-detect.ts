/**
 * Runtime detection report (`GET /api/services/runtimes`). On demand only,
 * read-only commands only (`--version`, `info`, `machine list`), cached 30 s.
 * Reports host-VM state; never starts or stops a host or guest VM.
 * See change: add-service-registry-core (D10, D11).
 */
import type { CommandRunner } from "./command-runner.js";

type Capability = "ok" | "ok-destructive" | "cli-present" | "needs-secret" | "unavailable" | "unsupported";

export interface RuntimeReport {
  id: "docker" | "podman" | "qemu" | "virtualbox" | "vmware";
  kind: "container" | "hypervisor";
  installed: boolean;
  version?: string;
  /** Container runtimes only. */
  reachable?: boolean;
  hostVm?: "running" | "stopped" | "none" | "unknown";
  capabilities: Record<string, Capability>;
}

export interface RuntimeDetectDeps {
  run: CommandRunner;
  resolveBinary: (name: string) => string | null;
  /** Env for container-runtime calls (isolated DOCKER_CONFIG). */
  containerEnv?: () => NodeJS.ProcessEnv;
  now?: () => number;
  cacheMs?: number;
}

function firstVersion(text: string): string | undefined {
  return /\d+\.\d+(?:\.\d+)?/.exec(text)?.[0];
}

export class RuntimeDetector {
  private cache?: { at: number; reports: RuntimeReport[] };
  private inflight?: Promise<RuntimeReport[]>;

  constructor(private readonly deps: RuntimeDetectDeps) {}

  async detect(): Promise<RuntimeReport[]> {
    const now = (this.deps.now ?? Date.now)();
    if (this.cache && now - this.cache.at < (this.deps.cacheMs ?? 30_000)) return this.cache.reports;
    this.inflight ??= this.detectFresh().finally(() => {
      this.inflight = undefined;
    });
    const reports = await this.inflight;
    this.cache = { at: (this.deps.now ?? Date.now)(), reports };
    return reports;
  }

  private async container(id: "docker" | "podman"): Promise<RuntimeReport> {
    const bin = this.deps.resolveBinary(id);
    const off: Record<string, Capability> = { create: "unavailable", start: "unavailable", stop: "unavailable", hostVmControl: "unsupported" };
    if (!bin) return { id, kind: "container", installed: false, reachable: false, capabilities: off };
    const env = this.deps.containerEnv?.();
    const v = await this.deps.run(bin, ["--version"], { env, timeoutMs: 10_000 });
    const info = await this.deps.run(bin, ["info", "--format", "{{json .}}"], { env, timeoutMs: 15_000 });
    const reachable = info.code === 0;
    let hostVm: RuntimeReport["hostVm"] = "unknown";
    if (id === "podman") {
      const m = await this.deps.run(bin, ["machine", "list", "--format", "json"], { env, timeoutMs: 10_000 });
      try {
        const list = JSON.parse(m.stdout) as Array<{ Running?: boolean }>;
        hostVm = !Array.isArray(list) || list.length === 0 ? "none" : list.some((x) => x.Running) ? "running" : "stopped";
      } catch {
        hostVm = "unknown";
      }
    } else {
      // `docker desktop status` is unverified (design D4): unknown unless it parses.
      const d = await this.deps.run(bin, ["desktop", "status", "--format", "json"], { env, timeoutMs: 10_000 });
      try {
        const st = String((JSON.parse(d.stdout) as { Status?: string }).Status ?? "").toLowerCase();
        if (st === "running" || st === "stopped") hostVm = st;
      } catch {
        /* not Docker Desktop, or no status command */
      }
    }
    const cap: Capability = reachable ? "ok" : "unavailable";
    return {
      id,
      kind: "container",
      installed: true,
      version: firstVersion(v.stdout),
      reachable,
      hostVm,
      capabilities: { create: cap, start: cap, stop: cap, remove: reachable ? "ok-destructive" : "unavailable", hostVmControl: "unsupported" },
    };
  }

  private async hypervisor(id: "qemu" | "virtualbox" | "vmware", bins: string[], versionArgs: string[] | null): Promise<RuntimeReport> {
    const bin = bins.map((b) => this.deps.resolveBinary(b)).find((b): b is string => !!b);
    const caps: Record<string, Capability> = { detect: bin ? "cli-present" : "unavailable", start: "unsupported", stop: "unsupported", snapshot: "unsupported" };
    if (!bin) return { id, kind: "hypervisor", installed: false, capabilities: caps };
    let version: string | undefined;
    if (versionArgs) {
      const r = await this.deps.run(bin, versionArgs, { timeoutMs: 10_000 });
      version = firstVersion(`${r.stdout}\n${r.stderr}`);
    }
    return { id, kind: "hypervisor", installed: true, ...(version ? { version } : {}), capabilities: caps };
  }

  private async detectFresh(): Promise<RuntimeReport[]> {
    return Promise.all([
      this.container("docker"),
      this.container("podman"),
      this.hypervisor("qemu", ["qemu-system-aarch64", "qemu-system-x86_64"], ["--version"]),
      this.hypervisor("virtualbox", ["VBoxManage"], ["--version"]),
      // `vmrun` has no version flag; its usage banner carries "vmrun version x.y.z".
      this.hypervisor("vmware", ["vmrun"], []),
    ]);
  }
}
