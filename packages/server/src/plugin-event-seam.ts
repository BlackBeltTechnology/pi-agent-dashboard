/**
 * Trusted-plugin → session emit seams (`emitEventToSession`, `sendExtensionMessage`).
 * Refuses reserved host namespaces and the raw `plugin_emit_event` lane so a plugin
 * cannot fire privileged `pi.events` listeners (roles:, model:, dashboard:, …), and
 * refuses any event type absent from the calling plugin's manifest `emits`
 * allowlist (computed live from loaded manifests; automation additionally gets the
 * manifest `emits` of the providers of its accepted `automation.action.*`
 * registrations). The bridge stays a relay: this server seam is the trust point.
 * See change: harden-trust-and-credential-boundaries (D3);
 * harden-git-terminal-plugin-boundaries (D16).
 */
import { isReservedEventType, RESERVED_EVENT_PREFIXES } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

type Send = (sessionId: string, msg: any) => boolean;

/** Plugin whose allowlist is widened by its collected action providers. */
export const AUTOMATION_PLUGIN_ID = "automation";
const AUTOMATION_ACTION_PREFIX = "automation.action.";

/** Max distinct (plugin, eventType) pairs warned about per process; then one summary. */
export const MAX_WARNED_PAIRS = 1000;
/** Event types are truncated to this length in the dedupe key and log lines. */
const MAX_LOGGED_TYPE_CHARS = 128;

export interface EmitAllowlistDeps {
  /** Live manifest `emits` of a LOADED plugin; `undefined` when not loaded / unknown. */
  manifestEmits(pluginId: string): readonly string[] | undefined;
  /** Live `automation.action.*` service entries with the host-recorded provider. */
  actionEntries(): ReadonlyArray<{ key: string; value: unknown; provider: string }>;
}

/** `<source>` of an `automation.action.<source>[.…]` key ("" when empty/not in namespace). */
function actionSource(key: string): string {
  if (!key.startsWith(AUTOMATION_ACTION_PREFIX)) return "";
  const rest = key.slice(AUTOMATION_ACTION_PREFIX.length);
  const dot = rest.indexOf(".");
  return dot === -1 ? rest : rest.slice(0, dot);
}

/**
 * Event types `pluginId` may emit right now: its own manifest `emits`; for the
 * automation plugin, additionally the WHOLE manifest `emits` of every loaded
 * plugin that is the recorded provider of an accepted `automation.action.<provider>`
 * registration. A registration is accepted when at least one of its event
 * actions declares a non-empty `emits` that is a subset of that provider's
 * manifest `emits` (mirrors the registry's registration check; host-set and
 * mismatched-provider entries never count). No runtime channel widens it.
 */
export function computeEmitAllowlist(pluginId: string, deps: EmitAllowlistDeps): Set<string> {
  const allowed = new Set<string>(deps.manifestEmits(pluginId) ?? []);
  if (pluginId !== AUTOMATION_PLUGIN_ID) return allowed;
  for (const { key, value, provider } of deps.actionEntries()) {
    if (actionSource(key) !== provider) continue;
    const manifest = deps.manifestEmits(provider);
    if (!manifest) continue; // provider unloaded → its types leave the allowlist
    const declared = new Set(manifest);
    const contribs = Array.isArray(value) ? value : [value];
    const accepted = contribs.some((c) => {
      if (!c || typeof c !== "object") return false;
      const a = c as { buildEvent?: unknown; emits?: unknown };
      return (
        typeof a.buildEvent === "function" &&
        Array.isArray(a.emits) &&
        a.emits.length > 0 &&
        a.emits.every((t) => typeof t === "string" && declared.has(t))
      );
    });
    if (accepted) for (const t of manifest) allowed.add(t);
  }
  return allowed;
}

/** (plugin, eventType) pairs already warned about, capped at MAX_WARNED_PAIRS. */
const warnedPairs = new Set<string>();
let capSummaryLogged = false;

/** Test seam: forget the per-process warning de-duplication state. */
export function resetEmitWarnings(): void {
  warnedPairs.clear();
  capSummaryLogged = false;
}

/** Log `message` at most once per (plugin, eventType) per process, bounded. */
function warnOnce(pluginId: string, eventType: string, message: string): void {
  const key = `${pluginId}\u0000${eventType.slice(0, MAX_LOGGED_TYPE_CHARS)}`;
  if (warnedPairs.has(key)) return;
  if (warnedPairs.size >= MAX_WARNED_PAIRS) {
    if (!capSummaryLogged) {
      capSummaryLogged = true;
      console.warn(
        `[plugin] emitEventToSession refusals: warning cap of ${MAX_WARNED_PAIRS} (plugin, event type) pairs reached ` +
          `(last plugin "${pluginId}"); further refusals are silent`,
      );
    }
    return;
  }
  warnedPairs.add(key);
  console.warn(message);
}

export interface EmitPolicy {
  /** Calling plugin's manifest id (attribution for allowlist + warnings). */
  pluginId: string;
  /** Live allowlist getter (evaluated per call; never cached). */
  allowed: () => ReadonlySet<string>;
}

export function emitEventToSession(
  trusted: boolean,
  send: Send,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown> | undefined,
  policy: EmitPolicy,
): boolean {
  if (!trusted) return false;
  if (typeof eventType !== "string" || eventType.length === 0) return false;
  const shown = eventType.slice(0, MAX_LOGGED_TYPE_CHARS);
  if (isReservedEventType(eventType)) {
    const prefix = RESERVED_EVENT_PREFIXES.find((p) => eventType.startsWith(p));
    warnOnce(
      policy.pluginId,
      eventType,
      `[plugin] refused emitEventToSession from "${policy.pluginId}": event type "${shown}" is in the reserved namespace "${prefix}"`,
    );
    return false;
  }
  if (!policy.allowed().has(eventType)) {
    warnOnce(
      policy.pluginId,
      eventType,
      `[plugin] refused emitEventToSession from "${policy.pluginId}": event type "${shown}" is not declared in the plugin manifest field "emits"`,
    );
    return false;
  }
  return send(sessionId, { type: "plugin_emit_event", sessionId, eventType, data: data ?? {} });
}

export function sendExtensionMessage(
  trusted: boolean,
  send: Send,
  sessionId: string,
  msg: unknown,
): boolean {
  if (!trusted) return false;
  if ((msg as { type?: unknown } | null)?.type === "plugin_emit_event") {
    console.warn("[plugin] refused sendExtensionMessage: plugin_emit_event must use emitEventToSession");
    return false;
  }
  return send(sessionId, msg);
}
