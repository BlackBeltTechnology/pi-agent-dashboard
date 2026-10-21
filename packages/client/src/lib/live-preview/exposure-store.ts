/**
 * Tiny external store for the server's `preview_exposure_changed {epoch}` push
 * (change: improve-canvas-html-and-url-ux, design D5). `useMessageHandler` calls
 * `notifyExposureChanged`; open viewers subscribe (via `useSyncExternalStore`),
 * re-read `/api/live-server/policy` and re-mint without scripts within 2 s.
 */
let pushedEpoch = 0;
const listeners = new Set<() => void>();

/** Record a pushed epoch. Older/duplicate epochs are ignored. */
export function notifyExposureChanged(epoch: number): void {
  if (!Number.isFinite(epoch) || epoch <= pushedEpoch) return;
  pushedEpoch = epoch;
  for (const l of [...listeners]) l();
}

export function subscribeExposure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Last pushed epoch (0 until the first push). */
export function getPushedExposureEpoch(): number {
  return pushedEpoch;
}

/** Test helper. */
export function resetExposureStore(): void {
  pushedEpoch = 0;
  listeners.clear();
}
