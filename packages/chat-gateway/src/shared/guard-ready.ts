/**
 * Guard readiness handshake constants (harden-agent-tool-guards D6), shared by the in-session guard
 * extension (announces) and the gateway server (waits). Import-free leaf.
 *
 * The guard emits `dashboard:plugin-message` `{pluginId, messageType, payload:{token}}` at
 * `session_start`; the bridge forwards it with the sender's session id; the gateway releases a
 * guarded spawn only when the token is the spawn's own AND the sender is the session the spawn
 * resolved to.
 */

/** `pluginId` of the readiness message (this plugin's id). */
export const CHAT_GATEWAY_PLUGIN_ID = "chat-gateway";

/** `messageType` of the readiness message. */
export const GUARD_READY_MESSAGE = "chat_gateway_guard_ready";

/** Env var carrying the spawn's readiness token (`extensionConfig["chat-gateway-guard"].token`). */
export const GUARD_TOKEN_ENV = "PI_EXT_CHAT_GATEWAY_GUARD_TOKEN";

/** Fixed readiness window after the spawn. A guard that announces at exactly this instant loses. */
export const GUARD_READY_TIMEOUT_MS = 30_000;
