/**
 * Hidden server-owned targets (change: add-dedicated-agent-browser, D4/D5, spec
 * "Sign-in window, hidden tabs and reset").
 *
 * `HiddenTargets` is the registry of targets an agent client must never see: tabs
 * the SERVER created (`dedicated/open` sign-in tabs) plus targets derived from
 * them (popups via `openerId`, frames via `parentFrameId`). It outlives any one
 * `DedicatedInstance` — a sign-in tab opened while no client is connected must
 * already be hidden when the next client attaches — so the manager owns ONE
 * registry per `DedicatedChrome` and hands it to every instance; call
 * `bindChrome(chrome)` once so Chrome's exit clears it. WebUI targets
 * (`chrome:` …) are NOT stored here: they are recomputed from the URL on every
 * change and so can become visible again.
 *
 * It also carries the create-hold the instance needs: `Target.createTarget`
 * answers AFTER Chrome's auto-attach event for the new tab, so while a hidden
 * create is in flight (`pending > 0`) the instance queues Chrome events and
 * drains them once the new target id is registered. Without it a sign-in tab
 * would be announced to the client for an instant.
 */
import { type PipeLike, pipeCall } from "./pipe-call.js";

export class HiddenTargets {
  private readonly owned = new Set<string>();
  private readonly derived = new Set<string>();
  private pendingCreates = 0;
  private readonly releaseListeners = new Set<() => void>();

  /** Hidden-create calls in flight (the instance holds Chrome events while > 0). */
  get pending(): number {
    return this.pendingCreates;
  }

  /** Register a server-created target. */
  addOwned(targetId: string): void {
    this.owned.add(targetId);
  }

  /** Register a target hidden because its opener/parent is hidden (sticky). */
  addDerived(targetId: string): void {
    this.derived.add(targetId);
  }

  /** Owned or derived (never WebUI — that is URL-computed). */
  isStickyHidden(targetId: string): boolean {
    return this.owned.has(targetId) || this.derived.has(targetId);
  }

  isOwned(targetId: string): boolean {
    return this.owned.has(targetId);
  }

  /** The target is gone. */
  forget(targetId: string): void {
    this.owned.delete(targetId);
    this.derived.delete(targetId);
  }

  clear(): void {
    this.owned.clear();
    this.derived.clear();
  }

  /** Clear on Chrome's exit (targets die with it). Returns the unsubscribe. */
  bindChrome(chrome: Pick<PipeLike, "onExit">): () => void {
    return chrome.onExit(() => this.clear());
  }

  /** Open a create window. The returned `end` MUST be called (finally). */
  beginCreate(): () => void {
    this.pendingCreates += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.pendingCreates -= 1;
      if (this.pendingCreates === 0) for (const fn of [...this.releaseListeners]) fn();
    };
  }

  /** Called when the last in-flight create ends. */
  onRelease(cb: () => void): () => void {
    this.releaseListeners.add(cb);
    return () => this.releaseListeners.delete(cb);
  }
}

export interface OpenHiddenTabOptions {
  timeoutMs?: number;
  /** Open in this (ephemeral) browser context instead of the default one. */
  browserContextId?: string;
}

/**
 * Create a server-owned hidden tab: `Target.createTarget {url}` over the pipe,
 * register the id, THEN end the create window (so held events are classified
 * with the id known). Works with or without a live `DedicatedInstance`; with one
 * live prefer `instance.openHiddenTab` (adds the `open` audit and the URL checks).
 */
export async function openHiddenTab(
  chrome: PipeLike,
  registry: HiddenTargets,
  url: string,
  opts: OpenHiddenTabOptions = {},
): Promise<{ targetId: string }> {
  const end = registry.beginCreate();
  try {
    const result = (await pipeCall(
      chrome,
      "Target.createTarget",
      { url, ...(opts.browserContextId ? { browserContextId: opts.browserContextId } : {}) },
      { timeoutMs: opts.timeoutMs },
    )) as { targetId?: unknown } | undefined;
    const targetId = result?.targetId;
    if (typeof targetId !== "string" || targetId === "") throw new Error("Target.createTarget returned no targetId");
    registry.addOwned(targetId);
    return { targetId };
  } finally {
    end();
  }
}
