/**
 * Generic webhook transport (Decision 9): POST the push payload as JSON to a
 * registered http(s) URL.
 *
 * - SSRF: `resolveAndVet` runs at EVERY delivery; the connection goes through
 *   a per-delivery undici `Agent` whose `connect.lookup` returns only the
 *   vetted addresses, closing the DNS-rebinding gap between check and connect.
 * - `undici.request` follows no redirects: a 3xx is a failure.
 * - Bounded: headers/body timeouts + `AbortSignal.timeout(timeoutMs)`.
 * - The response body is always discarded (`body.dump()`).
 * - Outcomes: 2xx → ok; 410 → gone; anything else (incl. 404) → failure.
 * - Never logs or returns the URL or a raw error: only `status` / `errorCode`
 *   travel back to the dispatcher, which logs them with the redacted target.
 * See change: add-server-push-notifications.
 */
import { Agent, request } from "undici";
import type { PushPayload, PushSendResult, PushToken, PushTransport } from "./types.js";
import { defaultLookupAll, effectivePort, type LookupAll, pinnedLookup, resolveAndVet, validateWebhookUrl } from "./webhook-url.js";

const WEBHOOK_TIMEOUT_MS = 5_000;

interface WebhookSendResult extends PushSendResult {
  status?: number;
  errorCode?: string;
}

function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "Error";
}

export function createWebhookTransport(opts: {
  selfPort: () => number | null;
  timeoutMs?: number;
  lookupAll?: LookupAll;
}): PushTransport {
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const lookupAll = opts.lookupAll ?? defaultLookupAll;

  async function send(token: PushToken, payload: PushPayload): Promise<WebhookSendResult> {
    const v = validateWebhookUrl(token.deviceToken);
    if (!v.ok) return { ok: false, errorCode: "INVALID_URL" };
    const url = v.url;
    const vet = await resolveAndVet(url.hostname, effectivePort(url), opts.selfPort(), lookupAll);
    if (!vet.ok) return { ok: false, errorCode: "BLOCKED_ADDRESS" };

    const agent = new Agent({
      connect: { lookup: pinnedLookup(vet.addresses), timeout: timeoutMs },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    try {
      const res = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const status = res.statusCode;
      try {
        await res.body.dump();
      } catch {
        /* body discard failure is irrelevant to the outcome */
      }
      if (status >= 200 && status < 300) return { ok: true, status };
      if (status === 410) return { ok: false, gone: true, status };
      return { ok: false, status };
    } catch (err) {
      return { ok: false, errorCode: errorCodeOf(err) };
    } finally {
      agent.destroy().catch(() => {});
    }
  }

  return { kind: "webhook", send };
}
