/**
 * Shared configuration module for PI Dashboard.
 * Used by both the server CLI and bridge extension.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  maxEventsPerSession: 5000,
  maxStringFieldSize: 0,
  maxWsBufferBytes: 4 * 1024 * 1024,
};

export interface OpenSpecPollConfig {
  /** Poll interval in seconds. Default 30. Clamped to [5, 3600]. */
  pollIntervalSeconds: number;
  /** Max concurrent `openspec` CLI invocations across all dirs. Default 3. Clamped to [1, 16]. */
  maxConcurrentSpawns: number;
  /** `"mtime"` skips re-polling unchanged changes; `"always"` polls unconditionally. Default `"mtime"`. */
  changeDetection: "mtime" | "always";
  /** Max per-directory phase jitter in seconds. 0 disables jitter. Default 5. Clamped to [0, 60]. */
  jitterSeconds: number;
}

export const DEFAULT_OPENSPEC_POLL: OpenSpecPollConfig = {
  pollIntervalSeconds: 30,
  maxConcurrentSpawns: 3,
  changeDetection: "mtime",
  jitterSeconds: 5,
};

export interface EditorConfig {
  /** Override path to code-server binary */
  binary?: string;
  /** Minutes before idle instance is killed (default: 10) */
  idleTimeoutMinutes: number;
  /** Maximum concurrent code-server instances (default: 3) */
  maxInstances: number;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  idleTimeoutMinutes: 10,
  maxInstances: 3,
};

export interface KnownServer {
  host: string;
  port: number;
  label?: string;
  addedAt: string; // ISO timestamp
}

/**
 * Plugin-specific config namespace.
 * Lives at ~/.pi/dashboard/config.json#plugins.<id>.*
 */
export type PluginsConfig = Record<string, Record<string, unknown>>;

export interface DashboardConfig {
  port: number;
  piPort: number;
  autoStart: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  spawnStrategy: SpawnStrategy;
  tunnel: { enabled: boolean; reservedToken?: string };
  devBuildOnReload: boolean;
  auth?: AuthConfig;
  defaultModel: string;
  memoryLimits: MemoryLimitsConfig;
  editor: EditorConfig;
  /** OpenSpec background polling behavior (interval, concurrency, change detection, jitter) */
  openspec: OpenSpecPollConfig;
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
  /** Last-used server address (host:port) for reconnection */
  lastServer?: string;
  /** Whether the server was launched by the Electron app */
  electronMode: boolean;
  /**
   * Policy applied when the bridge reattaches after a dashboard restart.
   * See {@link ReattachPlacement}. Default `"always"`.
   * See change: reattach-move-to-front.
   */
  reattachPlacement: ReattachPlacement;
  /** Persisted list of known remote servers */
  knownServers: KnownServer[];
  /**
   * Per-plugin config namespaces. Reserved top-level key.
   * Each plugin's config lives at plugins.<id>.*
   * Plugin-shaped legacy top-level keys (e.g. openspec.*) stay at top-level
   * until each extract-*-as-plugin change migrates them.
   */
  plugins: PluginsConfig;
}

export interface CorsConfig {
  /** Additional origins allowed for cross-origin requests */
  allowedOrigins: string[];
}

const VALID_SPAWN_STRATEGIES: SpawnStrategy[] = ["tmux", "headless"];

/** Default ask_user prompt timeout: 300 seconds (5 minutes). */
export const DEFAULT_ASK_USER_PROMPT_TIMEOUT_SECONDS = 300;

const DEFAULTS: DashboardConfig = {
  plugins: {},
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: false,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  defaultModel: "",
  memoryLimits: { ...DEFAULT_MEMORY_LIMITS },
  editor: { ...DEFAULT_EDITOR_CONFIG },
  openspec: { ...DEFAULT_OPENSPEC_POLL },
  trustedNetworks: [],
  resolvedTrustedNetworks: [],
  cors: { allowedOrigins: [] },
  electronMode: false,
  knownServers: [],
  askUserPromptTimeoutSeconds: DEFAULT_ASK_USER_PROMPT_TIMEOUT_SECONDS,
  reattachPlacement: DEFAULT_REATTACH_PLACEMENT,
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
  };
}

function parseEditorConfig(raw: any): EditorConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_EDITOR_CONFIG };
  return {
    ...(typeof raw.binary === "string" ? { binary: raw.binary } : {}),
    idleTimeoutMinutes: typeof raw.idleTimeoutMinutes === "number" ? raw.idleTimeoutMinutes : DEFAULT_EDITOR_CONFIG.idleTimeoutMinutes,
    maxInstances: typeof raw.maxInstances === "number" ? raw.maxInstances : DEFAULT_EDITOR_CONFIG.maxInstances,
  };
}

function clampNumber(raw: any, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseOpenSpecPollConfig(raw: any): OpenSpecPollConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_OPENSPEC_POLL };
  const changeDetection =
    raw.changeDetection === "always" || raw.changeDetection === "mtime"
      ? raw.changeDetection
      : DEFAULT_OPENSPEC_POLL.changeDetection;
  return {
    pollIntervalSeconds: clampNumber(raw.pollIntervalSeconds, DEFAULT_OPENSPEC_POLL.pollIntervalSeconds, 5, 3600),
    maxConcurrentSpawns: clampNumber(raw.maxConcurrentSpawns, DEFAULT_OPENSPEC_POLL.maxConcurrentSpawns, 1, 16),
    changeDetection,
    jitterSeconds: clampNumber(raw.jitterSeconds, DEFAULT_OPENSPEC_POLL.jitterSeconds, 0, 60),
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
      autoStart: parsed.autoStart ?? defaults.autoStart,
      autoShutdown: parsed.autoShutdown ?? defaults.autoShutdown,
      shutdownIdleSeconds: parsed.shutdownIdleSeconds ?? defaults.shutdownIdleSeconds,
      spawnStrategy,
      tunnel: {
        enabled: parsed.tunnel?.enabled ?? defaults.tunnel.enabled,
        ...(parsed.tunnel?.reservedToken ? { reservedToken: parsed.tunnel.reservedToken } : {}),
      },
      devBuildOnReload: parsed.devBuildOnReload ?? defaults.devBuildOnReload,
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : defaults.defaultModel,
      auth: parseAuthConfig(parsed.auth),
      memoryLimits: parseMemoryLimits(parsed.memoryLimits),
      editor: parseEditorConfig(parsed.editor),
      openspec: parseOpenSpecPollConfig(parsed.openspec),
      trustedNetworks: parseTrustedNetworks(parsed.trustedNetworks),
      resolvedTrustedNetworks: [],
      cors: {
        allowedOrigins: Array.isArray(parsed.cors?.allowedOrigins)
          ? parsed.cors.allowedOrigins.filter((o: unknown) => typeof o === "string")
          : defaults.cors.allowedOrigins,
      },
      ...(typeof parsed.lastServer === "string" ? { lastServer: parsed.lastServer } : {}),
      electronMode: parsed.electronMode === true,
      knownServers: parseKnownServers(parsed.knownServers),
      reattachPlacement: parseReattachPlacement(parsed.reattachPlacement),
      plugins: parsePluginsConfig(parsed.plugins),
      askUserPromptTimeoutSeconds: typeof parsed.askUserPromptTimeoutSeconds === "number"
        ? parsed.askUserPromptTimeoutSeconds
        : defaults.askUserPromptTimeoutSeconds,
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
