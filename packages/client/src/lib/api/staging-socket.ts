/**
 * Staging WebSocket primitive.
 *
 * Opens a short-lived WebSocket to verify a target server is reachable
 * BEFORE the app commits to switching to it. The returned promise:
 *   - resolves with the open WebSocket on the first `onopen` event
 *   - rejects on error, close-before-open, or timeout
 *   - is single-settle: stray events after settlement are ignored
 *
 * On timeout, the helper calls `close()` on the socket to avoid leaks.
 * On success, the caller owns the socket (it is NOT closed by the helper).
 * On failure paths other than timeout, the socket is assumed closed by the
 * browser; the helper calls `close()` defensively (idempotent).
 *
 * Used by `handleServerSwitch` in `App.tsx` to make server switching
 * transactional — see change: safe-server-switch.
 */

export interface OpenStagingSocketOptions {
  /** Maximum wait before rejecting with "timed out". */
  timeoutMs: number;
}

export function openStagingSocket(
  url: string,
  opts: OpenStagingSocketOptions,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`Staging socket timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error("Staging socket error"));
    };

    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Staging socket closed before open"));
    };
  });
}
