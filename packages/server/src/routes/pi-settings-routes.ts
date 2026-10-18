/**
 * REST routes for pi's global `settings.json` editor (pi-agent-settings-editor).
 *
 *   GET  /api/pi-settings                → { settings, raw, etag, parseError? }
 *   PUT  /api/pi-settings                → typed leaf patch (merge-preserving)
 *   PUT  /api/pi-settings/raw            → whole-file raw write (256 KiB cap)
 *   POST /api/pi-settings/sync-defaults  → mirror the dashboard default
 *                                          model/thinking level into pi (drift repair)
 *   POST /api/pi-settings/legacy-credentials → move/remove plain-text API keys
 *                                          (settings.json → auth.json); key paths in,
 *                                          masked list out — never a value
 *
 * Status map: 200 ok · 400 invalid/unparseable · 409 stale token (body carries
 * the current state) · 413 body too large · 503 lock busy. Typed/raw writes
 * reload every connected session on success only; sync-defaults never does
 * (defaults are read only at session construction). The parsed `settings` field of
 * every response omits legacy API-key values (the masked `legacyCredentials` list
 * and the stored `raw` text are the only carriers). All routes sit behind the
 * shared network guard, like `/api/config` and `/api/pi-retry`. Logs carry the
 * outcome and reload count only — never settings values.
 *
 * See change: edit-pi-agent-settings (design D1–D7).
 */
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type {
  PiLegacyCredentialsRequest,
  PiLegacyCredentialsResponse,
  PiSettingsConflict,
  PiSettingsReadResponse,
  PiSettingsSyncResponse,
  PiSettingsWriteResponse,
  PutPiSettingsRawRequest,
  PutPiSettingsRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applyLegacyCredentialActions,
  detectLegacyCredentials,
  type LegacyAction,
  readAuthSnapshotUnlocked,
  withoutLegacyValues,
} from "../auth/pi-legacy-credentials.js";
import { scanPiResources } from "../pi/pi-resource-scanner.js";
import {
  applyPiSettingsPatch,
  type DashboardDefaults,
  type FsDeps,
  mirrorDefaultsToPi,
  type PiSettingsWriteResult,
  readPiSettings,
  writePiSettingsRaw,
} from "../pi-agent-settings.js";
import { listPiThemes, type ScanThemes } from "../pi-settings-themes.js";
import type { NetworkGuard } from "./route-deps.js";

/** Request-body cap for the raw editor (design D6). */
export const PI_SETTINGS_RAW_BODY_LIMIT = 256 * 1024;

const ERROR_STATUS = { invalid: 400, parse: 400, stale: 409, busy: 503, io: 500 } as const;

type LegacyFailure = Exclude<Awaited<ReturnType<typeof applyLegacyCredentialActions>>, { ok: true }>;

/** HTTP status + body of a failed legacy-credentials request. No value ever appears in either. */
function legacyFailure(r: LegacyFailure): { status: number; body: Record<string, unknown> } {
  switch (r.error) {
    case "stale":
      return {
        status: 409,
        body: {
          success: false,
          error: "stale",
          etag: r.state.etag,
          settings: withoutLegacyValues(r.state.settings),
          raw: r.state.raw,
          legacyCredentials: r.legacy,
        },
      };
    case "invalid":
      return { status: 400, body: { success: false, error: r.message, legacyCredentials: r.legacy } };
    case "conflict":
      return { status: 409, body: { success: false, error: r.message, legacyCredentials: r.legacy } };
    case "parse":
      return { status: 400, body: { success: false, error: r.parseError, parseError: r.parseError } };
    case "busy":
      return { status: 503, body: { success: false, error: "busy" } };
    case "io":
      return { status: 500, body: { success: false, error: r.message, ...(r.legacy ? { legacyCredentials: r.legacy } : {}) } };
  }
}

const isLegacyAction = (a: unknown): boolean =>
  typeof a === "object" &&
  a !== null &&
  typeof (a as LegacyAction).key === "string" &&
  ((a as LegacyAction).action === "move" || (a as LegacyAction).action === "remove");

