/**
 * Core push notification types shared across push modules.
 * See change: add-server-push-notifications.
 */

/**
 * A Web Push subscription as received from the browser's
 * `PushSubscription.toJSON()`. Mirrors the PushSubscriptionJSON
 * interface from the Push API specification.
 */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * A persisted push token representing one device/browser.
 */
export interface PushToken {
  id: string;
  deviceToken: PushSubscriptionJSON;
  transport: string;
  userId?: string;
  registeredAt: string;
  lastUsedAt: string;
}

/**
 * Public-safe representation of a push token (no keys, truncated endpoint).
 */
export interface PushTokenMeta {
  id: string;
  transport: string;
  endpointLast4: string;
  registeredAt: string;
  lastUsedAt: string;
}

/**
 * Payload delivered to push services for display in a notification.
 */
export interface PushPayload {
  type: "session_attention";
  sessionId: string;
  title: string;
  body: string;
  url: string;
}

/**
 * Per-session push preferences, controlled by the bell toggle.
 * In-memory only — resets on server restart.
 */
export interface PushPrefs {
  notifyCompletion: "off" | "on" | "auto";
}
