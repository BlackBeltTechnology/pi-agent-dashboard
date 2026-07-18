/**
 * Shared configuration module for PI Dashboard.
 * Used by both the server CLI and bridge extension.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WindowsGitSourceSetting } from "./platform/select-git-source.js";
import {
  providerSupportsMode,
  type TunnelMode,
  type TunnelProviderId,
} from "./tunnel-provider.js";

export type { WindowsGitSourceSetting } from "./platform/select-git-source.js";

export const CONFIG_DIR = path.join(os.homedir(), ".pi", "dashboard");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export type SpawnStrategy = "tmux" | "headless";

/**
 * Policy applied when a bridge re-registers a session after a dashboard
 * restart (i.e. the `session_register` carries `registerReason: "reattach"`).
 *
 * - `"always"` (default) — unconditionally move the session to the front
 *   of `sessionOrder` for its cwd.
 * - `"streaming-only"` — only move-to-front when the session's status is
 *   currently `"streaming"`.
 * - `"preserve"` — leave `sessionOrder` untouched (legacy behavior).
 *
 * See change: reattach-move-to-front.
 */
export type ReattachPlacement = "preserve" | "streaming-only" | "always";

const VALID_REATTACH_PLACEMENTS: ReattachPlacement[] = [
  "preserve",
  "streaming-only",
  "always",
];

export const DEFAULT_REATTACH_PLACEMENT: ReattachPlacement = "always";

/**
 * Cold-start behavior when sessions were interrupted by an unclean host
 * shutdown. `off` — classify but never surface. `ask` — broadcast one
 * recovery offer (default). `auto` — resume all candidates without prompting.
 * See change: reopen-sessions-after-shutdown.
 */
export type ReopenSessionsAfterShutdown = "off" | "ask" | "auto";
const VALID_REOPEN_MODES: ReopenSessionsAfterShutdown[] = ["off", "ask", "auto"];
export const DEFAULT_REOPEN_SESSIONS_AFTER_SHUTDOWN: ReopenSessionsAfterShutdown = "ask";
export function parseReopenSessionsAfterShutdown(raw: unknown): ReopenSessionsAfterShutdown {
  return VALID_REOPEN_MODES.includes(raw as ReopenSessionsAfterShutdown)
    ? (raw as ReopenSessionsAfterShutdown)
    : DEFAULT_REOPEN_SESSIONS_AFTER_SHUTDOWN;
}

/**
 * Validate a raw value against the {@link ReattachPlacement} union.
 * Anything outside the union (including `undefined`, numbers, objects)
 * falls back to {@link DEFAULT_REATTACH_PLACEMENT}.
 */
export function parseReattachPlacement(raw: unknown): ReattachPlacement {
  return typeof raw === "string" && (VALID_REATTACH_PLACEMENTS as string[]).includes(raw)
    ? (raw as ReattachPlacement)
    : DEFAULT_REATTACH_PLACEMENT;
}

export interface AuthProviderConfig {
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
  name?: string;
}

export interface AuthConfig {
  secret: string;
  providers: Record<string, AuthProviderConfig>;
  allowedUsers?: string[];
  bypassUrls?: string[];
  bypassHosts?: string[];
  /** Admin email override — can list/revoke every user's proxy API keys. */
  admin?: string;
}

export interface MemoryLimitsConfig {
  /** Max events stored per session (0 = unlimited). Default: 200 */
  maxEventsPerSession: number;
  /** Max chars before truncating string fields in events (0 = no truncation). Default: 0 (disabled) */
  maxStringFieldSize: number;
  /** Max bytes in browser WebSocket send buffer before dropping messages (0 = no limit). Default: 4194304 (4MB) */
  maxWsBufferBytes: number;
}

export const DEFAULT_MEMORY_LIMITS: MemoryLimitsConfig = {
  // 20000 (was 5000): subagent-heavy turns forward thousands of inner events
  // into the parent buffer; the old cap trimmed the chat head.
  // See change: preserve-chat-head-on-event-trim.
  maxEventsPerSession: 20000,
  maxStringFieldSize: 0,
  maxWsBufferBytes: 4 * 1024 * 1024,
};

export interface OpenSpecPollConfig {
  /**
   * Master gate. When `false`, the dashboard treats OpenSpec as fully disabled
   * across the dashboard — no polling, the OPENSPEC session-card subcard hides
   * everywhere, and `openspec_refresh` is a no-op. Other tuning fields below
   * retain their meaning but are ignored at runtime when this is `false`.
   *
   * Default `true` for backwards compatibility. Existing configs without this
   * field behave exactly as before. See change: auto-hide-empty-session-subcards.
   */
  enabled: boolean;
  /** Poll interval in seconds. Default 60. Clamped to [5, 3600]. */
  pollIntervalSeconds: number;
  /** Max concurrent `openspec` CLI invocations across all dirs. Default 3. Clamped to [1, 16]. */
  maxConcurrentSpawns: number;
  /** `"mtime"` skips re-polling unchanged changes; `"always"` polls unconditionally. Default `"mtime"`. */
  changeDetection: "mtime" | "always";
  /** Max per-directory phase jitter in seconds. 0 disables jitter. Default 5. Clamped to [0, 60]. */
  jitterSeconds: number;
  /**
   * When `true` (the default) the periodic / gated poll path runs per-change
   * artifact derivation and payload serialization in a `worker_threads`
   * worker, off the main event loop. When `false`, derivation runs in-process
   * exactly as on the pre-worker path — used as a permanent escape hatch for
   * environments where `worker_threads` is unavailable (e.g. constrained
   * bundles). The in-process fallback also activates automatically on worker
   * spawn/crash/timeout regardless of this flag. See change:
   * offload-openspec-poll-to-worker.
   */
  useWorker: boolean;
}

