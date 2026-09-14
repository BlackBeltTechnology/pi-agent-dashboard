/**
 * Test-only fake relay instance (change: add-browser-relay, task 2.10b /
 * design D9).
 *
 * The docker e2e harness has no Chrome, so every client-side behaviour that
 * needs a live instance — settings rows, tiles, subscribe/unsubscribe, the
 * no-frames overlay, viewer-input plumbing — would otherwise be unreachable in
 * CI. This seeds one socket-less instance with a single tab that emits a frame
 * on a timer.
 *
 * It is gated STRICTLY by the `PI_BROWSER_RELAY_FAKE=1` env var at activation
 * and is deliberately NOT configurable: a config flag would let a real
 * deployment turn on a fake instance, whereas an env var is a harness
 * decision. Unset → no fake instance, ever.
 */
import type { BrowserRelayFrameMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { AuditRing } from "../audit.js";
import type { RelaySocket } from "./extension-socket.js";
import type { RelayLogger, RelayTabView, RelayTimers } from "./relay-instance.js";

/** A valid 1×1 JPEG — enough for `<img src>` to render in the tile. */
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export const FAKE_FRAME_INTERVAL_MS = 100;
const FAKE_DEVICE_WIDTH = 64;
const FAKE_DEVICE_HEIGHT = 64;

export interface FakeRelayInstanceDeps {
  instanceId: string;
  profileDirectory?: string;
  audit: AuditRing;
  logger: RelayLogger;
  timers: RelayTimers;
  /**
   * Fired once when `close()` runs, mirroring `RelayInstance`'s contract so
   * the manager can drop the entry (e2e F3: the kill switch must leave the
   * Fake row showing "Not connected", not a stale "Connected").
   */
  onClosed?(reason: string): void;
}

export class FakeRelayInstance {
  readonly instanceId: string;
  readonly profileDirectory: string;
  private readonly viewers = new Map<number, Set<RelaySocket>>();
  private timer: unknown = undefined;
  private closed = false;

  constructor(private readonly deps: FakeRelayInstanceDeps) {
    this.instanceId = deps.instanceId;
    this.profileDirectory = deps.profileDirectory ?? "Fake";
    this._tick();
  }

  tabList(): RelayTabView[] {
    return [{ tabId: 1, title: "Fake tab", url: "https://fake.test/", state: "live" }];
  }

  statusState(): "connected" {
    return "connected";
  }

  subscribe(viewer: RelaySocket, tabId: number): { ok: boolean; state?: string } {
    if (tabId !== 1) return { ok: false, state: "detached" };
    let set = this.viewers.get(tabId);
    if (!set) {
      set = new Set();
      this.viewers.set(tabId, set);
    }
    set.add(viewer);
    this.deps.audit.append({
      profileDirectory: this.profileDirectory,
      instanceId: this.instanceId,
      kind: "viewer-subscribe",
      detail: `tab:${tabId}`,
    });
    // Send one frame immediately so a subscriber is never left waiting a full
    // interval with no visual feedback.
    this._sendFrame(tabId, set);
    return { ok: true };
  }

  unsubscribe(viewer: RelaySocket, tabId: number): void {
    const set = this.viewers.get(tabId);
    if (!set) return;
    set.delete(viewer);
    if (set.size === 0) this.viewers.delete(tabId);
  }

  unsubscribeAll(viewer: RelaySocket): void {
    for (const tabId of [...this.viewers.keys()]) this.unsubscribe(viewer, tabId);
  }

  /** The same kinds the real relay's viewer-input allowlist accepts. */
  private static readonly ALLOWED_INPUT_KINDS = new Set([
    "mouse",
    "key",
    "scroll",
    "bringToFront",
  ]);

  async input(_viewer: RelaySocket, tabId: number, msg: unknown): Promise<void> {
    const kind = (msg as { kind?: unknown } | undefined)?.kind;
    // Mirror the real allowlist: an unknown kind (e.g. `evaluate`) is DENIED,
    // not echoed as viewer-input, so the e2e audit-refresh scenario (F4) has a
    // deterministic `denied` row to observe.
    if (typeof kind !== "string" || !FakeRelayInstance.ALLOWED_INPUT_KINDS.has(kind)) {
      this.deps.audit.append({
        profileDirectory: this.profileDirectory,
        instanceId: this.instanceId,
        kind: "denied",
        detail: typeof kind === "string" ? kind : "unknown",
      });
      return;
    }
    // Echoed into the audit ring so the e2e audit-refresh scenario has a
    // deterministic row to observe (spec F4).
    this.deps.audit.append({
      profileDirectory: this.profileDirectory,
      instanceId: this.instanceId,
      kind: "viewer-input",
      detail: kind,
    });
    this._sendFrame(tabId, this.viewers.get(tabId) ?? new Set());
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.timers.clearTimeout(this.timer);
    this.viewers.clear();
    this.deps.onClosed?.(reason);
  }

  private _tick(): void {
    if (this.closed) return;
    for (const [tabId, set] of this.viewers) this._sendFrame(tabId, set);
    // Re-arm unconditionally: a one-shot timer would emit exactly one frame
    // after construction and then go silent (caught by the frame-rate test).
    this.timer = this.deps.timers.setTimeout(() => this._tick(), FAKE_FRAME_INTERVAL_MS);
  }

  private _sendFrame(tabId: number, set: Set<RelaySocket>): void {
    if (this.closed || set.size === 0) return;
    const frame: BrowserRelayFrameMessage = {
      type: "browser_relay_frame",
      instanceId: this.instanceId,
      tabId,
      jpegBase64: TINY_JPEG_BASE64,
      metadata: {
        deviceWidth: FAKE_DEVICE_WIDTH,
        deviceHeight: FAKE_DEVICE_HEIGHT,
        timestamp: Date.now(),
      },
    };
    const payload = JSON.stringify(frame);
    for (const viewer of set) {
      try {
        viewer.send(payload);
      } catch {
        /* a dead viewer is dropped on its close event */
      }
    }
  }
}
