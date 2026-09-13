/**
 * mcp-client-plugin · JSON-Schema validation for patches.
 *
 * Uses the plugin's OWN Ajv instance — `strict: true`, `useDefaults: false`,
 * `allErrors: true` — NOT the runtime's `config-validator` (whose
 * `useDefaults: true` would inject schema defaults into a patch, violating
 * merge-only, and whose strict mode rejects the `x-` annotation keywords).
 *
 * See change: extract-mcp-client-plugin (design D7).
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import schema from "../../schema/mcp-config.schema.json";
import { TRANSPORT_FIELDS } from "./config-writer.js";
import type { ConfigRefusal } from "./types.js";

export interface PatchValidation {
  ok: boolean;
  errors: ErrorObject[];
}

function buildAjv(): Ajv {
  const ajv = new Ajv({ strict: true, useDefaults: false, allErrors: true });
  // Custom annotation keywords: registration is what makes strict mode accept them.
  ajv.addKeyword({ keyword: "x-secret" });
  ajv.addKeyword({ keyword: "x-transport" });
  ajv.addKeyword({ keyword: "x-atomic" });
  ajv.addSchema(schema, "mcp-config");
  return ajv;
}

const ajv = buildAjv();

function compile(ref: string): ValidateFunction {
  const fn = ajv.getSchema(`mcp-config#/$defs/${ref}`);
  if (!fn) throw new Error(`schema $def ${ref} did not compile`);
  return fn;
}

const validateServer = compile("ServerEntry");
const validateSettings = compile("McpSettings");

export function validateServerPatch(patch: unknown): PatchValidation {
  const valid = validateServer(patch) as boolean;
  return { ok: valid, errors: valid ? [] : (validateServer.errors ?? []) };
}

export function validateSettingsPatch(patch: unknown): PatchValidation {
  const valid = validateSettings(patch) as boolean;
  return { ok: valid, errors: valid ? [] : (validateSettings.errors ?? []) };
}

/** Field names from Ajv errors (drop the leading slash of `instancePath`). */
export function errorFields(errors: ErrorObject[]): string[] {
  return errors
    .map((e) => e.instancePath.replace(/^\//, "").split("/")[0])
    .filter((f) => f.length > 0);
}

/** Exposed for the compile-contract test. */
export const mcpConfigSchema = schema;

/**
 * The "at least one transport when nothing lower defines the server" rule.
 * Needs the adapter merge to know whether a lower source defines the server, so
 * it lives in the HTTP layer, not the writer. `hasLowerDefinition` is that
 * merge result.
 */
export function validateTransportPresence(
  resultingEntry: Record<string, unknown>,
  hasLowerDefinition: boolean,
): ConfigRefusal | null {
  if (hasLowerDefinition) return null;
  const present = TRANSPORT_FIELDS.filter((f) => resultingEntry[f] !== undefined);
  if (present.length === 0) {
    return {
      code: "missing-transport",
      message: "server has no transport; set one of command, url, socket",
      fields: [...TRANSPORT_FIELDS],
    };
  }
  return null;
}