export const DEFAULT_OPENSPEC_POLL: OpenSpecPollConfig = {
  enabled: true,
  // 60s baseline: even after local derivation kills the per-change spawn
  // storm, a larger interval reduces churn for large change sets.
  // See change: optimize-openspec-poll-derive-artifacts-locally.
  pollIntervalSeconds: 60,
  maxConcurrentSpawns: 3,
  changeDetection: "mtime",
  useWorker: true,
  jitterSeconds: 5,
};

export interface SessionsConfig {
  /**
   * When `true` (the default) session-event hydration (JSONL parse + replay)
   * runs in a `worker_threads` worker, off the main event loop. When `false`,
   * hydration runs in-process exactly as on the pre-worker path — a permanent
   * escape hatch for environments where `worker_threads` is unavailable. The
   * in-process fallback also activates automatically on worker
   * spawn/crash/timeout regardless of this flag. See change:
   * offload-session-events-load-to-worker.
   */
  useLoadWorker: boolean;
}

export const DEFAULT_SESSIONS: SessionsConfig = {
  useLoadWorker: true,
};

export interface KeeperLogConfig {
  /**
   * When `true`, per-session keepers archive pi's stdout/stderr (including full
   * model API frames) into `keeper-<sessionId>.log`. When `false` (the default),
   * pi's stdout/stderr are discarded; the keeper still writes its own lifecycle
   * log lines. Debug-only — capture grows unbounded on disk.
   * See change: add-keeper-output-capture-toggle.
   */
  capturePiOutput: boolean;
}

export const DEFAULT_KEEPER_LOG: KeeperLogConfig = {
  capturePiOutput: false,
};

export interface KnownServer {
  host: string;
  port: number;
  label?: string;
  addedAt: string; // ISO timestamp
}

// ── Model Proxy ─────────────────────────────────────────────────────

