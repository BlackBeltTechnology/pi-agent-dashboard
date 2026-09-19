/**
 * Provider probe — ping a custom LLM provider's base URL + API key to verify the
 * combination is reachable and authenticated. Used by `POST /api/providers/test`
 * (client Test button) and re-used by the bridge's startup discovery path via
 * the same per-API request builders.
 *
 * Pure helpers first (`buildProbeRequest`, `resolveProbeApiKey`), then the
 * I/O-bearing `probeProvider`. All responses are scrubbed to never echo the
 * resolved api key.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type DiscoveredModelRecord,
  mapAdvertisedModels,
} from "@blackbelt-technology/pi-dashboard-shared/provider-model-metadata.js";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "providers.json");
const REDACTED = "***";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ERROR_BODY_CHARS = 500;
const SAMPLE_LIMIT = 5;

// -- Types ----------------------------------------------------------------

export type ProbeApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface ProbeInput {
  baseUrl: string;
  apiKey: string;
  api: ProbeApi;
  timeoutMs?: number;
}

export interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
}

export type ProbeResult =
  | { ok: true; status: number; modelCount: number; sample: string[] }
  | { ok: false; status?: number; error: string };

interface StoredProviderEntry {
  baseUrl: string;
  apiKey: string;
  api?: string;
}

// -- Pure: build per-API-type probe request --------------------------------

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function buildProbeRequest(input: {
  baseUrl: string;
  apiKey: string;
  api: ProbeApi;
}): ProbeRequest {
  const base = stripTrailingSlash(input.baseUrl);
  switch (input.api) {
    case "openai-completions":
    case "openai-responses":
      return {
        url: `${base}/models`,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
      };
    case "anthropic-messages":
      return {
        url: `${base}/v1/models`,
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      };
    case "google-generative-ai":
      return {
        url: `${base}/models?key=${encodeURIComponent(input.apiKey)}`,
        headers: {
          "Content-Type": "application/json",
        },
      };
    default:
      throw new Error(`Unsupported api type: ${String(input.api)}`);
  }
}

// -- Pure: resolve an apiKey value (literal / $ENV / *** REDACTED) --------

export type ProvidersReader = () => Record<string, StoredProviderEntry>;

export function readProvidersFromDisk(): Record<string, StoredProviderEntry> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return raw.providers ?? {};
  } catch {
    return {};
  }
}

export type ResolveResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

export function resolveProbeApiKey(args: {
  apiKey: string;
  name?: string;
  readProviders: ProvidersReader;
}): ResolveResult {
  let raw = args.apiKey;

  if (!raw) {
    return { ok: false, error: "apiKey is required" };
  }

  // REDACTED sentinel: look up the real key in providers.json by name
  if (raw === REDACTED) {
    if (!args.name) {
      return { ok: false, error: "No provider name given for saved API key lookup" };
    }
    const providers = args.readProviders();
    const entry = providers[args.name];
    if (!entry) {
      return { ok: false, error: `No saved API key for provider "${args.name}"` };
    }
    raw = entry.apiKey;
    if (!raw) {
      return { ok: false, error: `Stored API key for "${args.name}" is empty` };
    }
  }

  // $ENV_VAR indirection
  if (raw.startsWith("$")) {
    const envName = raw.slice(1);
    const value = process.env[envName];
    if (!value) {
      return { ok: false, error: `Environment variable ${envName} is not set` };
    }
    return { ok: true, key: value };
  }

  return { ok: true, key: raw };
}

// -- Helpers --------------------------------------------------------------

function redactErrorText(text: string, apiKey: string): string {
  // Belt-and-braces: never let the resolved api key leak back to the caller.
  let out = text;
  if (apiKey && out.includes(apiKey)) {
    out = out.split(apiKey).join("[REDACTED]");
  }
  // The SUBMITTED key is not the only credential that can appear here. This
  // text is cached into ProviderHealth, which the spec requires to carry no
  // credential material at all — and an upstream (or an intermediary proxy)
  // routinely echoes a DIFFERENT secret: the Authorization header it received,
  // a token in a redirect URL, an `api_key` query parameter. Strip those
  // shapes too, so the cached value is sanitized at ingestion rather than
  // trusting every upstream to be discreet.
  out = out.replace(CREDENTIAL_PATTERNS, (...args: unknown[]) => {
    // One alternative matches per hit, so exactly one capture group is defined;
    // keep that naming prefix and redact only the value behind it.
    const prefix = (args.slice(1, 4) as (string | undefined)[]).find((g) => g !== undefined) ?? "";
    return `${prefix}[REDACTED]`;
  });
  return out.length > MAX_ERROR_BODY_CHARS ? out.slice(0, MAX_ERROR_BODY_CHARS) : out;
}

/**
 * Credential shapes to strip from a probe error body before it is cached.
 * Each alternative captures the NAMING prefix and replaces only the value, so
 * the error stays diagnosable ("Bearer [REDACTED]" still says which mechanism
 * failed). Deliberately narrow: it targets labelled secrets, not every
 * high-entropy token, because over-broad redaction destroys the error's
 * diagnostic value — which is the whole reason the body is surfaced.
 */
