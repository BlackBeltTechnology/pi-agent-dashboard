// GENERIC pane clock (framework-free): a scripted pane's "now" starts at `clockAt`
// on every loop and advances in real time from there, so relative times render the
// same on every loop. See change: add-mock-site-exact-env (design D4).

export interface PaneClock {
  /** Current pane time (ms since epoch). */
  now(): number;
  /** Restart at the start instant (a new loop). */
  reset(): void;
}

/** Start instant: `clockAt` (ISO-8601) when given, else the page-load time. */
export function clockStart(clockAt: string | undefined, pageLoad: number): number {
  if (clockAt === undefined) return pageLoad;
  const t = Date.parse(clockAt);
  if (Number.isNaN(t)) throw new Error(`clockAt is not an ISO-8601 instant: ${clockAt}`);
  return t;
}

export function createClock(start: number, realNow: () => number = () => performance.timeOrigin + performance.now()): PaneClock {
  let t0 = realNow();
  return {
    now: () => start + (realNow() - t0),
    reset: () => { t0 = realNow(); },
  };
}

/** Replace the window's `Date` so `new Date()` / `Date.now()` follow the pane clock. */
export function installClock(win: Window & typeof globalThis, clock: PaneClock): void {
  const Real = win.Date;
  class MkDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.now());
      else super(...(args as [string | number | Date]));
    }
    static now(): number { return clock.now(); }
  }
  win.Date = MkDate as DateConstructor;
}
