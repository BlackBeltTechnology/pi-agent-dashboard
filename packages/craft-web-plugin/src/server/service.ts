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
import { CLAIMED_APPS, CRAFT_WEB_APPS, isClaimedApp } from "./apps.js";
import { appChannel, appEnabled, type CraftWebConfig } from "./config.js";
import { createPostInstall, readBuildInfo } from "./post-install.js";
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

const CSP_WINDOW_MS = 60_000;
const CSP_MAX_PER_WINDOW = 30;

export interface CraftWebService {
  status(): CraftWebStatus;
  prepare(app: string): Promise<PrepareOutcome>;
  /** `false` when rate-limited (nothing counted or logged). */
  reportCsp(app: string, directive: string): boolean;
}

export function createCraftWebService(deps: CraftWebServiceDeps): CraftWebService {
  const { logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const shimVersion = deps.shimVersion ?? createShimVersionReader();
  const postInstall = deps.postInstall ?? createPostInstall();
  const env = (): NodeJS.ProcessEnv => deps.provisionDeps?.env ?? process.env;
  const currentDir = (app: string): string => path.join(deps.dataDir, `${app}-web`, "current");
  const lookupLatest = deps.latestWebVersion ?? latestWebVersion;
  const refreshing = new Set<string>();

  /** Env `<APP>_WEB_VERSION=latest` wins over config; an explicit env pin/dir is handled by `registryPin`. */
  const channelOf = (app: string): WebChannel =>
    env()[`${envPrefix(getApp(app))}_WEB_VERSION`]?.trim().toLowerCase() === "latest" ? "latest" : appChannel(deps.getConfig(), app);

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
    if (build.shimVersion !== shimVersion()) return fail("shim-outdated", prepared);
    if (want !== undefined && build.version !== want && !keepPrepared) return fail("not-prepared", { ...prepared, version: want, sizeGzip: base.sizeGzip });
    return { ...base, ...prepared, status: "ok" };
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
      const t = now();
      const w = cspWindow.get(app);
      const win = !w || t - w.start >= CSP_WINDOW_MS ? { start: t, n: 0, warned: false } : w;
      cspWindow.set(app, win);
      if (win.n >= CSP_MAX_PER_WINDOW) {
        if (!win.warned) {
          win.warned = true;
          logger.warn(`csp-report ${app}: rate limit reached (${CSP_MAX_PER_WINDOW}/min); dropping further reports`);
        }
        return false;
      }
      win.n++;
      cspCounts.set(app, (cspCounts.get(app) ?? 0) + 1);
      logger.warn(`csp-report ${app} directive=${directive} total=${cspCounts.get(app)}`);
      return true;
    },
  };
}
