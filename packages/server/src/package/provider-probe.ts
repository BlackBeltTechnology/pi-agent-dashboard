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
  return out.length > MAX_ERROR_BODY_CHARS ? out.slice(0, MAX_ERROR_BODY_CHARS) : out;
}

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
export async function listProviderModelIds(input: ProbeInput): Promise<string[]> {
  let req: ProbeRequest;
  try {
    req = buildProbeRequest(input);
  } catch {
    return [];
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(req.url, { method: "GET", headers: req.headers, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return [];
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      return [];
    }
    return extractModelIds(body);
  } catch {
    clearTimeout(timer);
    return [];
  }
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
