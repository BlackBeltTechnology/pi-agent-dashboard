/**
 * Firebase Cloud Messaging transport over the HTTP v1 API — no Firebase SDK
 * (Decision 3). A service-account JWT signed with `crypto.createSign
 * ('RSA-SHA256')` is exchanged for an OAuth access token, cached and refreshed
 * at 3500 s or on a 401 (one re-sign + retry). `NOT_FOUND` / `UNREGISTERED`
 * → gone. A missing or unreadable service-account file disables FCM (the
 * factory returns `{ok:false, error}`) instead of crashing the server.
 * See change: add-server-push-notifications.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { PushPayload, PushSendResult, PushToken, PushTransport } from "./types.js";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_AFTER_MS = 3_500_000;
const TIMEOUT_MS = 5_000;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

type FetchImpl = typeof fetch;

export type FcmTransportResult = { ok: true; transport: PushTransport } | { ok: false; error: string };

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function isGone(status: number, body: unknown): boolean {
  const e = (body as { error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> } } | null)?.error;
  if (e?.status === "NOT_FOUND") return true;
  if (Array.isArray(e?.details) && e.details.some((d) => d?.errorCode === "UNREGISTERED")) return true;
  return status === 404;
}

export function createFcmTransport(opts: {
  serviceAccountPath: string;
  fetchImpl?: FetchImpl;
  now?: () => number;
}): FcmTransportResult {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(fs.readFileSync(opts.serviceAccountPath, "utf-8")) as ServiceAccount;
  } catch {
    return { ok: false, error: "fcm: service-account file is missing or unreadable (push.fcm.serviceAccountPath)" };
  }
  if (!sa || typeof sa.project_id !== "string" || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    return { ok: false, error: "fcm: service-account file lacks project_id, client_email or private_key" };
  }
  const doFetch: FetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const sendUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  let cached: { accessToken: string; at: number } | null = null;

  function signJwt(): string {
    const iat = Math.floor(now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }));
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    return `${header}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
  }

  async function accessToken(force: boolean): Promise<string> {
    if (!force && cached && now() - cached.at < TOKEN_REFRESH_AFTER_MS) return cached.accessToken;
    const res = await doFetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt() }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw Object.assign(new Error("fcm token exchange failed"), { code: `FCM_TOKEN_${res.status}` });
    const body = (await res.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string") throw Object.assign(new Error("fcm token exchange failed"), { code: "FCM_TOKEN_SHAPE" });
    cached = { accessToken: body.access_token, at: now() };
    return cached.accessToken;
  }

  async function post(token: PushToken, payload: PushPayload, bearer: string): Promise<Response> {
    return doFetch(sendUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        message: {
          token: token.deviceToken,
          notification: { title: payload.title, body: payload.body },
          data: { type: payload.type, trigger: payload.trigger, sessionId: payload.sessionId, url: payload.url },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  const transport: PushTransport = {
    kind: "fcm",
    async send(token, payload): Promise<PushSendResult & { status?: number; errorCode?: string }> {
      try {
        let res = await post(token, payload, await accessToken(false));
        if (res.status === 401) {
          await res.body?.cancel().catch(() => {});
          res = await post(token, payload, await accessToken(true));
        }
        if (res.ok) {
          await res.body?.cancel().catch(() => {});
          return { ok: true, status: res.status };
        }
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* non-JSON error body */
        }
        if (isGone(res.status, body)) return { ok: false, gone: true, status: res.status };
        return { ok: false, status: res.status };
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        return { ok: false, errorCode: typeof code === "string" ? code : ((err as Error)?.name ?? "Error") };
      }
    },
  };
  return { ok: true, transport };
}
