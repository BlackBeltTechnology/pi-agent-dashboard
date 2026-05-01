/**
 * Shared context for browser message handlers.
 * Each handler receives only what it needs via this context.
 */
import type { WebSocket } from "ws";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { EventStore } from "../memory-event-store.js";
import type { PiGateway } from "../pi-gateway.js";
import type { PendingForkRegistry } from "../pending-fork-registry.js";
import type { SessionOrderManager } from "../session-order-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { DirectoryService } from "../directory-service.js";
import type { TerminalManager } from "../terminal-manager.js";
import type { HeadlessPidRegistry } from "../headless-pid-registry.js";
import type { PendingResumeRegistry } from "../pending-resume-registry.js";
import type { PendingAttachRegistry } from "../pending-attach-registry.js";
import type { PendingResumeIntentRegistry } from "../pending-resume-intent-registry.js";

export interface BrowserHandlerContext {
  ws: WebSocket;
  sessionManager: SessionManager;
  eventStore: EventStore;
  piGateway: PiGateway;
  pendingForkRegistry?: PendingForkRegistry;
  sessionOrderManager?: SessionOrderManager;
  preferencesStore?: PreferencesStore;
  directoryService?: DirectoryService;
  terminalManager?: TerminalManager;
  headlessPidRegistry: HeadlessPidRegistry;
  pendingResumeRegistry: PendingResumeRegistry;
  pendingDashboardSpawns?: Map<string, number>;
  /**
   * Optional pending-attach registry for spawn-with-attach flow.
   * See change: add-folder-task-checker-and-spawn-attach.
   */
  pendingAttachRegistry?: PendingAttachRegistry;
  /**
   * Optional pending-resume-intent registry. Tagged when the user clicks
   * Resume / drags-to-resume / hits the REST resume endpoint, consumed by
   * `server.ts`'s `onChange` hook in the ended→alive branch to gate the
   * sessionOrder mutation behind explicit user intent.
   * See change: preserve-session-order-on-reboot.
   */
  pendingResumeIntents?: PendingResumeIntentRegistry;
  /** Send message to a specific WebSocket */
  sendTo(ws: WebSocket, msg: ServerToBrowserMessage): void;
  /** Broadcast to all connected browsers */
  broadcast(msg: ServerToBrowserMessage): void;
  /** Get subscribers for a session */
  getSubscribers(sessionId: string): WebSocket[];
  /** Track UI request */
  trackUiRequest(sessionId: string, requestId: string, method: string, params: Record<string, unknown>): boolean | void;
  /** Replay pending UI requests to a browser */
  replayPendingUiRequests(ws: WebSocket, sessionId: string): void;
  /** Mark a session as mid-replay for a specific WebSocket (suppresses live events) */
  markReplaying(ws: WebSocket, sessionId: string): void;
  /** Clear replay flag and send catch-up events */
  clearReplaying(ws: WebSocket, sessionId: string, lastReplayedSeq: number): void;
}
