/**
 * chat-gateway shared contract.
 *
 * The gateway is a server-side dashboard plugin that fronts the dashboard as a
 * HEADLESS BROWSER-PROTOCOL CLIENT and speaks chat platforms through a
 * pluggable adapter. Everything here is pure data — no I/O, no host imports —
 * so both the server component and the settings panel can share it.
 *
 * See change: add-chat-gateway.
 */

/** Only Discord ships in this change; the interface is the extension point. */
/**
 * `"fake"` is the socket-less harness fixture (`adapters/fake.ts`), reachable
 * only under `PI_CHAT_GATEWAY_FAKE` — never a production platform.
 */
export type ChatPlatform = "discord" | "fake";

// ── Configuration ─────────────────────────────────────────────────────────

/**
 * Plugin configuration. Mirrors `src/configSchema.json` 1:1.
 *
 * `token` is `writeOnly` in the schema, so the HOST strips it from every
 * client-facing document (`redactWriteOnly`); the server-side
 * `getPluginConfig()` the plugin entry reads still carries the real value.
 * See change: add-chat-gateway.
 */
export interface ChatGatewayConfig {
  /** Master switch. Defaults true; with no `token` the gateway is inert. */
  enabled?: boolean;
  /** Discord bot token. SECRET — writeOnly, never crosses to a client. */
  token?: string;
  /**
   * MANDATORY whitelist of directories a session may be spawned in. Empty (or
   * absent) refuses every spawn. The single spawn boundary — non-bypassable.
   */
  allowedRoots?: string[];
  /** Fixed `channelKey → cwd` map. A binding source, still `allowedRoots`-gated. */
  fixedMap?: Record<string, string>;
  /** Preferred cwd when nothing more specific resolves. Still gated. */
  defaultCwd?: string;
  /** L1 identity allowlist: Discord user ids permitted to talk. */
  allowlist?: string[];
  /** L2 binding authority: Discord user ids permitted to bind a channel. */
  admins?: string[];
  /** L4: guild channel ids explicitly opted in. Non-listed guild channels are inert. */
  groupChannels?: string[];
  /** Mid-stream delivery prefix forcing `steer` instead of `followUp`. Default `!`. */
  steerPrefix?: string;
  /** Minimum ms between `editMessage` calls on one channel. Default 1000. */
  editThrottleMs?: number;
  /**
   * L3 tool policy for gateway-SPAWNED sessions (attached sessions stay
   * ungated by design). Present ⇒ the companion guard extension is loaded.
   * Deny-first: a tool in neither list is denied unless `defaultAction` widens
   * it. See `src/guard/policy.ts`.
   */
  toolPolicy?: {
    allow?: string[];
    approval?: string[];
    defaultAction?: "deny" | "approve";
  };
  /**
   * Installed identifier (package name or absolute path) of the companion guard
   * extension. Required for the guard to be loaded — the gateway never invents
   * one, because an unresolvable extension would break every spawn.
   */
  guardExtension?: string;
  /**
   * Team-controls layer (change: add-chat-gateway-team-controls). Mirrors
   * `configSchema.json`; validated by `team-config.ts`, not by this type.
   */
  teamControls?: {
    /**
     * Discord guild a workspace channel is provisioned in. Required for
     * provisioning; a binding without it is reported as a failure rather than
     * silently producing no channel.
     */
    guildId?: string;
    ceiling?: "observe" | "control" | "operate";
    disarmed?: boolean;
    auditRetention?: number;
    bindings?: Record<
      string,
      {
        principals?: Record<string, "observe" | "control" | "operate">;
        roles?: Record<string, "observe" | "control">;
        mirrorLevel?: "names-only" | "names-and-diffs" | "full-transcript";
        ceiling?: "observe" | "control" | "operate";
      }
    >;
  };
}

/** Fully-resolved config with every default applied. */
export interface ResolvedConfig {
  enabled: boolean;
  token: string;
  allowedRoots: string[];
  fixedMap: Record<string, string>;
  defaultCwd?: string;
  allowlist: string[];
  admins: string[];
  groupChannels: string[];
  steerPrefix: string;
  editThrottleMs: number;
  toolPolicy?: {
    allow?: string[];
    approval?: string[];
    defaultAction?: "deny" | "approve";
  };
  guardExtension?: string;
}

export const CONFIG_DEFAULTS = {
  enabled: true,
  steerPrefix: "!",
  editThrottleMs: 1000,
} as const;

// ── Inbound message ───────────────────────────────────────────────────────

/**
 * A normalized inbound chat message, produced by the adapter and consumed by
 * the gateway. Platform-agnostic by construction.
 */
export interface InboundMessage {
  platform: ChatPlatform;
  /** Channel the message arrived in. */
  channelId: string;
  /** Thread discriminator when the platform has threads; absent otherwise. */
  threadId?: string;
  /**
   * Parent channel of a thread. L4 treats an opted-in PARENT as opting in its
   * threads (a Discord user replies in a thread of a channel the operator
   * configured); without this a thread id is never in `groupChannels`.
   */
  parentChannelId?: string;
  /** Platform user id of the sender. */
  userId: string;
  /** Display name, for logs only — never an authorization input. */
  userName?: string;
  text: string;
  /** True when this is a direct message (L4 isolation). */
  isDM: boolean;
  /** True when the platform marks the author as a bot (non-human). */
  bot?: boolean;
  /** True when the message arrived via a webhook (non-human). */
  webhook?: boolean;
  /** Platform role ids held by the author, for role→tier resolution. */
  roleIds?: string[];
  /** True when the message has been authorized as a conversation turn. */
  startedAt: number;
}

// ── Binding ───────────────────────────────────────────────────────────────