const CREDENTIAL_PATTERNS = new RegExp(
  [
    // `Bearer <token>` / `Basic <blob>` in an echoed Authorization header.
    String.raw`(\b(?:Bearer|Basic)\s+)[\w\-._~+/]{8,}={0,2}`,
    // `"api_key": "..."`, `apiKey=...`, `access_token: ...` and friends.
    String.raw`((?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)["']?\s*[:=]\s*["']?)[\w\-._~+/]{8,}={0,2}`,
    // Vendor-prefixed keys that are self-identifying regardless of context.
    String.raw`(\b(?:sk|pk|rk|sk-proj|xoxb|ghp|gho|ghs|glpat)-)[\w\-]{12,}`,
  ].join("|"),
  "gi",
);

function extractModelIds(body: any): string[] {
  // OpenAI-style { data: [{ id }, ...] }
  if (body && Array.isArray(body.data)) {
    return body.data
      .filter((m: any) => m && typeof m.id === "string")
      .map((m: any) => m.id as string);
  }
  // Google-style { models: [{ name: "models/gemini-..." }] }
  if (body && Array.isArray(body.models)) {
    return body.models
      .filter((m: any) => m && typeof m.name === "string")
      .map((m: any) => (m.name as string).replace(/^models\//, ""));
  }
  return [];
}

// -- I/O: probe ----------------------------------------------------------

/**
 * Full model discovery: fetch the provider's model list and return EVERY model
 * id (not just a capped sample). Reuses `buildProbeRequest` so all four api
 * types hit the correct endpoint/headers. Returns [] on any failure (never
 * throws) so server-side registry discovery degrades gracefully.
 *
 * See change: add-agent-role-model-tools (server custom-provider registry).
 */
/**
 * Fetch a provider's model-list body and return the parsed JSON, or `null` on
 * any failure (bad request build, non-2xx, non-JSON body, network error,
 * timeout). Never throws. Shared by both `listProviderModelIds` (ids only, for
 * the Test button) and `listProviderModels` (metadata-preserving), so the two
 * cannot drift on request construction, timeout handling, or error semantics.
 * See change: fix-custom-provider-model-metadata (design D1).
 */
async function fetchProviderModelBody(input: ProbeInput): Promise<unknown | null> {
  let req: ProbeRequest;
  try {
    req = buildProbeRequest(input);
  } catch {
    return null;
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Clear in `finally` so the abort timer stays armed through `response.json()`:
  // a provider that stalls the response BODY (not just the headers) is still
  // aborted rather than hanging until the socket dies.
  try {
    const response = await fetch(req.url, { method: "GET", headers: req.headers, signal: controller.signal });
    if (!response.ok) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function listProviderModelIds(input: ProbeInput): Promise<string[]> {
  const body = await fetchProviderModelBody(input);
  return body === null ? [] : extractModelIds(body);
}

/**
 * Metadata-preserving model discovery: fetch the provider's model list and
 * return a record per model carrying the id AND every capability field the
 * provider advertised (mapped by RESPONSE SHAPE — see the shared mapper).
 *
 * Deliberately a SEPARATE function from `listProviderModelIds`: the Test button
 * (`probeProvider`) genuinely wants ids only, and widening one shared helper
 * would re-couple two consumers with different needs. Returns [] on any
 * failure (never throws) so one unreachable provider cannot break the
 * catalogue.
 *
 * See change: fix-custom-provider-model-metadata (design D1).
 */
export async function listProviderModels(input: ProbeInput): Promise<DiscoveredModelRecord[]> {
  const body = await fetchProviderModelBody(input);
  return body === null ? [] : mapAdvertisedModels(body);
}

export async function probeProvider(input: ProbeInput): Promise<ProbeResult> {
  let req: ProbeRequest;
  try {
    req = buildProbeRequest(input);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(req.url, {
      method: "GET",
      headers: req.headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      const excerpt = redactErrorText(
        bodyText || response.statusText || `HTTP ${response.status}`,
        input.apiKey,
      );
      return { ok: false, status: response.status, error: excerpt };
    }

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const ids = extractModelIds(body);
    return {
      ok: true,
      status: response.status,
      modelCount: ids.length,
      sample: ids.slice(0, SAMPLE_LIMIT),
    };
  } catch (err: any) {
    clearTimeout(timer);
    const message = err?.message ?? String(err);
    return { ok: false, error: redactErrorText(message, input.apiKey) };
  }
}
