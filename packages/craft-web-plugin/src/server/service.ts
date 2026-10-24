/**
 * craft-web service: per-app status, single-flight prepare and the CSP-violation counters.
 * Pure of Fastify; `routes.ts` is the thin HTTP skin, `index.ts` the composition root.
 *
 * Status reasons (the client maps them to a disabled state; `ok` means loadable):
 *   disabled · restart-required · not-verified · not-prepared · shim-outdated ·
 *   offline · checksum-mismatch · launcher-source · extract-failed
 * The last four are the typed outcome of the most recent failed prepare (cleared by a successful one).
 *
 * See change: edit-office-in-pane-with-craft-web (D1, D2, D3; tasks 4.3, 4.5).
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  latestWebVersion,
  type ProvisionDeps,
  ProvisionWebError,
  type ProvisionWebFn,
  readLatestCache,
  type WebChannel,
  type WebErrorCode,
  type WebPostInstallContext,
} from "@blackbelt-technology/pi-dashboard-craft-apps/provision.js";
import { envPrefix, getApp } from "@blackbelt-technology/pi-dashboard-craft-apps/registry.js";
import { profileFor } from "../shared/app-profiles.js";
import { CLAIMED_APPS, CRAFT_WEB_APPS, isClaimedApp } from "./apps.js";
import { appChannel, appEnabled, type CraftWebConfig } from "./config.js";
import { createPostInstall, profileHash, readBuildInfo } from "./post-install.js";
import { createShimVersionReader } from "./shim.js";

type StatusReason =
  | "disabled"
  | "restart-required"
  | "not-verified"
  | "not-prepared"
  | "shim-outdated"
  | "offline"
  | "checksum-mismatch"
  | "launcher-source"
  | "extract-failed";

/** One app of `GET /api/plugins/craft-web/status`. `status` is `"ok"` or the `reason`. */
interface AppStatus {
  status: "ok" | StatusReason;
  reason?: StatusReason;
  message?: string;
  enabled: boolean;
  /** Version channel: `latest` via config `apps.<app>.version` or `<APP>_WEB_VERSION=latest`. */
  channel: WebChannel;
  /** Prepared version; otherwise the version a prepare would install (pin, or known latest). */
  version?: string;
  /** Prepared: real download bytes; otherwise the approximate size. */
  sizeGzip: number;
  /** Shim version of the prepared tree, when one is prepared. */
  shimVersion?: number;
  /** Version of the prepared build (any status), when one is prepared. */
  installedVersion?: string;
  /** Known latest web version (latest channel only). */
  latestVersion?: string;
  /** `ok` build prepared with an older (still supported) shim: re-preparing is offered as an update (D8). */
  shimUpdate?: boolean;
  preparing: boolean;
  /** CSP violations the host forwarded since the server started. */
  cspViolations: number;
}

interface CraftWebStatus {
  /** Shim version the installed plugin ships. */
  shimVersion: number;
  apps: Record<string, AppStatus>;
}

type PrepareFailureReason = StatusReason | "prepare-failed" | "unknown-app";

type PluginLogger = ServerPluginContext["logger"];

type PrepareOutcome =
  | { ok: true; app: string; version: string; cacheHit: boolean; shimVersion: number; sizeGzip: number; durationMs: number }
  | { ok: false; httpStatus: number; reason: PrepareFailureReason; message: string };

export interface CraftWebServiceDeps {
  /** `ctx.dataDir`: builds live in `<dataDir>/<app>-web/`. */
  dataDir: string;
  logger: PluginLogger;
  getConfig: () => CraftWebConfig | undefined;
  provisionWeb: ProvisionWebFn;
  /** Is the `/apps/craft-<app>/` mount registered (restart-effective)? */
  isMounted: (app: string) => boolean;
  /**
   * Fixture apps (FakeCraft, `PI_DASHBOARD_FIXTURE_PLUGINS=1` only): a prepared tree the plugin builds itself, so
   * their status is always `ok` and they have no prepare / config / registry entry.
   */
  fixtureApps?: readonly { app: string; version: string }[];
  /** Overrides of the provisioning seams (tests: fetch, env, apiBase…). */
  provisionDeps?: Partial<ProvisionDeps>;
  postInstall?: (ctx: WebPostInstallContext) => void | Promise<void>;
  shimVersion?: () => number;
  now?: () => number;
  /** Metadata-only latest lookup (default craft-apps `latestWebVersion`). */
  latestWebVersion?: (app: string, opts: Partial<ProvisionDeps> & { root?: string }) => Promise<string | undefined>;
}