export interface ProxyApiKey {
  id: string;
  label: string;
  createdBy?: string;
  scopes?: string[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  hash: string;
}

export interface ModelProxyConfig {
  /** Master toggle. Default true. */
  enabled: boolean;
  /** Default model for requests that omit it. */
  defaultModel?: string;
  /**
   * Ordered list of fully-qualified `provider/id`s. The first *available*
   * entry is used when a request omits `model` or names an unresolved model.
   * Supersedes `defaultModel` when both are set and an entry is available.
   * See change: fix-and-prefer-model-proxy-resolution.
   */
  preferredModels?: string[];
  /**
   * Alias → fully-qualified `provider/id`, expanded (exact key match) before
   * parsing. Lets a caller send `claude` and route to `anthropic/claude-3.5-sonnet`.
   * See change: fix-and-prefer-model-proxy-resolution.
   */
  modelAliases?: Record<string, string>;
  /** Optional second port for /v1/* routes (for SDKs that hardcode path-prefix-less base URLs). */
  secondPort?: number;
  /** Server-wide max concurrent streams. Default 16. Clamped [1, 256]. */
  maxConcurrentStreams: number;
  /** Per-API-key max concurrent streams. Default 4. Clamped [1, 64]. */
  perKeyConcurrentStreams: number;
  /** Per-provider concurrency caps. Keys are provider names. */
  perProviderCaps?: Record<string, number>;
  /** Enable JSONL request logging. Default false. */
  logRequests: boolean;
  /** Proxy API keys (stored hashed). */
  apiKeys: ProxyApiKey[];
}

export const DEFAULT_MODEL_PROXY: ModelProxyConfig = {
  enabled: true,
  maxConcurrentStreams: 16,
  perKeyConcurrentStreams: 4,
  logRequests: false,
  apiKeys: [],
};

/**
 * Plugin-specific config namespace.
 * Lives at ~/.pi/dashboard/config.json#plugins.<id>.*
 */
export type PluginsConfig = Record<string, Record<string, unknown>>;

export interface DashboardConfig {
  port: number;
  piPort: number;
  /**
   * Host/interface the HTTP server and pi gateway bind to.
   * Resolution chain (CLI `--host` → `PI_DASHBOARD_HOST` → this field →
   * default) mirrors `port`. Default `"127.0.0.1"` (loopback only).
   * The model-proxy second port stays hardcoded loopback regardless.
   * See change: configurable-bind-host.
   */
  bindHost: string;
  autoStart: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  spawnStrategy: SpawnStrategy;
  tunnel: {
    enabled: boolean;
    /**
     * Which provider backs the tunnel. Required (non-undefined) once a
     * post-migration config is written; a legacy config with only
     * `reservedToken` is normalized to `provider: "zrok"` at read time.
     */
    provider?: TunnelProviderId;
    /** public reverse-proxy vs private mesh. Required when enabled + provider set. */
    mode?: TunnelMode;
    /**
     * Legacy top-level zrok reserved token. Preserved on read for downgrade
     * safety; the normalized shape also carries it under `zrok.reservedToken`.
     */
    reservedToken?: string;
    /**
     * zrok sub-config. `reservedToken` is the legacy v1 token (preserved for
     * downgrade, ignored by the v2 provider). `reservedName` is the v2 reserved
     * name (namespaces+names) yielding a stable `<name>.shares.zrok.io` URL;
     * `persistent` (default false) opts in to minting/serving a reserved name.
     * See change: support-zrok-v2.
     */
    zrok?: { reservedToken?: string; reservedName?: string; persistent?: boolean };
    ngrok?: { authtoken?: string; domain?: string };
    tailscale?: { authKey?: string };
    zerotier?: { networkId?: string };
    watchdog?: {
      enabled: boolean;
      intervalMs: number;
      failureThreshold: number;
      probeTimeoutMs: number;
    };
  };
  devBuildOnReload: boolean;
  auth?: AuthConfig;
  defaultModel: string;
  memoryLimits: MemoryLimitsConfig;
  /** OpenSpec background polling behavior (interval, concurrency, change detection, jitter) */
  openspec: OpenSpecPollConfig;
  /** Session behavior — hydration worker offload toggle. */
  sessions: SessionsConfig;
  /** Keeper log behavior — gates capture of pi stdout/stderr into keeper-<id>.log. */
  keeperLog: KeeperLogConfig;
  /**
   * Timeout for ask_user prompts in seconds.
   * Default: 300 (5 minutes).
   * Set to -1 (or any value <= 0) for no timeout (waits indefinitely).
   * If the key is absent from config.json the default of 300 s applies.
   */
  askUserPromptTimeoutSeconds: number;
  /** Networks trusted for full access without authentication (CIDR, wildcard, exact IP) */
  trustedNetworks: string[];
  /** Merged trustedNetworks + auth.bypassHosts (deduplicated). Computed at load time. */
  resolvedTrustedNetworks: string[];
  /** CORS allowed origins for cross-origin client hosting */
  cors: CorsConfig;
  /** Device-pairing configuration (server keypair identity + QR pairing). */
  pairing: PairingConfig;
  /** Last-used server address (host:port) for reconnection */
  lastServer?: string;
  /**
   * Display name shown as the PWA app label when installed on a home screen
   * or app drawer. Used as the `<source>` segment of the dynamic
   * `/manifest.json` `name` field: `"Pi-Dash · <source>"`. Trimmed; blank /
   * whitespace-only values are treated as unset and the server falls back to
   * the request `Host` header (port stripped) → `os.hostname()` → literal
   * `"Pi-Dash"`. See change: add-dynamic-pwa-manifest-naming.
   */
  dashboardName?: string;
  /** Whether the server was launched by the Electron app */
  electronMode: boolean;
  /**
   * Policy applied when the bridge reattaches after a dashboard restart.
   * See {@link ReattachPlacement}. Default `"always"`.
   * See change: reattach-move-to-front.
   */
  reattachPlacement: ReattachPlacement;
  /**
   * Cold-start recovery behavior for sessions interrupted by an unclean
   * host shutdown. Gates the final offer step only. Default `"ask"`.
   * See change: reopen-sessions-after-shutdown.
   */
  reopenSessionsAfterShutdown: ReopenSessionsAfterShutdown;
  /**
   * When true, a session whose turn completes (`agent_end` while still
   * alive) or which transitions alive→ended is moved to the front of its
   * tier (top of active, resp. top of ended). Default `false` (keep slot).
   * See change: simplify-session-card-ordering.
   */
  completedFirst: boolean;
  /**
   * When true, an alive session issuing an `ask_user` request is moved to
   * the front of the active tier. Default `false`.
   * See change: simplify-session-card-ordering.
   */
  questionFirst: boolean;
  /** Persisted list of known remote servers */
  knownServers: KnownServer[];
  /**
   * How long (ms) to wait for a spawned pi session to send `session_register`
   * before emitting a timeout warning. Default 30000 (30s). Clamped [5000, 120000].
   * See change: spawn-failure-diagnostics.
   */
  spawnRegisterTimeoutMs: number;
  /**
   * UI preference: show worktree spawn buttons (folder `+Worktree` and the
   * per-change `⑂+` on OpenSpec rows). Default `true`. Preference-only —
   * does NOT disable the `/api/git/worktree*` REST endpoints.
   * See change: openspec-worktree-spawn-button.
   */
  gitWorktreeEnabled: boolean;
  /**
   * Windows-only: where git + the POSIX shell come from.
   *   "auto"    — host when git+bash on PATH, else bundled (default).
   *   "host"    — host tools only (Doctor errors if absent).
   *   "bundled" — always the bundled dugite-native git/sh.
   * No-op on macOS/Linux. See change: embed-git-bash-on-windows.
   */
  windowsGitSource: WindowsGitSourceSetting;
  /**
   * Per-plugin config namespaces. Reserved top-level key.
   * Each plugin's config lives at plugins.<id>.*
   * Plugin-shaped legacy top-level keys (e.g. openspec.*) stay at top-level
   * until each extract-*-as-plugin change migrates them.
   */
  plugins: PluginsConfig;
  /** Model proxy configuration (OpenAI/Anthropic-compatible /v1/* endpoints). */
  modelProxy: ModelProxyConfig;
  /**
   * Operator override for the pi sessions root the dashboard scans. When set
   * (non-blank), it is the highest-precedence input to
   * {@link resolvePiSessionsDir} — above `PI_CODING_AGENT_SESSION_DIR` and
   * pi-core's `getAgentDir()/sessions`. Absent / blank → fall through to those
   * lower layers. Leading `~/` expands against `$HOME`.
   * See change: configurable-pi-sessions-dir.
   */
  piSessionsDir?: string;
}

export interface CorsConfig {
  /** Additional origins allowed for cross-origin requests */
  allowedOrigins: string[];
}

/** Device-pairing configuration (server keypair identity + QR pairing). */
export interface PairingConfig {
  /**
   * Operator-designated, publicly-trusted TLS base URLs (e.g.
   * `https://pi.example.com`) advertised in the pairing payload's `urls[]`.
   * D14: only publicly-trusted TLS is reachable from the neutral HTTPS shell;
   * self-signed LAN addresses MUST NOT be listed here. The active zrok tunnel
   * (publicly trusted by construction) is added automatically and need not be
   * configured. Empty by default.
   */
  publicBaseUrls: string[];
}

const VALID_SPAWN_STRATEGIES: SpawnStrategy[] = ["tmux", "headless"];

/** Default ask_user prompt timeout: 300 seconds (5 minutes). */
export const DEFAULT_ASK_USER_PROMPT_TIMEOUT_SECONDS = 300;

/** Default + clamp for spawnRegisterTimeoutMs. See change: spawn-failure-diagnostics. */
export const DEFAULT_SPAWN_REGISTER_TIMEOUT_MS = 30000;
export function clampSpawnRegisterTimeoutMs(v: unknown): number {
  if (typeof v !== "number" || isNaN(v)) return DEFAULT_SPAWN_REGISTER_TIMEOUT_MS;
  return Math.max(5000, Math.min(120000, v));
}

const DEFAULTS: DashboardConfig = {
  plugins: {},
  modelProxy: { ...DEFAULT_MODEL_PROXY },
  port: 8000,
  piPort: 9999,
  bindHost: "127.0.0.1",
  autoStart: true,
  autoShutdown: false,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: {
    enabled: true,
    zrok: { persistent: false },
    watchdog: {
      enabled: true,
      intervalMs: 60000,
      failureThreshold: 2,
      probeTimeoutMs: 10000,
    },
  },
  devBuildOnReload: false,
  defaultModel: "",
  memoryLimits: { ...DEFAULT_MEMORY_LIMITS },
  openspec: { ...DEFAULT_OPENSPEC_POLL },
  sessions: { ...DEFAULT_SESSIONS },
  keeperLog: { ...DEFAULT_KEEPER_LOG },
  trustedNetworks: [],
  resolvedTrustedNetworks: [],
  cors: { allowedOrigins: [] },
  pairing: { publicBaseUrls: [] },
  electronMode: false,
  knownServers: [],
  askUserPromptTimeoutSeconds: DEFAULT_ASK_USER_PROMPT_TIMEOUT_SECONDS,
  reattachPlacement: DEFAULT_REATTACH_PLACEMENT,
  reopenSessionsAfterShutdown: DEFAULT_REOPEN_SESSIONS_AFTER_SHUTDOWN,
  completedFirst: false,
  questionFirst: false,
  spawnRegisterTimeoutMs: 30000,
  gitWorktreeEnabled: true,
  windowsGitSource: "auto",
};

/**
 * Parse and validate the auth config section.
 *
 * Returns undefined ONLY when nothing auth-relevant is configured — that is,
 * when none of `providers`, `bypassHosts`, or `bypassUrls` has any content.
 *
 * When providers is empty but bypassHosts or bypassUrls is populated, this
 * function returns a valid AuthConfig with an empty providers map. The auth
 * plugin already no-ops in that case (providerRegistry.size === 0 → skip
 * OAuth route + cookie plugin registration), so no OAuth flow activates
 * accidentally. But returning an object here lets the caller populate
 * resolvedTrustedNetworks from auth.bypassHosts — which is the entire
 * point of allowing this shape. Before this change, parseAuthConfig
 * returned undefined on empty-providers, which nuked auth.bypassHosts
 * before the resolvedTrustedNetworks merge could read it, and users
 * without OAuth lost remote network access after the UI started writing
 * to auth.bypassHosts. See openspec/changes/fix-trusted-networks-no-oauth.
 */
function parseAuthConfig(raw: any): AuthConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const providers = raw.providers;
  const hasProviders =
    providers && typeof providers === "object" && Object.keys(providers).length > 0;
  const hasHosts = Array.isArray(raw.bypassHosts) && raw.bypassHosts.length > 0;
  const hasUrls = Array.isArray(raw.bypassUrls) && raw.bypassUrls.length > 0;
  if (!hasProviders && !hasHosts && !hasUrls) return undefined;

