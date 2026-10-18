/**
 * Live view on connect (change: add-dedicated-agent-browser, D7 / task 6.2).
 *
 * Remembers the calling session per instance (`remember`, called by
 * `resolveBrowserConnect` when `openLiveViewOnConnect` is on). The first
 * agent-created tab of the instance (`onTabCreated`) opens through the injected
 * `open` — wired to `OpenHandler.openAuto`, which is exempt from the 5 s rate
 * limit and audits `open` `auto`. Fires once per `remember`; a refused open is
 * retried on the next tab. `onTabCreated` must be called for AGENT-created tabs
 * only (not the connect page, not hidden sign-in tabs).
 */
export interface LiveViewDeps {
  /** May throw (refusal); the arming is kept so the next tab retries. */
  open(sessionId: string, instanceId: string, tabId: number): void;
}

export class LiveViewOnConnect {
  private readonly deps: LiveViewDeps;
  private readonly armed = new Map<string, string>();

  constructor(deps: LiveViewDeps) {
    this.deps = deps;
  }

  /** Armed instances (bounded by live instances once `forget` runs on close). */
  get size(): number {
    return this.armed.size;
  }

  remember(instanceId: string, sessionId: string): void {
    this.armed.set(instanceId, sessionId);
  }

  /** Call on instance close. */
  forget(instanceId: string): void {
    this.armed.delete(instanceId);
  }

  onTabCreated(instanceId: string, tabId: number): void {
    const sessionId = this.armed.get(instanceId);
    if (sessionId === undefined) return;
    try {
      this.deps.open(sessionId, instanceId, tabId);
    } catch {
      return; // refused: stay armed, retry on the next agent tab
    }
    this.armed.delete(instanceId);
  }
}
