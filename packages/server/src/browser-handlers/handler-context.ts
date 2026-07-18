/**
 * Shared context for browser message handlers.
 * Each handler receives only what it needs via this context.
 */
import type { WebSocket } from "ws";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { PendingForkRegistry } from "../pending/pending-fork-registry.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { DirectoryService } from "../directory-service.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";
import type { MetaPersistence } from "../persistence/meta-persistence.js";
import type { PendingResumeRegistry } from "../pending/pending-resume-registry.js";
import type { PendingAttachRegistry } from "../pending/pending-attach-registry.js";
import type { PendingInitialPromptRegistry } from "../pending/pending-initial-prompt-registry.js";
import type { PendingWorktreeBaseRegistry } from "../pending/pending-worktree-base-registry.js";
import type { PendingResumeIntentRegistry } from "../pending/pending-resume-intent-registry.js";
import type { PendingClientCorrelations } from "../pending/pending-client-correlations.js";

export interface BrowserHandlerContext {
  ws: WebSocket;
  sessionManager: SessionManager;
  eventStore: EventStore;
  piGateway: PiGateway;
  pendingForkRegistry?: PendingForkRegistry;
  sessionOrderManager?: SessionOrderManager;
  preferencesStore?: PreferencesStore;
  /**
   * Optional meta-persistence handle. Required for handlers that write
   * synchronously to a session's `.meta.json` outside the debounced
   * onChange path (currently: `setSessionDisplayPrefs`).
   * See change: configurable-chat-display.
   */
  metaPersistence?: MetaPersistence;
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
   * Optional pending-initial-prompt registry. Populated by the no-hook
   * Initialize button's spawn flow; consumed on `session_register` to
   * dispatch the first prompt (`/skill:project-init`) into the session.
   * See change: project-init-skill-and-profiles.
   */
  pendingInitialPromptRegistry?: PendingInitialPromptRegistry;
  /**
   * Optional pending-worktree-base registry. Populated by the
   * worktree dialog's spawn flow; consumed on `session_register` to
   * write `gitWorktreeBase` to the session's `.meta.json`.
   * See change: add-worktree-spawn-dialog.
   */
  pendingWorktreeBaseRegistry?: PendingWorktreeBaseRegistry;
  /**
   * Optional pending-resume-intent registry. Tagged when the user clicks
   * Resume / drags-to-resume / hits the REST resume endpoint, consumed by
   * `server.ts`'s `onChange` hook in the ended→alive branch to gate the
   * sessionOrder mutation behind explicit user intent.
   * See change: preserve-session-order-on-reboot.
   */
  pendingResumeIntents?: PendingResumeIntentRegistry;
  /**
   * Optional registry mapping `spawnToken → requestId` for client-side
   * correlation. When set, browser-initiated spawns/resumes that carry a
   * `requestId` are recorded so the eventual `session_added` broadcast
   * carries `spawnRequestId` for auto-select / placeholder dismissal.
   * See change: spawn-correlation-token.
   */
  pendingClientCorrelations?: PendingClientCorrelations;
  /** Send message to a specific WebSocket */
  sendTo(ws: WebSocket, msg: ServerToBrowserMessage): void;
  /** Broadcast to all connected browsers */
  broadcast(msg: ServerToBrowserMessage): void;
  /**
   * Insert-and-broadcast a dashboard event into a session's chat stream
   * (same path as forwarded extension events). Used by inline-terminal
   * open/close so the card is event-sourced and replays on reload.
   * See change: add-inline-terminal-card.
   */
  broadcastEvent?(sessionId: string, seq: number, event: unknown): void;
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