  // Validate each provider has at least clientId and clientSecret.
  // validProviders may end up empty when providers is {} or all entries
  // are malformed — that's fine, the caller tolerates it as long as
  // bypassHosts or bypassUrls carries the auth-relevant content.
  const validProviders: Record<string, AuthProviderConfig> = {};
  if (hasProviders) {
    for (const [key, value] of Object.entries(providers as Record<string, unknown>)) {
      const p = value as any;
      if (p && typeof p === "object" && p.clientId && p.clientSecret) {
        validProviders[key] = {
          clientId: p.clientId,
          clientSecret: p.clientSecret,
          ...(p.issuerUrl ? { issuerUrl: p.issuerUrl } : {}),
          ...(p.name ? { name: p.name } : {}),
        };
      }
    }
  }

  // If providers was declared but all entries are malformed AND there is no
  // bypass content, fall back to undefined — same "nothing auth-relevant"
  // rule as the top-level gate.
  if (Object.keys(validProviders).length === 0 && !hasHosts && !hasUrls) {
    return undefined;
  }

  return {
    secret: raw.secret ?? "",
    providers: validProviders,
    ...(Array.isArray(raw.allowedUsers) ? { allowedUsers: raw.allowedUsers } : Array.isArray(raw.allowedEmails) ? { allowedUsers: raw.allowedEmails } : {}),
    bypassUrls: Array.isArray(raw.bypassUrls) ? raw.bypassUrls.filter((u: unknown) => typeof u === "string") : [],
    bypassHosts: Array.isArray(raw.bypassHosts) ? raw.bypassHosts.filter((u: unknown) => typeof u === "string") : [],
    ...(typeof raw.admin === "string" && raw.admin ? { admin: raw.admin } : {}),
  };
}

