/**
 * Web Push transport adapter. Uses the `web-push` npm library to send
 * notifications via the W3C Web Push protocol with VAPID authentication.
 *
 * See change: add-server-push-notifications.
 */
import { createRequire } from "node:module";
import type { PushTransport } from "./types.js";
import type { PushToken, PushPayload } from "../push-types.js";
import type { VapidKeys } from "../push-vapid.js";

export interface WebPushTransportOptions {
  vapidKeys: VapidKeys;
  contactEmail: string;
}

const _require = createRequire(import.meta.url);

// Minimal type defs for web-push (CJS module, types not great).
interface WebPushModule {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string | null,
    options?: { TTL?: number },
  ): Promise<{ statusCode: number }>;
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
}

export function createWebPushTransport(opts: WebPushTransportOptions): PushTransport {
  // Lazy-import at creation time so the module doesn't fail to load
  // during vitest discovery when web-push isn't installed.
  const webpush = _require("web-push") as WebPushModule;

  // Configure VAPID — this is a one-time global set on the web-push module.
  // We set it per-transport creation because keys may differ.
  webpush.setVapidDetails(
    `mailto:${opts.contactEmail}`,
    opts.vapidKeys.publicKey,
    opts.vapidKeys.privateKey,
  );

  return {
    kind: "web-push",

    async send(
      token: PushToken,
      payload: PushPayload,
      opts?: { signal?: AbortSignal },
    ): Promise<{ ok: boolean; gone?: boolean }> {
      try {
        const pushSubscription = {
          endpoint: token.deviceToken.endpoint,
          keys: {
            p256dh: token.deviceToken.keys.p256dh,
            auth: token.deviceToken.keys.auth,
          },
        };

        // Build minimal notification payload
        const notificationPayload = JSON.stringify({
          title: payload.title,
          body: payload.body,
          icon: "/icon-192.png",
          badge: "/badge-72.png",
          data: {
            url: payload.url,
            sessionId: payload.sessionId,
          },
        });

        // Check if already aborted before making the request
        if (opts?.signal?.aborted) {
          return { ok: false };
        }

        await webpush.sendNotification(
          pushSubscription,
          notificationPayload,
          { TTL: 86400 },
        );

        return { ok: true };
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
        // 410 Gone or 404 Not Found → subscription is no longer valid
        if (statusCode === 410 || statusCode === 404) {
          return { ok: false, gone: true };
        }

        // Other failures (network error, 5xx, 400 bad request, etc.)
        return { ok: false };
      }
    },
  };
}
