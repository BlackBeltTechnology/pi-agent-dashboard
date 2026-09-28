/**
 * Assemble the push subsystem when `push.enabled === true`: token registry,
 * VAPID keys, transports and dispatcher. Transport-init problems (no VAPID
 * contact email, unreadable FCM service account, corrupt registry file) are
 * collected in `errors` for `/api/health.push.errors`; they never throw.
 * Constructed ONLY by `server.ts` when push is enabled (Decision 6).
 * See change: add-server-push-notifications.
 */
import path from "node:path";
import type { PushConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createPushDispatcher, type PushDispatcher } from "./push-dispatcher.js";
import { createPushTokenRegistry, type PushTokenRegistry } from "./push-token-registry.js";
import { createFcmTransport } from "./push-transports/fcm.js";
import { consolePushLogger, type PushLogger, type PushTransport, type PushTransportKind } from "./push-transports/types.js";
import { createWebPushTransport } from "./push-transports/web-push.js";
import { createWebhookTransport } from "./push-transports/webhook.js";
import { type LookupAll, resolveAndVet, effectivePort, type VetResult } from "./push-transports/webhook-url.js";
import { loadOrGenerateVapidKeys } from "./push-vapid.js";

export const PUSH_TOKENS_FILE = "push-tokens.json";
export const PUSH_VAPID_FILE = "push-vapid.json";

export interface PushService {
  registry: PushTokenRegistry;
  dispatcher: PushDispatcher;
  vapidPublicKey: string;
  /** Config / transport-init problems, surfaced in `/api/health.push.errors`. */
  readonly errors: readonly string[];
  /** SSRF vet of a webhook URL, identical to the delivery-time check. */
  vetWebhook(url: URL): Promise<VetResult>;
  shutdown(): void;
}

export function createPushService(opts: {
  config: PushConfig;
  /** Directory holding `push-tokens.json` + `push-vapid.json` (production: `~/.pi/dashboard`). */
  dataDir: string;
  getSession: (sessionId: string) => DashboardSession | undefined;
  /** The dashboard's own listen port (self-target refusal); null before listen. */
  selfPort: () => number | null;
  logger?: PushLogger;
  lookupAll?: LookupAll;
  webhookTimeoutMs?: number;
  /** Test seam: replace individual transports. */
  transports?: Partial<Record<PushTransportKind, PushTransport>>;
  now?: () => number;
}): PushService {
  const logger = opts.logger ?? consolePushLogger;
  const registry = createPushTokenRegistry({ path: path.join(opts.dataDir, PUSH_TOKENS_FILE), now: opts.now });
  const errors: string[] = [...registry.errors];
  const vapid = loadOrGenerateVapidKeys(path.join(opts.dataDir, PUSH_VAPID_FILE));

  const transports: Partial<Record<PushTransportKind, PushTransport>> = {
    webhook: createWebhookTransport({ selfPort: opts.selfPort, timeoutMs: opts.webhookTimeoutMs, lookupAll: opts.lookupAll }),
  };
  const contactEmail = opts.config.webPush?.contactEmail;
  if (contactEmail) {
    transports["web-push"] = createWebPushTransport({ vapidKeys: vapid, contactEmail });
  } else {
    errors.push("web-push: disabled — push.webPush.contactEmail (VAPID contact) is not configured");
  }
  if (opts.config.fcm?.serviceAccountPath) {
    const fcm = createFcmTransport({ serviceAccountPath: opts.config.fcm.serviceAccountPath });
    if (fcm.ok) transports.fcm = fcm.transport;
    else errors.push(fcm.error);
  }
  Object.assign(transports, opts.transports);
  for (const e of errors) logger.error("push configuration problem", { error: e });

  const dispatcher = createPushDispatcher({
    registry,
    transports,
    coalesceWindowMs: opts.config.coalesceWindowMs,
    getSession: opts.getSession,
    logger,
    now: opts.now,
  });

  return {
    registry,
    dispatcher,
    vapidPublicKey: vapid.publicKey,
    errors,
    vetWebhook: (url) => resolveAndVet(url.hostname, effectivePort(url), opts.selfPort(), opts.lookupAll),
    shutdown: () => dispatcher.shutdown(),
  };
}