const FAILURE_STATUS: Partial<Record<WebErrorCode, { reason: PrepareFailureReason; httpStatus: number }>> = {
  offline: { reason: "offline", httpStatus: 503 },
  "checksum-mismatch": { reason: "checksum-mismatch", httpStatus: 502 },
  "launcher-source": { reason: "launcher-source", httpStatus: 409 },
  "extract-failed": { reason: "extract-failed", httpStatus: 502 },
  "not-verified": { reason: "not-verified", httpStatus: 409 },
};

/** First shim version whose trees carry a profile (`craft-build.json` `profileHash`). */
const PROFILE_SINCE_SHIM = 2;

const CSP_WINDOW_MS = 60_000;
const CSP_MAX_PER_WINDOW = 30;

export interface CraftWebService {
  status(): CraftWebStatus;
  prepare(app: string): Promise<PrepareOutcome>;
  /** `false` when rate-limited (nothing counted or logged). */
  reportCsp(app: string, directive: string): boolean;
  /** Open outcome / validator reject counters (log only, no paths); `false` when rate-limited. */
  reportTelemetry(app: string, event: TelemetryEvent): boolean;
}

/** Host-reported events (design D4 observability). */
export type TelemetryEvent =
  | { kind: "open"; outcome: "title" | "fallback" | "timeout" | "start-failed" }
  | { kind: "reject"; ext: string }
  /** One live-control request (add-craft-live-control): outcome code (`ok` or an error code) and its duration. */
  | { kind: "control"; outcome: string; ms: number };

