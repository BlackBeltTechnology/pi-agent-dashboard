import fs from "node:fs";
import path from "node:path";

import { discoverPlugins } from "./loader.js";

/**
 * writeOnly config redaction (spec add-browser-relay, browser-plugin-settings
 * scenario F2). Plugin configs can carry secrets (the browser plugin's
 * per-profile SSO pairing `token` is marked `writeOnly: true` in its
 * configSchema); those values must never cross to a client.
 *
 * Every client-facing surface (plugin_config_update broadcasts, POST
 * /api/config/plugins/:id response, GET /api/config) passes the config through
 * `redactWriteOnly`. The server-side `getPluginConfig()` a plugin entry calls
 * is NOT redacted — the plugin itself needs the real token.
 *
 * See change: add-browser-relay (GAP A).
 */

interface SchemaLike {
  properties?: Record<string, unknown>;
  patternProperties?: Record<string, unknown>;
  additionalProperties?: unknown;
  items?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the schema shape can describe object keys at all. */
function describesObjectKeys(schema: SchemaLike): boolean {
  return (
    schema.properties !== undefined ||
    schema.patternProperties !== undefined ||
    isPlainObject(schema.additionalProperties)
  );
}

function subSchemaFor(key: string, schema: SchemaLike): unknown {
  const exact = schema.properties?.[key];
  if (exact !== undefined) return exact;
  for (const [pattern, sub] of Object.entries(schema.patternProperties ?? {})) {
    try {
      if (new RegExp(pattern).test(key)) return sub;
    } catch {
      // Malformed pattern in a schema — skip it; nothing under it is
      // described, so nothing under it is writeOnly either.
    }
  }
  if (isPlainObject(schema.additionalProperties)) return schema.additionalProperties;
  return undefined;
}

/** Redact one `[key, value]` pair against its subschema; null key = strip. */
function redactPair(
  key: string,
  value: unknown,
  schema: SchemaLike,
): [string, unknown] | null {
  const sub = subSchemaFor(key, schema);
  if (isPlainObject(sub) && sub.writeOnly === true) return null; // omit entirely
  return [key, redactWriteOnly(value, sub)];
}

function redactObject(config: Record<string, unknown>, schema: SchemaLike): unknown {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const pair = redactPair(key, value, schema);
    if (pair === null) {
      changed = true; // writeOnly — stripped
      continue;
    }
    if (pair[1] !== value) changed = true;
    out[pair[0]] = pair[1];
  }
  return changed ? out : config;
}

function redactArray(config: unknown[], items: unknown): unknown {
  let changed = false;
  const out = config.map((value) => {
    const redacted = redactWriteOnly(value, items);
    if (redacted !== value) changed = true;
    return redacted;
  });
  return changed ? out : config;
}

/**
 * Strip every property marked `writeOnly: true` from a config value, guided
 * by its JSON Schema. Pure: never mutates the input, returns a new object
 * when something was stripped and the SAME reference otherwise.
 *
 * Recurses through `properties`, `patternProperties` and object-shaped
 * `additionalProperties` (so `browsers.<anyProfileDir>.token` is covered —
 * the profileDirectory keys are matched via additionalProperties), and
 * through array `items`. Keys the schema does not describe pass through
 * untouched.
 */
export function redactWriteOnly(config: unknown, schema: unknown): unknown {
  if (Array.isArray(config)) return redactArray(config, (schema as SchemaLike)?.items);
  if (!isPlainObject(config) || !isPlainObject(schema)) return config;
  if (!describesObjectKeys(schema)) return config;
  return redactObject(config, schema);
}

/**
 * Convenience wrapper for call sites that hold a plugin id (broadcasts, REST
 * responses): resolve the plugin's configSchema via discovery, load it from
 * disk, and redact. Returns the input reference unchanged when the plugin is
 * unknown or declares no (loadable) schema — same failure-isolated posture as
 * `validatePluginConfig`'s caller in plugin-config-routes.ts.
 */
export function redactPluginConfigForClient(
  pluginId: string,
  config: unknown,
  repoRoot?: string,
): unknown {
  const plugins = discoverPlugins(repoRoot);
  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  if (!plugin?.manifest.configSchema) return config;
  const schemaPath = path.resolve(plugin.packageDir, plugin.manifest.configSchema);
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    return redactWriteOnly(config, schema);
  } catch {
    return config;
  }
}
