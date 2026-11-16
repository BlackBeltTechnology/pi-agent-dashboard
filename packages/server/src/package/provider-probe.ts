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
import {
  defaultLookupAll,
  effectivePort,
  type LookupAll,
  resolveAndVet,
} from "../push/push-transports/webhook-url.js";

// Resolved per call (not at module load) so a changed HOME is honoured.
const configPath = (): string => join(homedir(), ".pi", "agent", "providers.json");
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

// -- Base URL validation, normalisation and egress vet ----------------------

export type BaseUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** A probe Base URL must be an absolute http(s) URL. Refused without a request otherwise. */
export function validateProbeBaseUrl(baseUrl: string): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, error: "Base URL is not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Base URL must use http or https" };
  }
  return { ok: true, url };
}

/**
 * Comparison form of a Base URL: lower-case scheme/host, default port elided,
 * exactly ONE trailing `/` stripped, query/fragment dropped. Userinfo and a
 * trailing-dot host are KEPT so they compare unequal. `null` when the value is
 * not an absolute URL.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const userinfo = url.username || url.password
    ? `${url.username}${url.password ? `:${url.password}` : ""}@`
    : "";
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol}//${userinfo}${url.host}${path}`;
}

let selfPortGetter: () => number | null = () => null;
let lookupAllImpl: LookupAll = defaultLookupAll;

/** Register the dashboard's own listen port (called once by `server.ts`). Unset → own-port rule skipped. */
export function setProbeSelfPort(getter: () => number | null): void {
  selfPortGetter = getter;
}

/** Test seam: replace the DNS lookup the egress vet uses. `null` restores the default. */
export function setProbeLookupAll(impl: LookupAll | null): void {
  lookupAllImpl = impl ?? defaultLookupAll;
}

export type ProbeVet = { ok: true } | { ok: false; error: string };

/**
 * Egress vet for a probe target: refuse a host that resolves to a link-local /
 * cloud-metadata address, or to the dashboard's own port on a local address.
 * The lookup is raced against `signal` (the probe's 8 s abort), so a stalled
 * resolver ends as `{ok:false,error}` instead of hanging. One `warn` per
 * refusal (host only — never the key, path or query).
 * See change: close-local-listener-and-egress-gaps (design D7).
 */
export async function vetProbeTarget(baseUrl: string, signal?: AbortSignal): Promise<ProbeVet> {
  const checked = validateProbeBaseUrl(baseUrl);
  if (!checked.ok) return checked;
  const { url } = checked;
  let onAbort: (() => void) | undefined;
  const stalled = new Promise<never>((_, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    onAbort = () => reject(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  stalled.catch(() => {}); // the race below observes it; never leave it unhandled
  try {
    const vet = await Promise.race([
      resolveAndVet(url.hostname, effectivePort(url), selfPortGetter(), lookupAllImpl, "provider"),
      stalled,
    ]);
    if (!vet.ok) {
      console.warn(`[provider-probe] refused provider target host=${url.hostname}: ${vet.error}`);
      return { ok: false, error: vet.error };
    }
    return { ok: true };
  } catch {
    console.warn(`[provider-probe] provider host lookup timed out host=${url.hostname}`);
    return { ok: false, error: "provider host lookup timed out" };
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

// -- Pure: resolve an apiKey value (literal / $ENV / *** REDACTED) --------

export type ProvidersReader = () => Record<string, StoredProviderEntry>;

export function readProvidersFromDisk(): Record<string, StoredProviderEntry> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw.providers ?? {};
  } catch {
    return {};
  }
}

export type ResolveResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

export const CHANGED_BASE_URL_ERROR = "Re-enter the API key to test a changed Base URL";
export const ENV_KEY_BINDING_ERROR = "Environment-variable keys can only be tested with the Base URL saved with them";

/**
 * `requestBaseUrl` is passed ONLY by the Test route (the caller there is
 * untrusted-ish): it binds a `***` / `$NAME` secret to the saved provider's
 * Base URL. Saved-provider probes and discovery pass none, so their key
 * resolution is unchanged. See change: close-local-listener-and-egress-gaps (D7).
 */
export function resolveProbeApiKey(args: {
  apiKey: string;
  name?: string;
  readProviders: ProvidersReader;
  requestBaseUrl?: string;
}): ResolveResult {
  let raw = args.apiKey;
  const requestNorm = args.requestBaseUrl === undefined ? undefined : normalizeBaseUrl(args.requestBaseUrl);
  const sameUrl = (saved: string | undefined): boolean =>
    requestNorm != null && saved != null && normalizeBaseUrl(saved) === requestNorm;

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
    if (args.requestBaseUrl !== undefined && !sameUrl(entry.baseUrl)) {
      return { ok: false, error: CHANGED_BASE_URL_ERROR };
    }
    raw = entry.apiKey;
    if (!raw) {
      return { ok: false, error: `Stored API key for "${args.name}" is empty` };
    }
  }

  // A request-supplied `$NAME` resolves only for a saved provider holding that
  // exact reference at the same Base URL (a `***` lookup was bound above).
  if (args.requestBaseUrl !== undefined && args.apiKey !== REDACTED && raw.startsWith("$")) {
    const bound = Object.values(args.readProviders()).some((p) => p.apiKey === raw && sameUrl(p.baseUrl));
    if (!bound) return { ok: false, error: ENV_KEY_BINDING_ERROR };
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
    // Vet BEFORE any request (shares the abort budget); a refused target yields no models.
    if (!(await vetProbeTarget(input.baseUrl, controller.signal)).ok) return null;
    // redirect: "error" — the credential header must never follow a redirect to another origin.
    // See change: triage-codeql-alert-debt (design D3 #19).
    const response = await fetch(req.url, { method: "GET", headers: req.headers, signal: controller.signal, redirect: "error" });
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
    // Vet BEFORE any request; the lookup shares the 8 s abort budget.
    const vet = await vetProbeTarget(input.baseUrl, controller.signal);
    if (!vet.ok) {
      clearTimeout(timer);
      return { ok: false, error: vet.error };
    }
    const response = await fetch(req.url, {
      method: "GET",
      headers: req.headers,
      signal: controller.signal,
      redirect: "error", // never forward the credential to a redirect target (D3 #19)
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
    // undici reports a refused redirect as `TypeError: fetch failed` with the reason in `cause`.
    const message = /redirect/i.test(String(err?.cause?.message ?? ""))
      ? "Provider answered with a redirect; probes do not follow redirects. Use the final URL as the base URL."
      : (err?.message ?? String(err));
    return { ok: false, error: redactErrorText(message, input.apiKey) };
  }
}