function clampNumber(raw: any, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseSessionsConfig(raw: any): SessionsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SESSIONS };
  return {
    useLoadWorker:
      typeof raw.useLoadWorker === "boolean" ? raw.useLoadWorker : DEFAULT_SESSIONS.useLoadWorker,
  };
}

function parseOpenSpecPollConfig(raw: any): OpenSpecPollConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_OPENSPEC_POLL };
  const changeDetection =
    raw.changeDetection === "always" || raw.changeDetection === "mtime"
      ? raw.changeDetection
      : DEFAULT_OPENSPEC_POLL.changeDetection;
  return {
    enabled:
      typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_OPENSPEC_POLL.enabled,
    pollIntervalSeconds: clampNumber(raw.pollIntervalSeconds, DEFAULT_OPENSPEC_POLL.pollIntervalSeconds, 5, 3600),
    maxConcurrentSpawns: clampNumber(raw.maxConcurrentSpawns, DEFAULT_OPENSPEC_POLL.maxConcurrentSpawns, 1, 16),
    changeDetection,
    jitterSeconds: clampNumber(raw.jitterSeconds, DEFAULT_OPENSPEC_POLL.jitterSeconds, 0, 60),
    useWorker:
      typeof raw.useWorker === "boolean" ? raw.useWorker : DEFAULT_OPENSPEC_POLL.useWorker,
  };
}

function parseKeeperLogConfig(raw: any): KeeperLogConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_KEEPER_LOG };
  return {
    capturePiOutput:
      typeof raw.capturePiOutput === "boolean"
        ? raw.capturePiOutput
        : DEFAULT_KEEPER_LOG.capturePiOutput,
  };
}

function parseMemoryLimits(raw: any): MemoryLimitsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MEMORY_LIMITS };
  return {
    maxEventsPerSession: typeof raw.maxEventsPerSession === "number" ? raw.maxEventsPerSession : DEFAULT_MEMORY_LIMITS.maxEventsPerSession,
    maxStringFieldSize: typeof raw.maxStringFieldSize === "number" ? raw.maxStringFieldSize : DEFAULT_MEMORY_LIMITS.maxStringFieldSize,
    maxWsBufferBytes: typeof raw.maxWsBufferBytes === "number" ? raw.maxWsBufferBytes : DEFAULT_MEMORY_LIMITS.maxWsBufferBytes,
  };
}

function parsePluginsConfig(raw: unknown): PluginsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: PluginsConfig = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      result[id] = val as Record<string, unknown>;
    }
  }
  return result;
}

/**
 * Get the plugins config block from a loaded DashboardConfig.
 * Provides typed access to plugins.<id>.* namespaces.
 */
