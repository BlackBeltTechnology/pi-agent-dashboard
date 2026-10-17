/**
 * Connection resolution + the obs-websocket v5 connection (design D2, D4, D13).
 *
 * Resolution order: `--service <id>` (password `SVC_<ID>_PASSWORD` from the
 * `service exec` child env, URL `--url` or the definition's `endpoints.ws`) →
 * a single `SVC_*_PASSWORD` in env → `OBS_URL` / `OBS_PASSWORD` (standalone
 * fallback, keeps OBS-Transcribe's scripts working). Several `SVC_*_PASSWORD`
 * without `--service` is a usage error. A `--password` argument is a usage
 * error naming the supported channels.
 *
 * `connectObs` distinguishes `unreachable` (no hello), `auth-failed` (hello
 * received, Identify rejected) and `timeout` (connect 3 s, request 5 s). The
 * password is never logged; the `log` sink gets outcome + request type + latency.
 * See change: add-obs-studio-plugin.
 */
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { execSecretEnvName } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { ObsError } from "./errors.js";
import { envPrefix } from "./service-defs.js";

export const CONNECT_TIMEOUT_MS = 3000;
export const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_OBS_URL = "ws://127.0.0.1:4455";

const SECRET_CHANNELS =
  "the password comes only from `pi-dashboard service exec <id> -- pi-obs … --service <id>` (SVC_<ID>_PASSWORD) or the OBS_PASSWORD environment variable";

export interface TargetFlags {
  service?: string;
  url?: string;
  /** `--password` was passed (always refused). */
  passwordArg?: boolean;
}

export interface ObsTarget {
  url: string;
  password?: string;
  serviceId?: string;
  source: "service" | "env";
}

const SVC_PASSWORD = /^SVC_(.+)_PASSWORD$/;

/** Resolve where to connect and with which password. Throws `ObsError("usage")`. */
export function resolveTarget(
  flags: TargetFlags,
  env: Record<string, string | undefined>,
  defs: readonly ServiceDefinition[],
): ObsTarget {
  if (flags.passwordArg) throw new ObsError("usage", `--password is not accepted: ${SECRET_CHANNELS}`);
  if (flags.service) {
    const def = defs.find((d) => d.id === flags.service);
    const url = flags.url ?? def?.endpoints?.ws;
    if (!url) throw new ObsError("not-found", `service ${flags.service} has no ws endpoint; pass --url or provision it with pi-obs provision`);
    return { url, password: env[execSecretEnvName(flags.service, "password")], serviceId: flags.service, source: "service" };
  }
  const svc = Object.keys(env)
    .filter((k) => SVC_PASSWORD.test(k) && env[k] !== undefined)
    .sort();
  if (svc.length > 1) {
    throw new ObsError("usage", `several service passwords are set (${svc.join(", ")}); pass --service <id> to pick one`);
  }
  if (svc.length === 1) {
    const prefix = svc[0].slice(0, -"PASSWORD".length);
    const def = defs.find((d) => envPrefix(d.id) === prefix);
    const url = flags.url ?? def?.endpoints?.ws;
    if (!url) throw new ObsError("usage", `${svc[0]} is set but its service is unknown; pass --service <id> or --url`);
    return { url, password: env[svc[0]], serviceId: def?.id, source: "service" };
  }
  return { url: flags.url ?? env.OBS_URL ?? DEFAULT_OBS_URL, password: env.OBS_PASSWORD, source: "env" };
}

/** True when `url`'s host is a loopback address or `localhost`. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || /^127\./.test(h);
  } catch {
    return false;
  }
}

/** The connected client every verb, `call` and `serve` use. */
export interface ObsConn {
  readonly url: string;
  readonly obsVersion: string;
  readonly wsVersion: string;
  readonly availableRequests: ReadonlySet<string>;
  /** Send one request, bounded by the request timeout. */
  call<T = Record<string, unknown>>(type: string, data?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

/** Minimal shape of the obs-websocket-js client (injectable for tests). */
interface RawObs {
  connect(url: string, password?: string, ident?: { rpcVersion?: number }): Promise<unknown>;
  call(type: string, data?: Record<string, unknown>): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: "Hello", fn: () => void): unknown;
}

export interface ConnectOptions {
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  log?: (line: string) => void;
  /** Factory for the obs-websocket client (default: `obs-websocket-js/json`). */
  createRaw?: () => Promise<RawObs>;
}

async function defaultRaw(): Promise<RawObs> {
  const mod = (await import("obs-websocket-js/json")) as unknown as { default: new () => RawObs };
  return new mod.default();
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => ObsError): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** OBS close code for a rejected Identify (obs-websocket `AuthenticationFailed`). */
const AUTH_FAILED_CLOSE = 4009;

export async function connectObs(target: ObsTarget, opts: ConnectOptions = {}): Promise<ObsConn> {
  const log = opts.log ?? (() => {});
  const connectMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const requestMs = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const raw = await (opts.createRaw ?? defaultRaw)();
  let hello = false;
  raw.on("Hello", () => {
    hello = true;
  });
  const started = Date.now();
  try {
    await withTimeout(raw.connect(target.url, target.password, { rpcVersion: 1 }), connectMs, () => new ObsError("timeout", `no answer from OBS at ${target.url} within ${connectMs} ms`));
  } catch (e) {
    void raw.disconnect().catch(() => {});
    if (e instanceof ObsError) {
      log(`[pi-obs] connect ${target.url}: timeout`);
      throw e;
    }
    const code = (e as { code?: unknown })?.code;
    if (hello || code === AUTH_FAILED_CLOSE) {
      log(`[pi-obs] connect ${target.url}: auth-failed`);
      throw new ObsError("auth-failed", `OBS at ${target.url} rejected the password; re-provision with pi-obs provision --update or rotate it`);
    }
    log(`[pi-obs] connect ${target.url}: unreachable`);
    throw new ObsError("unreachable", `OBS is not reachable at ${target.url} (is OBS running with obs-websocket enabled?)`);
  }
  log(`[pi-obs] connect ${target.url}: ok ${Date.now() - started}ms`);

  const call = async <T>(type: string, data?: Record<string, unknown>): Promise<T> => {
    const t0 = Date.now();
    try {
      const r = await withTimeout(raw.call(type, data), requestMs, () => new ObsError("timeout", `OBS did not answer ${type} within ${requestMs} ms`));
      log(`[pi-obs] ${type}: ok ${Date.now() - t0}ms`);
      return (r ?? {}) as T;
    } catch (e) {
      if (e instanceof ObsError) {
        log(`[pi-obs] ${type}: timeout`);
        throw e;
      }
      const code = (e as { code?: unknown })?.code;
      log(`[pi-obs] ${type}: error ${String(code ?? "")}`);
      throw new ObsError("failed", `${type} failed${code !== undefined ? ` (${String(code)})` : ""}: ${(e as Error).message}`, { obsCode: code });
    }
  };

  const version = await call<{ obsVersion?: string; obsWebSocketVersion?: string; availableRequests?: string[] }>("GetVersion");
  return {
    url: target.url,
    obsVersion: String(version.obsVersion ?? ""),
    wsVersion: String(version.obsWebSocketVersion ?? ""),
    availableRequests: new Set(version.availableRequests ?? []),
    call,
    close: () => raw.disconnect().catch(() => {}),
  };
}
