/**
 * Fixtures for the logs / start-record / output-capture tests: a real
 * `NativeDriver` / `AttachedDriver` with a fake `spawn`, sharing the manager's
 * `OutputCapture`, rooted in a throwaway dir.
 * See change: add-services-settings-ui.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { vi } from "vitest";
import type { CommandRunner } from "../command-runner.js";
import { NativeDriver } from "../native-driver.js";
import { OciDriver } from "../oci-driver.js";
import { OutputCapture } from "../output-capture.js";
import { servicesPaths } from "../paths.js";
import { loadDigestKey, secretsDigest, writeStartRecord } from "../start-record.js";
import { type Harness, makeManager, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

export function nativeDefOf(id = "docling", secrets: Record<string, { env?: string; ref?: string }> = {}): ServiceDefinition {
  return {
    id,
    mode: "managed",
    drivers: ["native"],
    native: {
      runner: "uvx",
      package: "docling-serve@1.36.0",
      args: ["--port", "${port.http}"],
      ports: { http: { protocol: "http" } },
    },
    health: { kind: "http", endpoint: "http", path: "/health" },
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    origin: "user",
  } as ServiceDefinition;
}

export interface NativeHarness extends Harness {
  paths: ReturnType<typeof servicesPaths>;
  output: OutputCapture;
  alive: { value: boolean };
  spawn: ReturnType<typeof vi.fn>;
  def: ServiceDefinition;
  roots: string[];
}

/** A manager over ONE native definition whose child never really spawns. */
export function nativeHarness(def: ServiceDefinition, opts: { run?: CommandRunner; platform?: NodeJS.Platform } = {}): NativeHarness {
  const root = tmpRoot("svc-logs-");
  writeDefinitions(root, [def]);
  const paths = servicesPaths(root);
  const output = new OutputCapture(paths);
  const alive = { value: true };
  const spawn = vi.fn(() => Object.assign(new EventEmitter(), { pid: 4321, unref: vi.fn() }));
  const run = opts.run ?? recordingRunner().run;
  const native = new NativeDriver({
    run,
    resolveBinary: (n) => `/usr/bin/${n}`,
    paths,
    platform: "linux",
    spawn: spawn as never,
    allocatePort: async () => 47_000,
    isAlive: () => alive.value,
    // NEVER the real thing: the fake pid must not be signalled.
    killProcessGroup: (async () => {
      alive.value = false;
      return { ok: true, forced: false };
    }) as never,
    output,
  });
  const h = makeManager(root, { drivers: { native }, output, run, ...(opts.platform ? { platform: opts.platform } : {}) });
  return { ...h, paths, output, alive, spawn, def, roots: [root] };
}

/** Write a `start.json` the way a dashboard start would (digest over `values`). */
export function seedStartRecord(
  h: { paths: ReturnType<typeof servicesPaths> },
  id: string,
  driver: "native" | "attached" | "oci:docker" | "oci:podman",
  values: Record<string, string> = {},
  extra: { startedAt?: string; output?: { dev: number; ino: number } | null } = {},
): void {
  writeStartRecord(h.paths, id, {
    driver,
    startedAt: extra.startedAt ?? "2026-10-15T10:00:00.000Z",
    secretsDigest: secretsDigest(loadDigestKey(h.paths), values),
    secretsSavedSinceStart: false,
    ...(extra.output ? { output: extra.output } : {}),
  });
}

export function writeOutput(h: { paths: ReturnType<typeof servicesPaths> }, id: string, text: string): void {
  fs.mkdirSync(h.paths.runDir(id), { recursive: true, mode: 0o700 });
  fs.writeFileSync(h.paths.outputLog(id), text, { mode: 0o600 });
}

/** A manager over real OciDrivers on a scripted docker/podman CLI (`respond(args, file)`). */
export function ociHarness(
  def: ServiceDefinition,
  respond: (args: string[], file: string) => Partial<import("../command-runner.js").RunResult> | undefined,
  extraDefs: ServiceDefinition[] = [],
  opts: { resolveBinary?: (n: string) => string | null; kill?: (pid: number, sig: NodeJS.Signals | number) => void } = {},
) {
  const root = tmpRoot("svc-oci-");
  writeDefinitions(root, [def, ...extraDefs]);
  const paths = servicesPaths(root);
  const runner = recordingRunner((f, args) => respond(args, f) ?? {});
  const resolveBinary = opts.resolveBinary ?? ((n: string) => `/usr/bin/${n}`);
  const oci = new OciDriver({ runtime: "docker", run: runner.run, resolveBinary, paths });
  const h = makeManager(root, { run: runner.run, resolveBinary, drivers: { "oci:docker": oci }, ...(opts.kill ? { kill: opts.kill } : {}) });
  return { ...h, paths, runner, oci, roots: [root] };
}

export function cleanup(roots: string[]): void {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
}
