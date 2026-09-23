/**
 * Per-plugin ledger of identity registrations (resolver, browser login
 * descriptor) so a plugin whose activation FAILED cannot leave them live
 * (design D21). The plugin loader tears down a failed plugin's WS routes but
 * knows nothing of identity registries; without this a login plugin that
 * registers its descriptor and then throws would arm enforcement with a dead
 * login flow — the exact self-lockout D21 prevents.
 */
export class IdentityRegistrationTracker {
  private readonly byPlugin = new Map<string, Array<() => void>>();
  private isFrozen = false;

  /** @param onIgnored called when a plugin invokes its handle after freeze(). */
  constructor(private readonly onIgnored: (pluginId: string) => void = () => {}) {}

  /** True once enforcement has been decided; registrations are then immutable until restart. */
  get frozen(): boolean {
    return this.isFrozen;
  }

  /**
   * Record a registration's unregister handle. Returns the handle the PLUGIN
   * receives: it disposes normally until freeze(), then becomes a reported
   * no-op — a runtime unregister must not change a latched plane (D21).
   */
  track(pluginId: string, dispose: () => void): () => void {
    const list = this.byPlugin.get(pluginId) ?? [];
    list.push(dispose);
    this.byPlugin.set(pluginId, list);
    return () => {
      if (this.isFrozen) {
        this.onIgnored(pluginId);
        return;
      }
      dispose();
    };
  }

  /** Latch: from now on plugin handles are no-ops (release already ran). */
  freeze(): void {
    this.isFrozen = true;
  }

  /** Dispose every registration of each plugin `isLoaded` rejects; returns their ids. */
  releaseUnloaded(isLoaded: (pluginId: string) => boolean): string[] {
    const released: string[] = [];
    for (const [pluginId, disposers] of this.byPlugin) {
      if (isLoaded(pluginId)) continue;
      for (const dispose of disposers) dispose();
      this.byPlugin.delete(pluginId);
      released.push(pluginId);
    }
    return released;
  }
}

/** Release failed plugins' identity registrations after load, logging each (D21). */
export function releaseFailedIdentityRegistrations(
  tracker: IdentityRegistrationTracker,
  isLoaded: (pluginId: string) => boolean,
  log: (msg: string) => void = (msg) => console.warn(msg),
): void {
  for (const id of tracker.releaseUnloaded(isLoaded)) {
    log(`[identity] plugin '${id}' failed to load; its resolver/login registrations were released`);
  }
}
