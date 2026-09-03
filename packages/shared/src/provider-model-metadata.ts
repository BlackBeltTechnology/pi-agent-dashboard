/**
 * Shared mapper for capability metadata advertised by a custom provider's
 * model list (`/v1/models`).
 *
 * ONE pure mapping function consumed by BOTH discovery surfaces — the
 * dashboard server (`package/provider-probe.ts` → `model-proxy/custom-provider-discovery.ts`)
 * and the bridge extension (`provider-register.ts`) — so the two cannot diverge
 * on which fields are adopted or how they are validated.
 *
 * Mapping is keyed on the RESPONSE SHAPE, not the provider's configured `api`:
 * the verified 9router provider is configured `anthropic-messages` yet returns
 * an OpenAI-style `{ data: [...] }` body. This mirrors `extractModelIds`, which
 * already branches on `body.data` / `body.models`.
 *
 * Every field is adopted only when present and well-typed; a numeric capacity
 * field must be a finite number > 0. There is NO upper sanity bound — the
 * provider is authoritative for what its route serves. A field that fails
 * validation is treated as NOT advertised, so the caller's api-typed floor
 * applies for that field alone (per-field fallback).
 *
 * Deliberately NOT mapped:
 *   - `capabilities.pdf`/`audioInput`/`videoInput`/`imageOutput`/`audioOutput`/
 *     `search` — no representation in the `input` type; dropped rather than
 *     widening it.
 *   - `capabilities.thinkingFormat`/`thinkingCanDisable`/`thinkingRange` — a
 *     `thinkingRange: null` does not determine a `thinkingLevelMap`, and
 *     guessing one risks replacing "no thinking levels" with "wrong thinking
 *     levels". `reasoning` alone restores level availability.
 *   - `capabilities.tools` and Google's `supportedGenerationMethods` — no
 *     consumer and no field on the model shape.
 *
 * See change: fix-custom-provider-model-metadata (design D2/D3/D4/D5).
 */

export type InputModality = "text" | "image";

/** Capability fields a provider advertised. An absent key = not advertised. */
export interface AdvertisedModelMetadata {
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: InputModality[];
}

/** One model from a provider's list, with whatever capability data it advertised. */
export interface DiscoveredModelRecord {
  id: string;
  owned_by?: string;
  advertised: AdvertisedModelMetadata;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** A capacity value counts only when it is a finite number greater than zero. */
function positiveNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function boolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** OpenAI-ish entry: top-level scalars win over their `capabilities` twins. */
function mapOpenAiEntry(m: Record<string, unknown>): DiscoveredModelRecord | null {
  if (typeof m.id !== "string") return null;
  const caps = isRecord(m.capabilities) ? m.capabilities : undefined;

  const advertised: AdvertisedModelMetadata = {};
  const contextWindow = positiveNumber(m.context_length) ?? positiveNumber(caps?.contextWindow);
  if (contextWindow !== undefined) advertised.contextWindow = contextWindow;
  const maxTokens = positiveNumber(m.max_completion_tokens) ?? positiveNumber(caps?.maxOutput);
  if (maxTokens !== undefined) advertised.maxTokens = maxTokens;
  const reasoning = boolean(caps?.reasoning);
  if (reasoning !== undefined) advertised.reasoning = reasoning;
  const vision = boolean(caps?.vision);
  if (vision !== undefined) advertised.input = vision ? ["text", "image"] : ["text"];

  return {
    id: m.id,
    ...(typeof m.owned_by === "string" ? { owned_by: m.owned_by } : {}),
    advertised,
  };
}

/** Google-ish entry: `models/<id>` name plus token limits. */
function mapGoogleEntry(m: Record<string, unknown>): DiscoveredModelRecord | null {
  if (typeof m.name !== "string") return null;
  const advertised: AdvertisedModelMetadata = {};
  const contextWindow = positiveNumber(m.inputTokenLimit);
  if (contextWindow !== undefined) advertised.contextWindow = contextWindow;
  const maxTokens = positiveNumber(m.outputTokenLimit);
  if (maxTokens !== undefined) advertised.maxTokens = maxTokens;
  return { id: m.name.replace(/^models\//, ""), advertised };
}

/**
 * Map a provider model-list body to per-model records carrying every advertised
 * capability field. Returns [] for any unrecognized/malformed body — never
 * throws, so a bad provider degrades to "no models" exactly as today.
 */
export function mapAdvertisedModels(body: unknown): DiscoveredModelRecord[] {
  if (!isRecord(body)) return [];
  // OpenAI-style { data: [{ id, ... }] }
  if (Array.isArray(body.data)) {
    return body.data
      .filter(isRecord)
      .map(mapOpenAiEntry)
      .filter((r): r is DiscoveredModelRecord => r !== null);
  }
  // Google-style { models: [{ name: "models/gemini-...", ... }] }
  if (Array.isArray(body.models)) {
    return body.models
      .filter(isRecord)
      .map(mapGoogleEntry)
      .filter((r): r is DiscoveredModelRecord => r !== null);
  }
  return [];
}

/**
 * True when every capability field a consumer projects came from the provider.
 * Drives `metadataSource`: a model missing any field falls back for it, and is
 * reported by its WEAKEST adopted tier so a floor value is never presented as
 * confirmed. See change: fix-custom-provider-model-metadata (design D6).
 */
export function isFullyAdvertised(advertised: AdvertisedModelMetadata): boolean {
  return (
    advertised.contextWindow !== undefined &&
    advertised.maxTokens !== undefined &&
    advertised.reasoning !== undefined &&
    advertised.input !== undefined
  );
}
