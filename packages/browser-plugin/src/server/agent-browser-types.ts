/**
 * Shared, dependency-free types for the agent-browser policy modules
 * (`connect-policy`, `connect-handler`, `live-view`, `idle-sweep`). Every module
 * is pure and dependency-injected; the plugin entry wires the real manager.
 * See change: add-dedicated-agent-browser (D6, D7, D8).
 */

/** Built-in browser targets; every other target is a Chrome `profileDirectory`. */
export const DEDICATED_TARGET = "@dedicated";
export const HEADLESS_TARGET = "@headless";

export type OnUnavailable = "ask" | "next" | "stop";

/** The slice of the plugin config `browser_connect` reads. */
export interface ConnectPolicyConfig {
  defaultBrowser?: string;
  realProfile?: string;
  onUnavailable?: OnUnavailable;
  /** Default `true`. */
  openLiveViewOnConnect?: boolean;
}

/** One installed-profile row (a `ProfileSource` subset). */
export interface ProfileView {
  profileDirectory: string;
  label?: string;
  installed: boolean;
}

/** The slice of `status.dedicated` the policy reads. */
export interface DedicatedStatusView {
  available: boolean;
  reason?: string;
  /** Set while a live client-facing dedicated instance exists. */
  instanceId?: string;
  /** Session that holds the live instance. */
  holder?: string;
}

/** Result of a connect attempt (structurally a subset of `ConnectResult`). */
export type ConnectOutcome =
  | { ok: true; cdpUrl: string; instanceId: string }
  | { ok: false; reason?: string; status?: number; message?: string; instanceId?: string };

export interface ConnectPolicyDeps {
  /** The CALLING session, taken from the request lane's meta — never from the payload. */
  sessionId: string;
  config(): ConnectPolicyConfig;
  installedProfiles(): Promise<ProfileView[]> | ProfileView[];
  dedicatedStatus(): DedicatedStatusView;
  /** `holder` is recorded as the instance's holder. */
  connectDedicated(opts: { holder: string }): Promise<ConnectOutcome>;
  connectProfile(profileDirectory: string): Promise<ConnectOutcome>;
  /** Close an instance (dedicated: client-close rule; relay: `RelayManager.disconnect`). */
  disconnect(instanceId: string): void | Promise<void>;
  /** Remembers the calling session per instance for live view on connect (D7). */
  liveView?: { remember(instanceId: string, sessionId: string): void };
}

export interface ConnectAttempt {
  target: string;
  ok: boolean;
  reason?: string;
}

export interface ConnectOption {
  target: string;
  label: string;
  available: boolean;
  reason?: string;
}

export type BrowserConnectResult =
  | {
      browser: "dedicated" | "profile";
      profileDirectory?: string;
      instanceId: string;
      cdpUrl: string;
      liveView: boolean;
      attempts: ConnectAttempt[];
    }
  | { browser: "headless"; attempts: ConnectAttempt[] }
  | {
      unavailable: { target: string; reason: string };
      options: ConnectOption[];
      attempts: ConnectAttempt[];
    }
  | { unavailable: { target: string; reason: string }; stopped: true; attempts: ConnectAttempt[] };
