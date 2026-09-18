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
export type ChatPlatform = "discord";

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
  /** True when the message has been authorized as a conversation turn. */
  startedAt: number;
}

// ── Binding ───────────────────────────────────────────────────────────────

/**
 * Where a resolved `cwd` came from. Ordered by the resolver's precedence:
 * persisted > fixedMap > default > attach | spawn.
 */
export type BindingSource = "persisted" | "fixed-map" | "default" | "attach" | "spawn";

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
  sessionId: string;
  cwd: string;
  /** Platform user id that created the binding (provenance). */
  boundBy: string;
  source: BindingSource;
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
