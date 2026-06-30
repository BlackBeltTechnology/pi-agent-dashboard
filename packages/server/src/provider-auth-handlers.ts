/**
 * OAuth provider handlers for browser-based provider authentication.
 * Each handler encapsulates the flow for a specific pi provider.
 */
import crypto from "node:crypto";
import type { OAuthCredential } from "./provider-auth-storage.js";

// ── PKCE ─────────────────────────────────────────────────────────────────────

export interface PKCEPair {
  verifier: string;
  challenge: string;
}

export async function generatePKCE(): Promise<PKCEPair> {
  const verifierBytes = crypto.randomBytes(32);
  const verifier = verifierBytes.toString("base64url");
  const challengeBytes = crypto.createHash("sha256").update(verifier).digest();
  const challenge = challengeBytes.toString("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── Handler interfaces ───────────────────────────────────────────────────────

export interface AuthCodeHandler {
  flowType: "auth_code";
  providerId: string;
  /** Human-readable name surfaced to the UI. */
  displayName: string;
  /** Port registered with the OAuth provider for the redirect URI */
  callbackPort: number;
  /** Path registered with the OAuth provider for the redirect URI */
  callbackPath: string;
  buildAuthUrl(redirectUri: string, state: string, pkce: PKCEPair): string;
  exchangeCode(code: string, redirectUri: string, pkce: PKCEPair, state: string): Promise<OAuthCredential>;
}

export interface DeviceCodeHandler {
  flowType: "device_code";
  providerId: string;
  /** Human-readable name surfaced to the UI. */
  displayName: string;
  requestDeviceCode(enterpriseDomain?: string): Promise<DeviceCodeData>;
  pollForToken(deviceCode: string, interval: number, expiresIn: number, extra?: Record<string, unknown>): Promise<OAuthCredential>;
}

export interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  extra?: Record<string, unknown>;
}

export type ProviderHandler = AuthCodeHandler | DeviceCodeHandler;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function postJson(url: string, body: unknown, contentType: "json" | "form" = "json"): Promise<any> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let bodyStr: string;
  if (contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    bodyStr = new URLSearchParams(body as Record<string, string>).toString();
  } else {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(body);
  }
  const res = await fetch(url, { method: "POST", headers, body: bodyStr, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} returned ${res.status}: ${text}`);
  return JSON.parse(text);
}

function oauthExpires(expiresIn: number): number {
  return Date.now() + expiresIn * 1000 - 5 * 60 * 1000;
}

function decodeJwtPayload(token: string): any {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString()); } catch { return null; }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export const anthropicHandler: AuthCodeHandler = {
  flowType: "auth_code",
  providerId: "anthropic",
  displayName: "Anthropic (Claude Pro/Max)",
  callbackPort: 53692,
  callbackPath: "/callback",

  buildAuthUrl(redirectUri, state, pkce) {
    const params = new URLSearchParams({
      code: "true",
      client_id: ANTHROPIC_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: ANTHROPIC_SCOPES,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state,
    });
    return `${ANTHROPIC_AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode(code, redirectUri, pkce, state) {
    // Anthropic may embed state in code after #
    let authCode = code;
    let codeState = "";
    if (authCode.includes("#")) {
      const parts = authCode.split("#");
      authCode = parts[0];
      codeState = parts[1] || "";
    }
    const data = await postJson(ANTHROPIC_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: ANTHROPIC_CLIENT_ID,
      code: authCode,
      state: codeState || state,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    });
    return {
      type: "oauth" as const,
      refresh: data.refresh_token,
      access: data.access_token,
      expires: oauthExpires(data.expires_in),
    };
  },
};

// ── OpenAI Codex ─────────────────────────────────────────────────────────────

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_SCOPE = "openid profile email offline_access";

export const codexHandler: AuthCodeHandler = {
  flowType: "auth_code",
  providerId: "openai-codex",
  displayName: "ChatGPT Plus/Pro (Codex)",
  callbackPort: 1455,
  callbackPath: "/auth/callback",

  buildAuthUrl(redirectUri, state, pkce) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CODEX_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: CODEX_SCOPE,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "pi",
    });
    return `${CODEX_AUTHORIZE_URL}?${params}`;
  },

  async exchangeCode(code, redirectUri, pkce) {
    const data = await postJson(CODEX_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri,
    }, "form");
    const payload = decodeJwtPayload(data.access_token);
    const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
    return {
      type: "oauth" as const,
      refresh: data.refresh_token,
      access: data.access_token,
      expires: oauthExpires(data.expires_in),
      ...(accountId ? { accountId } : {}),
    };
  },
};

// ── GitHub Copilot (device code) ─────────────────────────────────────────────

const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

function githubUrls(domain: string) {
  return {
    deviceCode: `https://${domain}/login/device/code`,
    accessToken: `https://${domain}/login/oauth/access_token`,
    copilotToken: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

export const githubCopilotHandler: DeviceCodeHandler = {
  flowType: "device_code",
  providerId: "github-copilot",
  displayName: "GitHub Copilot",

  async requestDeviceCode(enterpriseDomain) {
    const domain = enterpriseDomain || "github.com";
    const urls = githubUrls(domain);
    const data = await postJson(urls.deviceCode, {
      client_id: GITHUB_CLIENT_ID,
      scope: "read:user",
    }, "form");
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
      extra: { domain },
    };
  },

  async pollForToken(deviceCode, interval, expiresIn, extra) {
    const domain = (extra?.domain as string) || "github.com";
    const urls = githubUrls(domain);
    const deadline = Date.now() + expiresIn * 1000;
    let pollMs = Math.max(1000, interval * 1000);

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const raw: any = await postJson(urls.accessToken, {
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }, "form");

      if (typeof raw.access_token === "string") {
        // Exchange GitHub token for Copilot token
        const copilotRes = await fetch(urls.copilotToken, {
          headers: { Accept: "application/json", Authorization: `Bearer ${raw.access_token}`, ...COPILOT_HEADERS },
        });
        if (!copilotRes.ok) throw new Error(`Copilot token exchange failed: ${copilotRes.status}`);
        const copilot: any = await copilotRes.json();
        const enterpriseUrl = domain !== "github.com" ? domain : undefined;
        return {
          type: "oauth" as const,
          refresh: raw.access_token,
          access: copilot.token,
          expires: copilot.expires_at * 1000 - 5 * 60 * 1000,
          ...(enterpriseUrl ? { enterpriseUrl } : {}),
        };
      }

      if (raw.error === "slow_down") {
        pollMs = typeof raw.interval === "number" ? raw.interval * 1000 : pollMs + 5000;
        continue;
      }
      if (raw.error === "authorization_pending") continue;
      if (raw.error) throw new Error(raw.error_description || raw.error);
    }
    throw new Error("Device code expired");
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const handlers = new Map<string, ProviderHandler>([
  ["anthropic", anthropicHandler],
  ["openai-codex", codexHandler],
  ["github-copilot", githubCopilotHandler],
]);

export function getProviderHandler(id: string): ProviderHandler | undefined {
  return handlers.get(id);
}

export function getAllHandlers(): ProviderHandler[] {
  return Array.from(handlers.values());
}