export function getPluginsConfig(config: DashboardConfig): PluginsConfig {
  return config.plugins ?? {};
}

/**
 * Get a single plugin's config from a loaded DashboardConfig.
 * Returns {} if the plugin has no stored config.
 */
export function getPluginConfig(
  config: DashboardConfig,
  pluginId: string,
): Record<string, unknown> {
  return config.plugins?.[pluginId] ?? {};
}

export function parseModelProxyConfig(raw: any): ModelProxyConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODEL_PROXY };

  const apiKeys: ProxyApiKey[] = [];
  if (Array.isArray(raw.apiKeys)) {
    for (const entry of raw.apiKeys) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.label === "string" &&
        typeof entry.hash === "string" &&
        typeof entry.createdAt === "number"
      ) {
        apiKeys.push({
          id: entry.id,
          label: entry.label,
          hash: entry.hash,
          createdAt: entry.createdAt,
          ...(typeof entry.createdBy === "string" ? { createdBy: entry.createdBy } : {}),
          ...(Array.isArray(entry.scopes) ? { scopes: entry.scopes.filter((s: unknown) => typeof s === "string") } : {}),
          ...(typeof entry.lastUsedAt === "number" ? { lastUsedAt: entry.lastUsedAt } : {}),
          ...(typeof entry.expiresAt === "number" ? { expiresAt: entry.expiresAt } : {}),
          ...(typeof entry.revokedAt === "number" ? { revokedAt: entry.revokedAt } : {}),
        });
      }
    }
  }

  const preferredModels: string[] = Array.isArray(raw.preferredModels)
    ? raw.preferredModels.filter((s: unknown) => typeof s === "string" && s.length > 0)
    : [];

  let modelAliases: Record<string, string> | undefined;
  if (raw.modelAliases && typeof raw.modelAliases === "object" && !Array.isArray(raw.modelAliases)) {
    modelAliases = {};
    for (const [key, val] of Object.entries(raw.modelAliases)) {
      if (typeof key === "string" && key.length > 0 && typeof val === "string" && val.length > 0) {
        modelAliases[key] = val;
      }
    }
  }

  let perProviderCaps: Record<string, number> | undefined;
  if (raw.perProviderCaps && typeof raw.perProviderCaps === "object" && !Array.isArray(raw.perProviderCaps)) {
    perProviderCaps = {};
    for (const [key, val] of Object.entries(raw.perProviderCaps)) {
      if (typeof val === "number" && Number.isFinite(val) && val >= 1) {
        perProviderCaps[key] = Math.min(val, 256);
      }
    }
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_MODEL_PROXY.enabled,
    ...(typeof raw.defaultModel === "string" ? { defaultModel: raw.defaultModel } : {}),
    ...(typeof raw.secondPort === "number" && raw.secondPort >= 1024 && raw.secondPort <= 65535
      ? { secondPort: raw.secondPort }
      : {}),
    maxConcurrentStreams: clampNumber(
      raw.maxConcurrentStreams,
      DEFAULT_MODEL_PROXY.maxConcurrentStreams,
      1,
      256,
    ),
    perKeyConcurrentStreams: clampNumber(
      raw.perKeyConcurrentStreams,
      DEFAULT_MODEL_PROXY.perKeyConcurrentStreams,
      1,
      64,
    ),
    ...(perProviderCaps ? { perProviderCaps } : {}),
    ...(preferredModels.length > 0 ? { preferredModels } : {}),
    ...(modelAliases && Object.keys(modelAliases).length > 0 ? { modelAliases } : {}),
    logRequests:
      typeof raw.logRequests === "boolean" ? raw.logRequests : DEFAULT_MODEL_PROXY.logRequests,
    apiKeys,
  };
}

function parseKnownServers(raw: any): KnownServer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry: any) => entry && typeof entry === "object" && typeof entry.host === "string" && typeof entry.port === "number")
    .map((entry: any) => ({
      host: entry.host,
      port: entry.port,
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
      addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date().toISOString(),
    }));
}

function parseTrustedNetworks(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry: unknown) => typeof entry === "string" && entry.length > 0);
}

const KNOWN_TUNNEL_PROVIDERS: TunnelProviderId[] = ["zrok", "ngrok", "tailscale", "zerotier"];
const KNOWN_TUNNEL_MODES: TunnelMode[] = ["public", "private"];

/**
 * Read-time back-compat shim (idempotent, pure). Normalizes a raw persisted
 * `tunnel` block into the provider+mode shape without rewriting disk:
 *  - a legacy bare `reservedToken` + no `provider` resolves to
 *    `{ provider: "zrok", mode: "public", zrok: { reservedToken } }`;
 *  - the legacy top-level `reservedToken` is preserved for downgrade safety;
 *  - an explicit `provider` wins over a stray legacy `reservedToken`.
 * See change: add-tunnel-providers.
 */
