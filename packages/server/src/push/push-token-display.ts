/**
 * Render a push token for API responses and log lines WITHOUT its secret.
 * webhook → `label (origin)` / `origin`; web-push → `<endpoint host> browser`
 * (the endpoint path is a capability URL); fcm → `fcm device`.
 * See change: add-server-push-notifications (Decisions 4, 9).
 */
import { redactWebhookUrl } from "./push-transports/webhook-url.js";
import type { PushToken } from "./push-transports/types.js";

export function displayPushToken(token: Pick<PushToken, "transport" | "deviceToken" | "label">): string {
  switch (token.transport) {
    case "webhook":
      return redactWebhookUrl(token.deviceToken, token.label);
    case "web-push": {
      let host = "unknown";
      try {
        const endpoint = (JSON.parse(token.deviceToken) as { endpoint?: unknown }).endpoint;
        if (typeof endpoint === "string") host = new URL(endpoint).host;
      } catch {
        /* keep placeholder */
      }
      return token.label ? `${token.label} (${host} browser)` : `${host} browser`;
    }
    case "fcm":
      return token.label ? `${token.label} (fcm device)` : "fcm device";
    default:
      return `${token.transport} token`;
  }
}
