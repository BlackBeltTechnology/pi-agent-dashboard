/**
 * Shared context for browser message handlers.
 * Each handler receives only what it needs via this context.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";
import type { DirectoryService } from "../directory-service.js";
import type { PendingAttachRegistry } from "../pending/pending-attach-registry.js";
import type { PendingClientCorrelations } from "../pending/pending-client-correlations.js";
import type { PendingForkRegistry } from "../pending/pending-fork-registry.js";
import type { PendingInitialPromptRegistry } from "../pending/pending-initial-prompt-registry.js";
import type { PendingResumeIntentRegistry } from "../pending/pending-resume-intent-registry.js";
import type { PendingResumeRegistry } from "../pending/pending-resume-registry.js";
import type { PendingWorktreeBaseRegistry } from "../pending/pending-worktree-base-registry.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { MetaPersistence } from "../persistence/meta-persistence.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";

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
  /**
   * Optional display-fit pool.
   *
   * Hydration strips inline image bytes to a bounded placeholder
   * UNCONDITIONALLY — the bound must not depend on whether a fitter happens to
   * be configured, or a replayed image-bearing event trips the per-event
   * ceiling and its row vanishes. This pool only decides how the placeholder
   * RESOLVES: with one, to the fitted derivative; without, every placeholder
   * settles to an explicit failed state rather than spinning.
   * See change: fit-attachments-for-display (test-plan #E9).
   */
  fitWorkerPool?: import("../attachments/fit-worker-pool.js").FitWorkerPool;
  /**
   * Max events replayed on a FULL-stream subscribe (0 / absent = unlimited).
   * Never applied to a genuine delta.
   * See change: lazy-load-session-history (D1).
   */
  maxReplayEvents?: number;
  /**
   * SHAPE of the replay window when one applies. Absent → `head-tail`.
   * See change: add-tail-only-replay-window (D1).
   */
  replayWindowMode?: import("@blackbelt-technology/pi-dashboard-shared/memory-limits.js").ReplayWindowMode;
  directoryService?: DirectoryService;
  terminalManager?: TerminalManager;
  headlessPidRegistry: HeadlessPidRegistry;
  pendingResumeRegistry: PendingResumeRegistry;
  /**
   * §5.4: resolve the bound scope env (e.g. invoicebot IB_TOOLSET/IB_INVOICE_ID)
   * to re-apply when auto-resuming a session's continue-spawn, so a resumed
   * scoped session boots scoped instead of on the full surface. Provided by a
   * plugin via `ctx.provide`; undefined for non-scoped sessions.
   * See change: make-invoice-session-canonical.
   */
  resumeSpawnEnv?: (sessionId: string) => Record<string, string> | undefined;
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
  /**
   * True while `sessionId` is an unresolved cold-start recovery candidate whose
   * process liveness is still being determined (the Class-2 bridge-reattach
   * grace window). A `continue` resume MUST be refused in this window: a
   * surviving bridge may be about to reattach, and spawning now would
   * double-register the session and break message routing. Finalized (dead)
   * candidates leave the pending set when the window closes.
   * See change: fix-recovery-offer-bridge-liveness-gate.
   */
  isRecoveryLivenessPending?(sessionId: string): boolean;
  /**
   * Remember that THIS connection asked for a subagent resync, so the bridge's
   * reply is delivered back to it instead of fanned out to every subscriber of
   * the session. Absent → the reply falls back to the broadcast path.
   * See change: reduce-subagent-details-payload (C5).
   */
  recordResyncRequester?(requestId: string, ws: WebSocket): void;
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
  /**
   * Replay the retained notify log to a browser. Sibling of
   * `replayPendingUiRequests` — kept separate because a notify is transcript
   * history, never a pending ask. See change: split-notify-from-prompt-request.
   */
  replayNotifyLog(ws: WebSocket, sessionId: string): void;
  /** Mark a session as mid-replay for a specific WebSocket (suppresses live events) */
  markReplaying(ws: WebSocket, sessionId: string): void;
  /** Clear replay flag and send catch-up events */
  clearReplaying(ws: WebSocket, sessionId: string, lastReplayedSeq: number): void;
}
