/**
 * One fetcher per supported provider. This is the plugin's OWN contract with
 * each provider's usage endpoint — no peer pi extension is involved.
 *
 * SECURITY: credentials arrive only through the host `AuthLike` seam (backed by
 * `ctx.providerAuth` + the model registry's OAuth-refreshing resolver). Tokens
 * are placed in headers only, never logged, and every failure message is
 * scrubbed by `http.ts` before it can travel.
 *
 * A provider is supported ONLY when its endpoint contract is fully known.
 * Deliberately NOT supported:
 *  - `opencode-go` — needs a workspace id + session cookie from a separate
 *    config file, i.e. a credential the dashboard does not hold.
 *  - `deepseek` / `minimax` — expose a wallet BALANCE, not a resetting quota
 *    window; there is no reset stamp to compute pace against.
 * Shipping those as permanently-empty rows would be a worse lie than omitting
 * them. See change: publish-quota-plugin.
 */
import type { QuotaWindowDto } from "../../types.js";
import { fetchJson } from "./http.js";
import { parseAnthropic, parseCodex, parseCopilot, parseKimi, parseOpenRouter, parseSynthetic, parseZai } from "./parse.js";

/** The host-provided credential seam. Mirrors the server plugin context. */
export interface AuthLike {
  get: (provider: string) => unknown;
  getApiKey: (provider: string) => Promise<string | undefined>;
}

/** Why a fetch produced no windows. Mirrors `QuotaUnavailableReason`. */
type FetchFailure = "no-credential" | "peer-rejected" | "no-data" | "no-adapter";

export type FetchResult =
  | { windows: QuotaWindowDto[]; failure?: undefined }
  | { windows?: undefined; failure: FetchFailure; detail?: string };

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Run a parse over a fetched endpoint, mapping every outcome onto FetchResult. */
async function get(
  url: string,
  headers: Record<string, string>,
  parse: (data: unknown) => QuotaWindowDto[],
  signal?: AbortSignal,
): Promise<FetchResult> {
  const res = await fetchJson(url, headers, signal);
  if (!res.ok) return { failure: "peer-rejected", detail: res.message };
  const windows = parse(res.data);
  return windows.length > 0 ? { windows } : { failure: "no-data" };
}

/**
 * A DIRECT Anthropic API key has no subscription usage to report, but an OAuth
 * subscription token does — and both start with `sk-ant-`.
 *
 * `@latentminds/pi-quotas` guarded on the bare `sk-ant-` prefix, which
 * misclassified the OAuth token `pi /login` issues (`sk-ant-oat01-...`) as a
 * direct API key and reported `not_applicable`. That is the root cause of
 * Anthropic never appearing through that peer. Only `sk-ant-api` is a direct
 * key; `sk-ant-oat` (OAuth Access Token) is exactly what this endpoint wants.
 */
export function isDirectAnthropicApiKey(token: string): boolean {
  return token.startsWith("sk-ant-api");
}

async function anthropic(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = await auth.getApiKey("anthropic");
  if (!token) return { failure: "no-credential" };
  if (isDirectAnthropicApiKey(token)) return { failure: "no-credential", detail: "direct API key has no subscription usage" };
  return get(
    "https://api.anthropic.com/api/oauth/usage",
    { ...bearer(token), "anthropic-beta": "oauth-2025-04-20" },
    parseAnthropic,
    signal,
  );
}

/** Codex needs the account id alongside the token; it lives on the credential. */
function codexAccountId(auth: AuthLike): string | undefined {
  const cred = auth.get("openai-codex") as { accountId?: unknown } | undefined;
  return typeof cred?.accountId === "string" ? cred.accountId : undefined;
}

async function openaiCodex(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = await auth.getApiKey("openai-codex");
  if (!token) return { failure: "no-credential" };
  const accountId = codexAccountId(auth);
  if (!accountId) return { failure: "no-credential", detail: "no Codex account id on the credential" };
  return get(
    "https://chatgpt.com/backend-api/wham/usage",
    { ...bearer(token), "ChatGPT-Account-Id": accountId, Origin: "https://chatgpt.com", Referer: "https://chatgpt.com/" },
    parseCodex,
    signal,
  );
}

const COPILOT_VERSION = "0.35.0";
const copilotHeaders = (authHeader: string): Record<string, string> => ({
  Authorization: authHeader,
  "User-Agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": `copilot-chat/${COPILOT_VERSION}`,
  "Copilot-Integration-Id": "vscode-chat",
});

/**
 * Copilot quota lives behind api.github.com, which requires the GitHub OAuth
 * token. pi stores that in the credential's `refresh` field — `access` holds a
 * Copilot proxy token that model calls accept but this endpoint rejects.
 */
async function githubCopilot(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const cred = auth.get("github-copilot") as { type?: unknown; refresh?: unknown } | undefined;
  const githubToken =
    cred?.type === "oauth" && typeof cred.refresh === "string" && cred.refresh ? cred.refresh : await auth.getApiKey("github-copilot");
  if (!githubToken) return { failure: "no-credential" };

  const url = "https://api.github.com/copilot_internal/user";
  // The endpoint accepts either scheme depending on token vintage; try both
  // before declaring failure.
  const asBearer = await fetchJson(url, copilotHeaders(`Bearer ${githubToken}`), signal);
  if (asBearer.ok) {
    const windows = parseCopilot(asBearer.data);
    return windows.length > 0 ? { windows } : { failure: "no-data" };
  }
  const asToken = await fetchJson(url, copilotHeaders(`token ${githubToken}`), signal);
  if (asToken.ok) {
    const windows = parseCopilot(asToken.data);
    return windows.length > 0 ? { windows } : { failure: "no-data" };
  }
  return { failure: "peer-rejected", detail: asBearer.message };
}

async function openrouter(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = await auth.getApiKey("openrouter");
  if (!token) return { failure: "no-credential" };
  return get("https://openrouter.ai/api/v1/key", bearer(token), parseOpenRouter, signal);
}

async function zai(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = await auth.getApiKey("zai");
  if (!token) return { failure: "no-credential" };
  return get("https://api.z.ai/api/monitor/usage/quota/limit", bearer(token), parseZai, signal);
}

async function kimiCoding(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = await auth.getApiKey("kimi-coding");
  if (!token) return { failure: "no-credential" };
  return get("https://api.kimi.com/coding/v1/usages", bearer(token), parseKimi, signal);
}

/**
 * Synthetic has no pi credential type; its key comes from the environment.
 * The peer required `SYNTHETIC_API_KEY` and reported a generic config error
 * when it was unset, which is why the row was silently empty.
 */
async function synthetic(auth: AuthLike, signal?: AbortSignal): Promise<FetchResult> {
  const token = (await auth.getApiKey("synthetic")) || process.env.SYNTHETIC_API_KEY;
  if (!token) return { failure: "no-credential", detail: "set SYNTHETIC_API_KEY" };
  return get("https://api.synthetic.new/v2/quotas", bearer(token), parseSynthetic, signal);
}

/** Every provider this plugin can serve, and how. */
export const PROVIDER_FETCHERS: Record<string, (auth: AuthLike, signal?: AbortSignal) => Promise<FetchResult>> = {
  anthropic,
  "openai-codex": openaiCodex,
  "github-copilot": githubCopilot,
  openrouter,
  zai,
  "kimi-coding": kimiCoding,
  synthetic,
};

/** Stable, sorted list of supported provider ids. */
export const SUPPORTED_PROVIDERS: string[] = Object.keys(PROVIDER_FETCHERS).sort();
