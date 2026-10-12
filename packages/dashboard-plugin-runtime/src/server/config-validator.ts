/**
 * Plugin config validation using Ajv (JSON Schema 7).
 *
 * Used by the server's plugin config REST endpoint and by
 * updatePluginConfig to validate before persisting.
 *
 * Ajv is already a transitive dependency of Fastify, so no new dep.
 */
import Ajv, { type ValidateFunction } from "ajv";

export class ValidationError extends Error {
  public readonly pluginId: string;
  public readonly errors: unknown[];

  constructor(
    pluginId: string,
    errors: unknown[],
  ) {
    super(
      `[plugin:${pluginId}] Config validation failed: ${JSON.stringify(errors)}`,
    );
    this.pluginId = pluginId;
    this.errors = errors;
    this.name = "ValidationError";
  }
}

const ajv = new Ajv({ coerceTypes: false, useDefaults: true, allErrors: true });

/** Cache compiled validators by schema identity. */
const validatorCache = new Map<string, ValidateFunction>();

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  if (!validatorCache.has(key)) {
    validatorCache.set(key, ajv.compile(schema));
  }
  return validatorCache.get(key)!;
}

/**
 * Validate a plugin config object against a JSON Schema 7 schema.
 * Applies schema defaults to `config` in-place (Ajv useDefaults).
 * Throws ValidationError on failure.
 */
export function validatePluginConfig(
  pluginId: string,
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
): void {
  const validate = getValidator(schema);
  const valid = validate(config);
  if (!valid) {
    throw new ValidationError(pluginId, validate.errors ?? []);
  }
}

/**
 * Apply schema defaults to a config object (no validation).
 * Returns a new object with defaults filled in.
 */
export function applySchemaDefaults(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const copy = { ...config };
  // Ajv with useDefaults fills defaults in-place when validating
  const validate = getValidator(schema);
  validate(copy);
  return copy;
}