export function normalizeTunnelConfig(
  raw: any,
  defaults: DashboardConfig["tunnel"],
): DashboardConfig["tunnel"] {
  const rawProvider =
    typeof raw?.provider === "string" && (KNOWN_TUNNEL_PROVIDERS as string[]).includes(raw.provider)
      ? (raw.provider as TunnelProviderId)
      : undefined;
  const legacyToken = typeof raw?.reservedToken === "string" ? raw.reservedToken : undefined;
  // Legacy bare token + no explicit provider → zrok/public.
  const provider = rawProvider ?? (legacyToken ? ("zrok" as TunnelProviderId) : undefined);
  const rawMode =
    typeof raw?.mode === "string" && (KNOWN_TUNNEL_MODES as string[]).includes(raw.mode)
      ? (raw.mode as TunnelMode)
      : undefined;
  const mode = rawMode ?? (provider === "zrok" && !rawProvider ? ("public" as TunnelMode) : undefined);

  // v2 (support-zrok-v2): preserve the legacy reservedToken for downgrade but
  // NEVER promote it to reservedName (a name is not a token). Surface the v2
  // reservedName + persistent when present; persistent defaults to false.
  const rawZrok = raw?.zrok;
  const zrokToken =
    typeof rawZrok?.reservedToken === "string" ? rawZrok.reservedToken : legacyToken;
  const zrokReservedName = typeof rawZrok?.reservedName === "string" ? rawZrok.reservedName : undefined;
  const zrokPersistent = typeof rawZrok?.persistent === "boolean" ? rawZrok.persistent : false;
  const zrok = {
    ...(zrokToken ? { reservedToken: zrokToken } : {}),
    ...(zrokReservedName ? { reservedName: zrokReservedName } : {}),
    persistent: zrokPersistent,
  };

  const out: DashboardConfig["tunnel"] = {
    enabled: raw?.enabled ?? defaults.enabled,
    ...(provider ? { provider } : {}),
    ...(mode ? { mode } : {}),
    ...(legacyToken ? { reservedToken: legacyToken } : {}),
    zrok,
    ...(raw?.ngrok && typeof raw.ngrok === "object" ? { ngrok: { ...raw.ngrok } } : {}),
    ...(raw?.tailscale && typeof raw.tailscale === "object" ? { tailscale: { ...raw.tailscale } } : {}),
    ...(raw?.zerotier && typeof raw.zerotier === "object" ? { zerotier: { ...raw.zerotier } } : {}),
    watchdog: {
      enabled: raw?.watchdog?.enabled ?? defaults.watchdog!.enabled,
      intervalMs:
        typeof raw?.watchdog?.intervalMs === "number" && raw.watchdog.intervalMs > 0
          ? raw.watchdog.intervalMs
          : defaults.watchdog!.intervalMs,
      failureThreshold:
        typeof raw?.watchdog?.failureThreshold === "number" && raw.watchdog.failureThreshold > 0
          ? Math.floor(raw.watchdog.failureThreshold)
          : defaults.watchdog!.failureThreshold,
      probeTimeoutMs:
        typeof raw?.watchdog?.probeTimeoutMs === "number" && raw.watchdog.probeTimeoutMs > 0
          ? raw.watchdog.probeTimeoutMs
          : defaults.watchdog!.probeTimeoutMs,
    },
  };
  return out;
}

/** A tunnel config error surfaced instead of silently starting a tunnel. */
export type TunnelConfigError =
  | { ok: true }
  | { ok: false; reason: "mode-unset" | "unsupported-mode" | "provider-unset"; message: string };

/**
 * Validate a normalized tunnel block before connect. The server MUST refuse
 * to start a tunnel when `mode` is unset or the provider does not support the
 * selected mode. See change: add-tunnel-providers.
 */
export function validateTunnelForConnect(tunnel: DashboardConfig["tunnel"]): TunnelConfigError {
  if (!tunnel.provider) {
    return { ok: false, reason: "provider-unset", message: "tunnel.provider is required when enabled" };
  }
  if (!tunnel.mode) {
    return { ok: false, reason: "mode-unset", message: "tunnel.mode is required when enabled" };
  }
  if (!providerSupportsMode(tunnel.provider, tunnel.mode)) {
    return {
      ok: false,
      reason: "unsupported-mode",
      message: `provider ${tunnel.provider} does not support mode ${tunnel.mode}`,
    };
  }
  return { ok: true };
}

/**
 * Load configuration from ~/.pi/dashboard/config.json.
 * Returns defaults for missing fields, malformed JSON, or missing file.
 */