export function registerPiSettingsRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    /** Reload every connected session; returns how many were signalled. */
    reloadConnectedSessions: () => number;
    /** Persisted dashboard defaults (read inside the lock by the mirror). */
    readDashboardConfig: () => DashboardDefaults;
    /** Test seam: agent dir / fs overrides. */
    fsDeps?: FsDeps;
    /** Test seam: theme resource scanner (default: pi's resolver, global + package themes). */
    scanThemes?: ScanThemes;
  },
) {
  const { networkGuard, reloadConnectedSessions, readDashboardConfig, fsDeps } = deps;
  const scanThemes: ScanThemes =
    deps.scanThemes ??
    (() => {
      // GLOBAL file only: the agent dir is BOTH the scan root (no project `.pi/settings.json`
      // to pull local packages in) and `globalDir` (else the scanner defaults to `~/.pi/agent`
      // and ignores `PI_CODING_AGENT_DIR`).
      const globalDir = resolvePiAgentDir({ homedir: fsDeps?.home, agentDirEnv: fsDeps?.agentDirEnv });
      return scanPiResources(globalDir, { globalDir });
    });

  const logWrite = (route: string, outcome: string, reloaded?: number) => {
    console.log(`[pi-settings] ${route} ${outcome}${reloaded !== undefined ? ` reloaded=${reloaded}` : ""}`);
  };

  /** Map a non-ok write result to its HTTP reply. */
  const reject = (route: string, reply: FastifyReply, r: Exclude<PiSettingsWriteResult, { ok: true }>) => {
    logWrite(route, r.error === "invalid" ? "invalid" : r.error);
    reply.code(ERROR_STATUS[r.error]);
    if (r.error === "stale") {
      return {
        success: false,
        error: "stale",
        etag: r.state.etag,
        settings: withoutLegacyValues(r.state.settings),
        raw: r.state.raw,
      } satisfies PiSettingsConflict;
    }
    if (r.error === "invalid") {
      return {
        success: false,
        error: r.errors.map((e) => e.message).join("; "),
        errors: r.errors,
      };
    }
    if (r.error === "parse") return { success: false, error: r.parseError, parseError: r.parseError };
    if (r.error === "busy") return { success: false, error: "busy" };
    return { success: false, error: r.message };
  };

  const ok = (route: string, r: Extract<PiSettingsWriteResult, { ok: true }>): PiSettingsWriteResponse => {
    // Apply to running sessions only after a successful write.
    const reloadedSessions = reloadConnectedSessions();
    logWrite(route, "ok", reloadedSessions);
    return {
      success: true,
      settings: withoutLegacyValues(r.state.settings),
      raw: r.state.raw,
      etag: r.state.etag,
      reloadedSessions,
      legacyCredentials: detectLegacyCredentials(r.state.settings, readAuthSnapshotUnlocked()),
      ...(r.restoredKeys ? { restoredKeys: r.restoredKeys } : {}),
    };
  };

  fastify.get("/api/pi-settings", { preHandler: networkGuard }, async (): Promise<PiSettingsReadResponse> => {
    const s = readPiSettings(fsDeps);
    return {
      success: true,
      settings: withoutLegacyValues(s.settings),
      raw: s.raw,
      etag: s.etag,
      ...(s.parseError ? { parseError: s.parseError } : {}),
      themes: await listPiThemes(scanThemes),
      legacyCredentials: detectLegacyCredentials(s.settings, readAuthSnapshotUnlocked()),
    };
  });

  fastify.put<{ Body: PutPiSettingsRequest }>(
    "/api/pi-settings",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { patch, baseEtag } = request.body ?? ({} as Partial<PutPiSettingsRequest>);
      if (typeof baseEtag !== "string") {
        return reply.code(400).send({ success: false, error: "baseEtag is required" });
      }
      const r = await applyPiSettingsPatch(patch, baseEtag, fsDeps);
      return r.ok ? ok("typed", r) : reject("typed", reply, r);
    },
  );

  fastify.put<{ Body: PutPiSettingsRawRequest }>(
    "/api/pi-settings/raw",
    {
      preHandler: networkGuard,
      bodyLimit: PI_SETTINGS_RAW_BODY_LIMIT,
      // A body over the cap arrives as a framework error; answer in the
      // standard `{ success:false, error }` envelope.
      errorHandler: (err, _request, reply) => {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        if (status === 413) logWrite("raw", "too-large");
        return reply.code(status).send({ success: false, error: status === 413 ? "Request body too large" : err.message });
      },
    },
    async (request, reply) => {
      const { raw, baseEtag } = request.body ?? ({} as Partial<PutPiSettingsRawRequest>);
      if (typeof baseEtag !== "string") {
        return reply.code(400).send({ success: false, error: "baseEtag is required" });
      }
      const r = await writePiSettingsRaw(raw, baseEtag, fsDeps);
      return r.ok ? ok("raw", r) : reject("raw", reply, r);
    },
  );

  fastify.post("/api/pi-settings/sync-defaults", { preHandler: networkGuard }, async (_request, reply) => {
    const mirror = await mirrorDefaultsToPi(readDashboardConfig, ["defaultModel", "defaultThinkingLevel"], fsDeps);
    if (!mirror.ok) {
      logWrite("sync-defaults", mirror.error ?? "io");
      reply.code(ERROR_STATUS[mirror.error ?? "io"]);
      return { success: false, error: mirror.error ?? "io" };
    }
    logWrite("sync-defaults", "ok");
    const s = readPiSettings(fsDeps);
    return {
      success: true,
      piMirror: mirror,
      settings: withoutLegacyValues(s.settings),
      raw: s.raw,
      etag: s.etag,
    } satisfies PiSettingsSyncResponse;
  });

  fastify.post<{ Body: PiLegacyCredentialsRequest }>(
    "/api/pi-settings/legacy-credentials",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { baseEtag, actions } = request.body ?? ({} as Partial<PiLegacyCredentialsRequest>);
      if (typeof baseEtag !== "string") return reply.code(400).send({ success: false, error: "baseEtag is required" });
      if (!Array.isArray(actions) || actions.length === 0 || !actions.every(isLegacyAction)) {
        return reply.code(400).send({ success: false, error: "actions must be a non-empty list of { key, action: move|remove }" });
      }
      const r = await applyLegacyCredentialActions(actions as LegacyAction[], baseEtag, fsDeps);
      if (r.ok) {
        const reloadedSessions = reloadConnectedSessions();
        logWrite("legacy-credentials", "ok", reloadedSessions);
        return {
          success: true,
          settings: withoutLegacyValues(r.state.settings),
          raw: r.state.raw,
          etag: r.state.etag,
          reloadedSessions,
          legacyCredentials: r.legacy,
        } satisfies PiLegacyCredentialsResponse;
      }
      logWrite("legacy-credentials", r.error);
      const failure = legacyFailure(r);
      return reply.code(failure.status).send(failure.body);
    },
  );
}