export function createCraftWebService(deps: CraftWebServiceDeps): CraftWebService {
  const { logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const shimVersion = deps.shimVersion ?? createShimVersionReader();
  const postInstall = deps.postInstall ?? createPostInstall();
  const env = (): NodeJS.ProcessEnv => deps.provisionDeps?.env ?? process.env;
  const currentDir = (app: string): string => path.join(deps.dataDir, `${app}-web`, "current");
  const lookupLatest = deps.latestWebVersion ?? latestWebVersion;
  const refreshing = new Set<string>();

  /**
   * Env `<APP>_WEB_VERSION=latest` wins over config; an explicit env pin/dir is handled by `registryPin`.
   * A `latestChannel:false` profile ignores a stored `latest` (fixed to the verified version, D8).
   */
  const channelOf = (app: string): WebChannel => {
    if (env()[`${envPrefix(getApp(app))}_WEB_VERSION`]?.trim().toLowerCase() === "latest") return "latest";
    return profileFor(app)?.latestChannel === false ? "pinned" : appChannel(deps.getConfig(), app);
  };

  /** Known latest version in the latest channel (a `<APP>_WEB_DIR` override decides alone). */
  const latestFor = (app: string, channel: WebChannel): string | undefined =>
    channel === "latest" && !env()[`${envPrefix(getApp(app))}_WEB_DIR`]?.trim() ? knownLatest(app) : undefined;

  /**
   * Version a prepare would install. Pinned: registry pin (undefined under an env override); latest: the known
   * latest. `keepPrepared`: a failed latest update keeps the prepared build usable (D3); a pin mismatch never does.
   */
  const target = (app: string, channel: WebChannel): { want?: string; keepPrepared: boolean } => {
    const latest = latestFor(app, channel);
    return { want: registryPin(app) ?? latest, keepPrepared: latest !== undefined && lastFailure.has(app) };
  };

  /** Latest version from the 24 h cache (sync); when unknown, start one background metadata refresh. */
  const knownLatest = (app: string): string | undefined => {
    const tag = readLatestCache(path.join(deps.dataDir, `${app}-web`), now());
    if (tag) return tag.replace(/^v/, "");
    if (!refreshing.has(app)) {
      refreshing.add(app);
      void lookupLatest(app, { ...deps.provisionDeps, root: deps.dataDir })
        .catch(() => undefined)
        .finally(() => refreshing.delete(app));
    }
    return undefined;
  };

  const preparing = new Map<string, Promise<PrepareOutcome>>();
  const lastFailure = new Map<string, { reason: StatusReason; message: string }>();
  const cspCounts = new Map<string, number>();
  const cspWindow = new Map<string, { start: number; n: number; warned: boolean }>();
  const telemetryCounts = new Map<string, number>();
  const telemetryWindow = new Map<string, { start: number; n: number; warned: boolean }>();

  /** Fixed-window limiter: `false` once `CSP_MAX_PER_WINDOW` events of `key` arrived within a minute. */
  function admit(windows: Map<string, { start: number; n: number; warned: boolean }>, key: string, what: string): boolean {
    const t = now();
    const w = windows.get(key);
    const win = !w || t - w.start >= CSP_WINDOW_MS ? { start: t, n: 0, warned: false } : w;
    windows.set(key, win);
    if (win.n >= CSP_MAX_PER_WINDOW) {
      if (!win.warned) {
        win.warned = true;
        logger.warn(`${what} ${key}: rate limit reached (${CSP_MAX_PER_WINDOW}/min); dropping further reports`);
      }
      return false;
    }
    win.n++;
    return true;
  }

  /** Pin the registry would resolve to (`undefined` when an env override decides the version). */
  const registryPin = (app: string): string | undefined => {
    const prefix = envPrefix(getApp(app));
    const e = env();
    if (e[`${prefix}_WEB_DIR`]?.trim() || e[`${prefix}_WEB_VERSION`]?.trim() || channelOf(app) === "latest") return undefined;
    return getApp(app).webVersion?.replace(/^v/, "");
  };

  /** Status plus the installed / known-latest versions the settings section shows. */
  function appStatus(app: string): AppStatus {
    const s = computeStatus(app);
    const installedVersion = readBuildInfo(currentDir(app))?.version;
    const latestVersion = s.enabled ? latestFor(app, s.channel) : undefined;
    return { ...s, ...(installedVersion ? { installedVersion } : {}), ...(latestVersion ? { latestVersion } : {}) };
  }

  function computeStatus(app: string): AppStatus {
    const enabled = appEnabled(deps.getConfig(), app);
    const channel = channelOf(app);
    const base = {
      enabled,
      channel,
      preparing: preparing.has(app),
      cspViolations: cspCounts.get(app) ?? 0,
      sizeGzip: CRAFT_WEB_APPS[app].approxDownloadBytes,
    };
    const blocked = (reason: StatusReason, extra: Partial<AppStatus> = {}, message?: string): AppStatus => ({
      ...base,
      ...extra,
      status: reason,
      reason,
      ...(message ? { message } : {}),
    });
    if (!enabled) return blocked("disabled", {}, `${getApp(app).name} is disabled in plugin settings`);
    const verified = getApp(app).webVersion;
    if (!verified) return blocked("not-verified", {}, `${getApp(app).name} has no verified web build`);
    if (!deps.isMounted(app)) return blocked("restart-required", {}, "The plugin was enabled after the server started; restart the server");

    const build = readBuildInfo(currentDir(app));
    const { want, keepPrepared } = target(app, channel);
    const failure = lastFailure.get(app);
    const fail = (fallback: StatusReason, extra: Partial<AppStatus>): AppStatus =>
      failure ? blocked(failure.reason, extra, failure.message) : blocked(fallback, extra);
    if (!build) return fail("not-prepared", { version: want ?? verified });
    const prepared = { version: build.version, sizeGzip: build.sizeGzip, shimVersion: build.shimVersion };
    const shim = shimCompat(app, build.shimVersion, build.profileHash);
    if (shim === "outdated") return fail("shim-outdated", prepared);
    if (want !== undefined && build.version !== want && !keepPrepared) return fail("not-prepared", { ...prepared, version: want, sizeGzip: base.sizeGzip });
    return { ...base, ...prepared, ...(shim === "update" ? { shimUpdate: true } : {}), status: "ok" };
  }

  /**
   * Shim compatibility of a prepared tree (D8): newer than the plugin's shim, older than the profile's
   * `minShimVersion`, or the current shim with another profile hash → `outdated`; an older supported shim
   * → `update` (loads, re-prepare offered); else `current`.
   */
  function shimCompat(app: string, buildShim: number, buildProfile: string | undefined): "current" | "update" | "outdated" {
    const cur = shimVersion();
    const minShim = profileFor(app)?.minShimVersion ?? cur;
    if (buildShim > cur || buildShim < minShim) return "outdated";
    if (buildShim < cur) return "update";
    const profile = profileFor(app);
    if (buildShim >= PROFILE_SINCE_SHIM && profile && buildProfile !== profileHash(profile)) return "outdated";
    return "current";
  }

  /**
   * Trees of the current shim prepared with another profile hash can never become `ok`; drop them so the
   * prepare re-runs post-install instead of reusing the cached `<version>-s<shim>` tree. Deleting before the
   * re-prepare is safe: such a tree is already `shim-outdated` (never loaded), so a failed (offline) prepare
   * loses nothing usable — the same trade-off D3 accepts for a code downgrade.
   */
  function dropStaleProfileTrees(app: string): void {
    const profile = profileFor(app);
    const cur = shimVersion();
    if (!profile || cur < PROFILE_SINCE_SHIM) return;
    const want = profileHash(profile);
    const root = path.join(deps.dataDir, `${app}-web`);
    let names: string[];
    try {
      names = fs.readdirSync(root).filter((n) => n.endsWith(`-s${cur}`));
    } catch {
      return;
    }
    for (const n of names) {
      const info = readBuildInfo(path.join(root, n));
      if (info && info.profileHash !== want) {
        logger.info(`prepare ${app}: dropping ${n} (profile ${info.profileHash ?? "none"} ≠ ${want})`);
        fs.rmSync(path.join(root, n), { recursive: true, force: true });
      }
    }
  }

  /** Map a failed provisioning run to the HTTP outcome, remember typed failures for `status`, and log it. */
  function failedPrepare(app: string, err: unknown, durationMs: number): PrepareOutcome {
    const message = err instanceof Error ? err.message : String(err);
    const mapped = err instanceof ProvisionWebError ? FAILURE_STATUS[err.code] : undefined;
    const reason: PrepareFailureReason = mapped?.reason ?? "prepare-failed";
    if (mapped && reason !== "not-verified") lastFailure.set(app, { reason: reason as StatusReason, message });
    logger.warn(
      `prepare ${app} failed reason=${reason} code=${err instanceof ProvisionWebError ? err.code : "unexpected"} durationMs=${durationMs}: ${message}`,
    );
    return { ok: false, httpStatus: mapped?.httpStatus ?? 502, reason, message: `${getApp(app).name} could not be prepared: ${message}` };
  }

  async function runPrepare(app: string): Promise<PrepareOutcome> {
    const started = now();
    try {
      dropStaleProfileTrees(app);
      const report = await deps.provisionWeb(app, {
        ...deps.provisionDeps,
        root: deps.dataDir,
        channel: channelOf(app),
        shimVersion: shimVersion(),
        postInstall,
        log: (m: string) => logger.info(m),
      });
      const info = readBuildInfo(report.dir);
      lastFailure.delete(app);
      const outcome: PrepareOutcome = {
        ok: true,
        app,
        version: report.version,
        cacheHit: report.cacheHit,
        shimVersion: report.shimVersion,
        sizeGzip: info?.sizeGzip ?? CRAFT_WEB_APPS[app].approxDownloadBytes,
        durationMs: now() - started,
      };
      logger.info(
        `prepare ${app} ok version=${outcome.version} source=${report.source} cacheHit=${outcome.cacheHit} bytes=${outcome.sizeGzip} durationMs=${outcome.durationMs}`,
      );
      return outcome;
    } catch (err) {
      return failedPrepare(app, err, now() - started);
    }
  }

  return {
    status() {
      const apps: Record<string, AppStatus> = {};
      for (const app of CLAIMED_APPS) apps[app] = appStatus(app);
      for (const f of deps.fixtureApps ?? []) {
        apps[f.app] = { status: "ok", enabled: true, channel: "pinned", version: f.version, installedVersion: f.version, sizeGzip: 0, shimVersion: shimVersion(), preparing: false, cspViolations: cspCounts.get(f.app) ?? 0 };
      }
      return { shimVersion: shimVersion(), apps };
    },

    prepare(app) {
      if (!isClaimedApp(app)) {
        return Promise.resolve({ ok: false, httpStatus: 404, reason: "unknown-app", message: `unknown app "${app}"` });
      }
      const gate = appStatus(app);
      if (gate.reason === "disabled" || gate.reason === "not-verified" || gate.reason === "restart-required") {
        const httpStatus = gate.reason === "disabled" ? 403 : 409;
        logger.warn(`prepare ${app} refused reason=${gate.reason}`);
        return Promise.resolve({ ok: false, httpStatus, reason: gate.reason, message: gate.message ?? gate.reason });
      }
      const inflight = preparing.get(app);
      if (inflight) return inflight;
      const run = runPrepare(app).finally(() => preparing.delete(app));
      preparing.set(app, run);
      return run;
    },

    reportCsp(app, directive) {
      if (!admit(cspWindow, app, "csp-report")) return false;
      cspCounts.set(app, (cspCounts.get(app) ?? 0) + 1);
      logger.warn(`csp-report ${app} directive=${directive} total=${cspCounts.get(app)}`);
      return true;
    },

    reportTelemetry(app, event) {
      if (!admit(telemetryWindow, app, "telemetry")) return false;
      if (event.kind === "control") {
        const line = `telemetry ${app} control outcome=${event.outcome} ms=${Math.round(event.ms)}`;
        if (event.outcome === "ok") logger.info(line);
        else logger.warn(line);
        return true;
      }
      const label = event.kind === "open" ? `open outcome=${event.outcome}` : `validator-reject ext=${event.ext}`;
      const key = `${app} ${label}`;
      telemetryCounts.set(key, (telemetryCounts.get(key) ?? 0) + 1);
      const line = `telemetry ${key} total=${telemetryCounts.get(key)}`;
      if (event.kind === "open" && (event.outcome === "title" || event.outcome === "fallback")) logger.info(line);
      else logger.warn(line);
      return true;
    },
  };
}
