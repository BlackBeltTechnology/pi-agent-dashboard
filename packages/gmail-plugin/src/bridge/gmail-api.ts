/**
 * Thin Gmail REST wrappers over `fetch` (design D6 — no `googleapis`).
 * One access token per instance (one lease per tool call). 429 / 5xx surface
 * as `rate_limited` / `gmail_unavailable` with Retry-After; NEVER retried here
 * (no retry storm). Error messages never include the token. 403 →
 * `api_disabled` / `scope_insufficient` / `gmail_error` from Google's `reason`
 * only (see change: improve-gmail-settings-ux).
 * See change: add-gmail-plugin.
 */
import { GmailToolError } from "./lease-client.js";

const GMAIL_TIMEOUT_MS = 30_000;

interface Header {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export class GmailApi {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/users/me/${pathAndQuery}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
      });
    } catch {
      throw new GmailToolError("gmail_unavailable", "gmail_unavailable: could not reach the Gmail API");
    }
    if (res.ok) {
      // batchModify / trash may answer 200 with an EMPTY body — not a failure.
      const text = await res.text();
      return (text.trim() ? JSON.parse(text) : {}) as T;
    }
    const retryAfter = res.headers.get("retry-after");
    const after = retryAfter && /^\d{1,6}$/.test(retryAfter) ? ` retry after ${retryAfter} s` : "";
    if (res.status === 429) {
      throw new GmailToolError("rate_limited", `rate_limited: Gmail rate-limited the request;${after || " retry later"}`);
    }
    if (res.status >= 500) {
      throw new GmailToolError("gmail_unavailable", `gmail_unavailable: Gmail returned ${res.status};${after || " retry later"}`);
    }
    if (res.status === 401) throw new GmailToolError("unauthorized", "unauthorized: Gmail rejected the access token");
    if (res.status === 404) throw new GmailToolError("not_found", "not_found: no such message, thread or attachment");
    if (res.status === 403) throw await classify403(res);
    throw new GmailToolError("gmail_error", `gmail_error: Gmail returned HTTP ${res.status}`);
  }

  list(q: string, maxResults: number) {
    const qs = new URLSearchParams({ q, maxResults: String(maxResults) });
    return this.call<{ messages?: { id: string; threadId: string }[] }>("GET", `messages?${qs}`);
  }

  getMessage(id: string, format: "full" | "metadata", metadataHeaders: string[] = []) {
    const qs = new URLSearchParams({ format });
    for (const h of metadataHeaders) qs.append("metadataHeaders", h);
    return this.call<GmailMessage>("GET", `messages/${encodeURIComponent(id)}?${qs}`);
  }

  getThread(id: string) {
    return this.call<{ id: string; messages?: GmailMessage[] }>("GET", `threads/${encodeURIComponent(id)}?format=full`);
  }

  labels() {
    return this.call<{ labels?: { id: string; name: string; type?: string }[] }>("GET", "labels");
  }

  attachment(messageId: string, attachmentId: string) {
    return this.call<{ data?: string; size?: number }>(
      "GET",
      `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  createDraft(raw: string, threadId?: string) {
    return this.call<{ id: string; message?: { id: string } }>("POST", "drafts", {
      message: threadId ? { raw, threadId } : { raw },
    });
  }

  send(raw: string, threadId?: string) {
    return this.call<{ id: string; threadId: string }>("POST", "messages/send", threadId ? { raw, threadId } : { raw });
  }

  modify(ids: string[], addLabelIds: string[], removeLabelIds: string[]) {
    return this.call<unknown>("POST", "messages/batchModify", { ids, addLabelIds, removeLabelIds });
  }

  trash(id: string) {
    return this.call<unknown>("POST", `messages/${encodeURIComponent(id)}/trash`);
  }
}

const GMAIL_403 = () => new GmailToolError("gmail_error", "gmail_error: Gmail returned HTTP 403");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const DISABLED = new Set(["SERVICE_DISABLED", "accessNotConfigured"]);
const SCOPE = new Set(["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions"]);

/**
 * Classify a Gmail 403 from Google's machine-readable `reason` ONLY (design
 * D9). Google's body is untrusted: every field is type-guarded, any throw
 * degrades to the generic `gmail_error`, and no body text (message,
 * activationUrl, "consumer" other than `projects/<digits>`) reaches the message.
 * See change: improve-gmail-settings-ux.
 */
async function classify403(res: Response): Promise<GmailToolError> {
  try {
    const body: unknown = JSON.parse(await res.text());
    const err = isObj(body) ? body.error : undefined;
    if (!isObj(err)) return GMAIL_403();
    // Modern shape: details[] ErrorInfo (reason + metadata); legacy: errors[].reason.
    const infos = (Array.isArray(err.details) ? err.details : []).filter(
      (d): d is Record<string, unknown> =>
        isObj(d) && typeof d["@type"] === "string" && d["@type"].endsWith("google.rpc.ErrorInfo") && typeof d.reason === "string",
    );
    const legacy = (Array.isArray(err.errors) ? err.errors : [])
      .map((e) => (isObj(e) && typeof e.reason === "string" ? e.reason : undefined))
      .filter((r): r is string => r !== undefined);

    const meta = (i: Record<string, unknown>) => (isObj(i.metadata) ? i.metadata : {});
    const forGmail = (i: Record<string, unknown>) => {
      const service = meta(i).service;
      return typeof service !== "string" || service === "gmail.googleapis.com";
    };
    const disabled = infos.find((i) => DISABLED.has(i.reason as string) && forGmail(i));
    if (disabled || legacy.some((r) => DISABLED.has(r))) {
      const consumer = disabled ? meta(disabled).consumer : undefined;
      const n = typeof consumer === "string" ? /^projects\/(\d{1,20})$/.exec(consumer)?.[1] : undefined;
      return new GmailToolError(
        "api_disabled",
        n
          ? `api_disabled: the Gmail API is disabled in Google Cloud project ${n}. Enable it: gcloud services enable gmail.googleapis.com --project=${n} (or APIs & Services \u2192 Library \u2192 Gmail API \u2192 Enable), then retry in a minute.`
          : "api_disabled: the Gmail API is disabled in the dashboard's Google Cloud project. Enable it: gcloud services enable gmail.googleapis.com --project=<your-project> (or APIs & Services \u2192 Library \u2192 Gmail API \u2192 Enable), then retry in a minute.",
      );
    }
    if (infos.some((i) => SCOPE.has(i.reason as string)) || legacy.some((r) => SCOPE.has(r))) {
      return new GmailToolError(
        "scope_insufficient",
        "scope_insufficient: the account's grant lacks the Gmail permission; re-authenticate it in Settings \u2192 Plugins \u2192 Gmail with every permission ticked.",
      );
    }
    return GMAIL_403();
  } catch {
    return GMAIL_403();
  }
}

/** Case-insensitive header lookup. */
export function header(part: GmailPart | undefined, name: string): string | undefined {
  const n = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function walk(part: GmailPart | undefined, visit: (p: GmailPart) => void): void {
  if (!part) return;
  visit(part);
  for (const p of part.parts ?? []) walk(p, visit);
}

/** Text body: first text/plain, else first text/html (flagged). */
export function extractBody(payload: GmailPart | undefined): { text: string; html: boolean } {
  let plain: string | undefined;
  let html: string | undefined;
  walk(payload, (p) => {
    if (p.filename) return;
    if (plain === undefined && p.mimeType === "text/plain" && p.body?.data) plain = decode(p.body.data);
    if (html === undefined && p.mimeType === "text/html" && p.body?.data) html = decode(p.body.data);
  });
  if (plain !== undefined) return { text: plain, html: false };
  if (html !== undefined) return { text: html, html: true };
  return { text: "", html: false };
}

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export function listAttachments(payload: GmailPart | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = [];
  walk(payload, (p) => {
    if (p.filename && p.body?.attachmentId) {
      out.push({
        attachmentId: p.body.attachmentId,
        filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        size: p.body.size ?? 0,
      });
    }
  });
  return out;
}
