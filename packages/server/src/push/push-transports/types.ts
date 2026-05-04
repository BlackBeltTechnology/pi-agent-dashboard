/**
 * Extensible push transport interface.
 * See change: add-server-push-notifications.
 */
import type { PushToken, PushPayload } from "../push-types.js";

export interface PushTransport {
  /** Unique identifier for this transport (e.g. "web-push"). */
  kind: string;

  /**
   * Send a push to a single device.
   *
   * @param token — the device token (contains endpoint + encryption keys)
   * @param payload — the notification payload
   * @param opts.signal — AbortSignal for cancellation (best-effort)
   *
   * @returns `{ok: true}` on success, `{ok: false, gone?: true}` on failure.
   *   `gone = true` means the subscription is expired/invalid and should be
   *   removed from the registry (HTTP 410, 404).
   */
  send(
    token: PushToken,
    payload: PushPayload,
    opts?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean; gone?: boolean }>;
}
