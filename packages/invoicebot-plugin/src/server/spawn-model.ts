/**
 * Spawn-model resolution — the SINGLE owner of "which model does an
 * InvoiceBot-owned session spawn with".
 *
 * Every invoicebot spawn (the scoped per-invoice detail session AND the
 * processing/automation run session) must pass an explicit model. Omitting it
 * let the host fall back to its built-in default provider, which produced the
 * live failure: a session stamped `model=anthropic/claude-opus-4-8` dying on
 * `OAuth refresh failed for anthropic: invalid_grant` on a deployment
 * configured for `openai-codex/gpt-5.4` end to end.
 *
 * The host option is ONE resolved `provider/modelId` string forwarded as
 * `--model` (`PluginSpawnOptions.model`); `provider` and `modelId` are validated
 * separately here and re-joined, rather than invented as separate spawn fields.
 *
 * Reads configuration values ONLY — never a credential, token or auth file.
 * See change: pin-invoicebot-spawn-model.
 */

/** Minimal logger shape (matches the plugin/session-link loggers). */
interface WarnLogger {
  warn: (msg: string) => void;
}

/** Outcome of {@link parseModelRef}. */
export type ModelRef =
  | { ok: true; provider: string; modelId: string; model: string }
  | { ok: false; reason: "not-a-string" | "blank" | "no-provider" | "no-model-id" | "whitespace" };

/**
 * Validate a `provider/modelId` reference.
 *
 * Splits on the FIRST `/` so nested ids (`openrouter/anthropic/claude-x`) stay
 * valid. Both halves must be non-empty and free of whitespace/control
 * characters — a header-style injection is not a risk here, but a stray newline
 * or space would silently produce an unresolvable `--model` argument.
 */
export function parseModelRef(raw: unknown): ModelRef {
  if (typeof raw !== "string") return { ok: false, reason: "not-a-string" };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "blank" };
  // Any interior whitespace/control character (after trimming the edges).
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, reason: "whitespace" };

  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { ok: false, reason: "no-provider" };
  const provider = trimmed.slice(0, slash);
  const modelId = trimmed.slice(slash + 1);
  if (modelId === "") return { ok: false, reason: "no-model-id" };

  return { ok: true, provider, modelId, model: `${provider}/${modelId}` };
}

/**
 * Candidate values, in precedence order. Already-read values (not sources) so
 * the precedence logic stays pure and unit-testable; the I/O (plugin config,
 * dashboard config, env) lives at the plugin server entry.
 */
export interface SpawnModelSources {
  /** InvoiceBot plugin's own trusted config: `model`. */
  pluginConfigModel?: unknown;
  /** InvoiceBot plugin's own trusted config: `defaultModel` (key alias). */
  pluginConfigDefaultModel?: unknown;
  /** Dashboard `config.json#defaultModel`. */
  dashboardDefaultModel?: unknown;
  /** `IB_MODEL` environment variable. */
  envModel?: unknown;
}

/**
 * Resolve the model to pin on an InvoiceBot spawn, first VALID wins:
 *
 *   1. plugin config (`model`, else `defaultModel`)
 *   2. dashboard `config.json#defaultModel`
 *   3. `IB_MODEL`
 *   4. `undefined` → caller omits `model` → host default, unchanged
 *
 * A malformed candidate is warned about and SKIPPED so resolution continues down
 * the chain. It never throws: a typo'd config string must not stop an invoice
 * from being processed.
 */
export function resolveSpawnModel(sources: SpawnModelSources, logger?: WarnLogger): string | undefined {
  const candidates: Array<[string, unknown]> = [
    ["invoicebot plugin config", sources.pluginConfigModel ?? sources.pluginConfigDefaultModel],
    ["dashboard config defaultModel", sources.dashboardDefaultModel],
    ["IB_MODEL env", sources.envModel],
  ];

  for (const [origin, raw] of candidates) {
    // Absent/empty slots are not misconfiguration — skip them silently.
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) continue;

    const parsed = parseModelRef(raw);
    if (parsed.ok) return parsed.model;

    logger?.warn(
      `invoicebot spawn model from ${origin} is not a valid provider/modelId (${parsed.reason}): ${JSON.stringify(raw)} — skipping`,
    );
  }

  return undefined;
}
