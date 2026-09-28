/**
 * W3C Web Push transport (VAPID-authenticated) via the `web-push` library.
 * `deviceToken` is the JSON of a browser `PushSubscription`; its endpoint is a
 * capability URL (a secret), so errors return only the status code — the
 * library's error message embeds the endpoint and is never logged.
 * 404/410 → gone (Decision 8).
 * See change: add-server-push-notifications.
 */
import webPush from "web-push";
import type { VapidKeys } from "../push-vapid.js";
import type { PushPayload, PushSendResult, PushToken, PushTransport } from "./types.js";

type SendNotification = (
  subscription: webPush.PushSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<unknown>;

const SEND_TIMEOUT_MS = 5_000;

export function createWebPushTransport(opts: {
  vapidKeys: VapidKeys;
  contactEmail: string;
  sendNotification?: SendNotification;
}): PushTransport {
  const send: SendNotification = opts.sendNotification ?? ((s, p, o) => webPush.sendNotification(s, p, o));
  const subject = opts.contactEmail.startsWith("mailto:") ? opts.contactEmail : `mailto:${opts.contactEmail}`;
  const vapidDetails = { subject, publicKey: opts.vapidKeys.publicKey, privateKey: opts.vapidKeys.privateKey };

  return {
    kind: "web-push",
    async send(token: PushToken, payload: PushPayload): Promise<PushSendResult & { status?: number; errorCode?: string }> {
      let subscription: webPush.PushSubscription;
      try {
        subscription = JSON.parse(token.deviceToken) as webPush.PushSubscription;
      } catch {
        return { ok: false, errorCode: "INVALID_TOKEN" };
      }
      try {
        await send(subscription, JSON.stringify(payload), { vapidDetails, TTL: 3600, timeout: SEND_TIMEOUT_MS });
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: unknown })?.statusCode;
        if (typeof status === "number") {
          if (status === 404 || status === 410) return { ok: false, gone: true, status };
          return { ok: false, status };
        }
        const code = (err as { code?: unknown })?.code;
        return { ok: false, errorCode: typeof code === "string" ? code : "Error" };
      }
    },
  };
}
