/**
 * mcp-client-plugin · JSON-Schema validation for server entries.
 *
 * Uses the plugin's OWN Ajv instance — `strict: true`, `useDefaults: false`,
 * `allErrors: true` — NOT the runtime's `config-validator` (whose
 * `useDefaults: true` would inject schema defaults into an entry, and whose
 * strict mode rejects the `x-` annotation keywords). The writer additionally
 * mirrors pi's own entry rules (`pi-rules.ts`).
 *
 * See change: migrate-mcp-to-pi-builtin; earlier: extract-mcp-client-plugin (D7).
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import schema from "../../schema/mcp-config.schema.json";

export interface PatchValidation {
  ok: boolean;
  errors: ErrorObject[];
}

function buildAjv(): Ajv {
  const ajv = new Ajv({ strict: true, useDefaults: false, allErrors: true });
  // Custom annotation keywords: registration is what makes strict mode accept them.
  ajv.addKeyword({ keyword: "x-secret" });
  ajv.addKeyword({ keyword: "x-transport" });
  ajv.addKeyword({ keyword: "x-global-only" });
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

export function validateServerEntry(entry: unknown): PatchValidation {
  const valid = validateServer(entry) as boolean;
  return { ok: valid, errors: valid ? [] : (validateServer.errors ?? []) };
}

/** Field names from Ajv errors (drop the leading slash of `instancePath`). */
export function errorFields(errors: ErrorObject[]): string[] {
  return errors.map((e) => e.instancePath.replace(/^\//, "").split("/")[0]).filter((f) => f.length > 0);
}

/** Exposed for the compile-contract test and the schema route. */
export const mcpConfigSchema = schema;
