/**
 * Time-based device expiry has no event, so a 30 s sweep notices it: it keeps the last-seen set of
 * active device ids and calls `onLeft` only when a device LEFT that set since the previous sweep (a
 * transition), never on every tick. The interval is unref'd. Bound in the spec: expiry → denial ≤ 60 s.
 *
 * See change: prove-vault-bridge-tls (D6).
 */

export interface DeviceExpirySweepOptions {
  /** Ids of devices that are active now. */
  activeIds: () => ReadonlySet<string>;
  /** Called when at least one device left the active set since the previous sweep. */
  onLeft: () => void;
  intervalMs?: number;
}

const DEVICE_EXPIRY_SWEEP_MS = 30_000;

/** Start the sweep; returns its stop function. */
export function startDeviceExpirySweep(opts: DeviceExpirySweepOptions): () => void {
  let last = new Set(opts.activeIds());
  const timer = setInterval(() => {
    const now = opts.activeIds();
    let left = false;
    for (const id of last) {
      if (!now.has(id)) {
        left = true;
        break;
      }
    }
    last = new Set(now);
    if (left) opts.onLeft();
  }, opts.intervalMs ?? DEVICE_EXPIRY_SWEEP_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
