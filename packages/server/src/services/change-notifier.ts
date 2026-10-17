/**
 * Leading + trailing coalescer for the content-free `services_changed` ping:
 * the first change fires at once, further changes inside the window collapse
 * into ONE trailing fire when the window closes (so the last change is always
 * announced), and the trailing fire opens a fresh window — so at most one fire
 * happens per `windowMs`, always.
 * See change: add-services-settings-ui (D3).
 */
export const CHANGE_COALESCE_MS = 500;

export interface ChangeCoalescer {
  /** Register a change. */
  notify(): void;
  /** Cancel a pending trailing fire (shutdown). */
  dispose(): void;
}

export function createChangeCoalescer(fire: () => void, windowMs = CHANGE_COALESCE_MS): ChangeCoalescer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const safe = () => {
    try {
      fire();
    } catch (err) {
      console.warn(`[services] change hook failed: ${(err as Error).message}`);
    }
  };
  /** Open a window; when it closes, a trailing fire (if any change landed inside) opens the NEXT one. */
  const arm = () => {
    timer = setTimeout(() => {
      timer = undefined;
      if (!pending) return;
      pending = false;
      safe();
      arm(); // the trailing fire is itself a frame: no second one until another full window passes
    }, windowMs);
    timer.unref?.();
  };
  return {
    notify() {
      if (windowMs <= 0) return safe();
      if (timer) {
        pending = true;
        return;
      }
      safe();
      arm();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}