export function loadConfig(): DashboardConfig {
  const configDir = path.join(os.homedir(), ".pi", "dashboard");
  const configFile = path.join(configDir, "config.json");
  const defaults: DashboardConfig = { ...DEFAULTS };

  try {
    if (!fs.existsSync(configFile)) return defaults;
    const raw = fs.readFileSync(configFile, "utf-8");
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw);
    const rawStrategy = parsed.spawnStrategy;
    const spawnStrategy: SpawnStrategy =
      VALID_SPAWN_STRATEGIES.includes(rawStrategy) ? rawStrategy : defaults.spawnStrategy;

    const result: DashboardConfig = {
      port: parsed.port ?? defaults.port,
      piPort: parsed.piPort ?? defaults.piPort,
      bindHost: typeof parsed.bindHost === "string" && parsed.bindHost ? parsed.bindHost : defaults.bindHost,
      autoStart: parsed.autoStart ?? defaults.autoStart,
      autoShutdown: parsed.autoShutdown ?? defaults.autoShutdown,
      shutdownIdleSeconds: parsed.shutdownIdleSeconds ?? defaults.shutdownIdleSeconds,
      spawnStrategy,
      tunnel: normalizeTunnelConfig(parsed.tunnel, defaults.tunnel),
      devBuildOnReload: parsed.devBuildOnReload ?? defaults.devBuildOnReload,
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : defaults.defaultModel,
      auth: parseAuthConfig(parsed.auth),
      memoryLimits: parseMemoryLimits(parsed.memoryLimits),
      openspec: parseOpenSpecPollConfig(parsed.openspec),
      sessions: parseSessionsConfig(parsed.sessions),
      keeperLog: parseKeeperLogConfig(parsed.keeperLog),
      trustedNetworks: parseTrustedNetworks(parsed.trustedNetworks),
      resolvedTrustedNetworks: [],
      cors: {
        allowedOrigins: Array.isArray(parsed.cors?.allowedOrigins)
          ? parsed.cors.allowedOrigins.filter((o: unknown) => typeof o === "string")
          : defaults.cors.allowedOrigins,
      },
      pairing: {
        publicBaseUrls: Array.isArray(parsed.pairing?.publicBaseUrls)
          ? parsed.pairing.publicBaseUrls.filter((o: unknown) => typeof o === "string")
          : defaults.pairing.publicBaseUrls,
      },
      ...(typeof parsed.lastServer === "string" ? { lastServer: parsed.lastServer } : {}),
      ...(typeof parsed.dashboardName === "string" && parsed.dashboardName.trim()
        ? { dashboardName: parsed.dashboardName }
        : {}),
      electronMode: parsed.electronMode === true,
      knownServers: parseKnownServers(parsed.knownServers),
      reattachPlacement: parseReattachPlacement(parsed.reattachPlacement),
      reopenSessionsAfterShutdown: parseReopenSessionsAfterShutdown(parsed.reopenSessionsAfterShutdown),
      completedFirst: typeof parsed.completedFirst === "boolean" ? parsed.completedFirst : defaults.completedFirst,
      questionFirst: typeof parsed.questionFirst === "boolean" ? parsed.questionFirst : defaults.questionFirst,
      plugins: parsePluginsConfig(parsed.plugins),
      askUserPromptTimeoutSeconds: typeof parsed.askUserPromptTimeoutSeconds === "number"
        ? parsed.askUserPromptTimeoutSeconds
        : defaults.askUserPromptTimeoutSeconds,
      spawnRegisterTimeoutMs: clampSpawnRegisterTimeoutMs(parsed.spawnRegisterTimeoutMs),
      gitWorktreeEnabled:
        typeof parsed.gitWorktreeEnabled === "boolean"
          ? parsed.gitWorktreeEnabled
          : defaults.gitWorktreeEnabled,
      windowsGitSource:
        parsed.windowsGitSource === "host" ||
        parsed.windowsGitSource === "bundled" ||
        parsed.windowsGitSource === "auto"
          ? parsed.windowsGitSource
          : defaults.windowsGitSource,
      modelProxy: parseModelProxyConfig(parsed.modelProxy),
      ...(typeof parsed.piSessionsDir === "string" && parsed.piSessionsDir.trim()
        ? { piSessionsDir: parsed.piSessionsDir }
        : {}),
    };

    // Compute resolvedTrustedNetworks: merge trustedNetworks + auth.bypassHosts
    const merged = new Set(result.trustedNetworks);
    if (result.auth?.bypassHosts) {
      for (const h of result.auth.bypassHosts) merged.add(h);
    }
    result.resolvedTrustedNetworks = Array.from(merged);
    return result;
  } catch {
    return defaults;
  }
}

/**
 * Create ~/.pi/dashboard/config.json with defaults if it doesn't exist.
 * Creates the directory recursively if needed.
 */
export function ensureConfig(): void {
  const configDir = path.join(os.homedir(), ".pi", "dashboard");
  const configFile = path.join(configDir, "config.json");

  if (fs.existsSync(configFile)) return;

  fs.mkdirSync(configDir, { recursive: true });

  const defaults = {
    port: DEFAULTS.port,
    piPort: DEFAULTS.piPort,
    autoStart: DEFAULTS.autoStart,
    autoShutdown: DEFAULTS.autoShutdown,
    shutdownIdleSeconds: DEFAULTS.shutdownIdleSeconds,
    spawnStrategy: DEFAULTS.spawnStrategy,
    tunnel: DEFAULTS.tunnel,
    devBuildOnReload: DEFAULTS.devBuildOnReload,
  };

  fs.writeFileSync(configFile, JSON.stringify(defaults, null, 2) + "\n");
}
