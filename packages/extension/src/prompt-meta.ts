/**
 * `metadata` envelope for PromptBus dialog requests.
 *
 * Core keys (`message`, `toolCallId`) stay core-owned. A plugin may attach its
 * own namespaced data through `opts.pluginMeta`, copied into `metadata.plugin`:
 * a plain object that serializes without throwing, ≤ 2048 UTF-8 bytes. Anything
 * else is dropped with a warning (the prompt itself is still raised). It can
 * never set `message`, `toolCallId` or a top-level `kind`.
 *
 * See change: add-browser-editor-pane-tab (D6).
 */

/** Max UTF-8 size of the serialized `pluginMeta`. */
export const PLUGIN_META_MAX_BYTES = 2048;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Validate `pluginMeta`; returns the object, or `undefined` after warning. */
function sanitizePluginMeta(
  value: unknown,
  warn: (msg: string) => void = (m) => console.warn(m),
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    warn("[bridge] dropping pluginMeta: not a plain object");
    return undefined;
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    warn("[bridge] dropping pluginMeta: not JSON-serializable");
    return undefined;
  }
  if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > PLUGIN_META_MAX_BYTES) {
    warn(`[bridge] dropping pluginMeta: over ${PLUGIN_META_MAX_BYTES} bytes`);
    return undefined;
  }
  return JSON.parse(json) as Record<string, unknown>;
}

export function buildPromptMeta(
  opts: { message?: unknown; toolCallId?: unknown; pluginMeta?: unknown } | undefined,
  explicitMessage?: string,
  warn?: (msg: string) => void,
): Record<string, unknown> | undefined {
  const message = explicitMessage ?? opts?.message;
  const toolCallId = opts?.toolCallId;
  const plugin = sanitizePluginMeta(opts?.pluginMeta, warn);
  if (!message && !toolCallId && !plugin) return undefined;
  const meta: Record<string, unknown> = {};
  if (message) meta.message = message;
  if (toolCallId) meta.toolCallId = toolCallId;
  if (plugin) meta.plugin = plugin;
  return meta;
}