/**
 * Where a resolved `cwd` came from. Ordered by the resolver's precedence:
 * persisted > fixedMap > default > attach | spawn.
 */
export type BindingSource =
  | "persisted"
  | "workspace"
  | "fixed-map"
  | "default"
  | "attach"
  | "spawn";

/**
 * A sticky channel→session binding.
 *
 * Granularity is per-thread where the platform has threads, else per-channel:
 * `(platform, channelId, threadId?)` is the identity.
 */
export interface Binding {
  platform: ChatPlatform;
  channelId: string;
  threadId?: string;
  /**
   * Parent channel of a THREAD binding. A thread's messages arrive with the
   * THREAD id as `channelId`, but the operator binds the PARENT — so this is what
   * lets authorization and the mirror lane resolve the parent's workspace and
   * per-thread mirror level instead of falling back to defaults.
   */
  parentChannelId?: string;
  sessionId: string;
  cwd: string;
  /** Platform user id that created the binding (provenance). */
  boundBy: string;
  source: BindingSource;
  /**
   * Whether this binding's channel is a DM. Persisted so an interactive-click
   * re-authorization enforces L4 correctly: a synthesized
   * `!groupChannels.includes(channelId)` mis-classifies a THREAD as a DM.
   */
  isDM?: boolean;
  createdAt: number;
}

/** Canonical, collision-free key for a binding identity. */
export function bindingKey(key: {
  platform: ChatPlatform;
  channelId: string;
  threadId?: string;
}): string {
  // Threads are keyed separately from their parent channel. The separator is a
  // character Discord never emits in a snowflake, so ids cannot collide.
  return [key.platform, key.channelId, key.threadId ?? "-"].join(":");
}

// ── Authorization ─────────────────────────────────────────────────────────

/** What a user is trying to do. */
export type AuthAction = "talk" | "bind";

/** A grant, or a refusal carrying the reason (never undifferentiated silence). */
export interface AuthDecision {
  allowed: boolean;
  reason: string;
}

// ── Configuration surface (dashboard) ─────────────────────────────────────
//
// The wire shape of the team-controls settings panel. Declared HERE rather than
// beside the server builder so the panel renders it WITHOUT importing server
// code, and with every union spelled out rather than imported — this file stays
// import-free so the browser bundle carries none of the server graph.

/**
 * Browser message: ask for the team-controls panel snapshot. The answer arrives
 * as the same type, carrying `surface`.
 *
 * A `registerBrowserHandler` lane rather than a new HTTP route — the panel is a
 * projection of plugin state, and the plugin already owns this channel.
 */
export const TEAM_SURFACE_MESSAGE = "chat_gateway_team_surface";

/**
 * Browser message: WRITE team-controls config.
 *
 * Deliberately not the core `plugin_config_write` lane. That lane persists and
 * returns; it cannot await the platform. D7 requires the write NOT be reported
 * as succeeded until the platform's overwrites match, so the panel writes here
 * and the plugin owns the ordering: validate → persist → await reconcile →
 * report. It is also the only path that can apply a live disarm change.
 */
export const TEAM_CONFIG_MESSAGE = "chat_gateway_team_config";

/**
 * Who can hand out a platform role — or why we cannot say.
 *
 * `unavailable` is deliberately NOT an empty `assigners` list: an empty list
 * reads as "nobody can assign this", which is the opposite of the truth when
 * the platform merely declined to enumerate. The panel must say so.
 */
export type SurfaceRoleAssigners =
  | { kind: "assigners"; members: Array<{ id: string; name?: string }> }
  | { kind: "unavailable"; missingPermission: string };

/** One `roleId → tier` mapping, plus the delegation disclosure for it. */
export interface SurfaceRoleMapping {
  roleId: string;
  tier: "observe" | "control";
  assigners: SurfaceRoleAssigners;
}

export interface SurfaceFolder {
  path: string;
  /** Outside `allowedRoots`: never resolved, never spawned into. */
  inert: boolean;
}

/** One configured workspace binding, as the panel renders it. */
export interface SurfaceBinding {
  workspaceId: string;
  /** Absent when the workspace no longer exists (or was never real). */
  workspaceName?: string;
  /** False when the workspace is gone or unbound; its channel is retained. */
  bound: boolean;
  ceiling: "observe" | "control" | "operate";
  mirrorLevel: "names-only" | "names-and-diffs" | "full-transcript";
  principals: Array<{ id: string; tier: "observe" | "control" | "operate" }>;
  roles: SurfaceRoleMapping[];
  folders: SurfaceFolder[];
  /** Channel the layer owns for this binding, once provisioned. */
  channelId?: string;
  /** Set when this binding could not be provisioned; the fail-closed reason. */
  problem?: string;
}

/** One command-log row. Mirrors `CommandLogEntry` on the wire. */
export interface SurfaceLogEntry {
  /** Epoch ms. */
  at: number;
  principal: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  tier?: "observe" | "control" | "operate";
  verb: string;
  target?: string;
  outcome: "permitted" | "refused";
  reason?: string;
}

/**
 * Everything the team-controls panel renders, in ONE broadcast — the panel is
 * a read-only projection of authoritative server state, never a second copy
 * the browser mutates.
 */
export interface TeamSurfaceView {
  /** False when team controls are not configured at all. */
  configured: boolean;
  disarmed: boolean;
  ceiling: "observe" | "control" | "operate";
  allowedRoots: string[];
  bindings: SurfaceBinding[];
  /** Most-recent-first. */
  log: SurfaceLogEntry[];
  logLimit: number;
  /** Set when config validation rejected the operator's input: FAIL-CLOSED. */
  configError?: string;
}
