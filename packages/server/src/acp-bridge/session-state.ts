/**
 * Pure per-session prompt state: the follow-up queue and the user-echo guard.
 *
 * - `PromptQueue`: prompts sent while a turn runs (including `delivery:"steer"`,
 *   which ACP has no concept of). Edit / remove / promote / clear act on it;
 *   dequeued one per idle transition.
 * - `EchoGuard`: ACP agents echo the user's message back. A dashboard-originated
 *   prompt already produced its user-turn events locally, so the echo must be
 *   dropped — whether it arrives before the `session/prompt` response (v2 early
 *   echo → HELD until acceptance names the message id) or after (suppressed by
 *   id), and for v1 (id-less chunks) for the whole active prompt.
 *
 * See change: add-acp-session-driver (D8).
 */
import type { AcpUpdate } from "@blackbelt-technology/pi-dashboard-shared/acp/update-model.js";
import type { FollowUpEntryView, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface QueuedPrompt {
  text: string;
  images?: ImageContent[];
  promptId?: string;
}

export class PromptQueue {
  private items: QueuedPrompt[] = [];

  get length(): number {
    return this.items.length;
  }

  enqueue(p: QueuedPrompt): void {
    this.items.push(p);
  }

  shift(): QueuedPrompt | undefined {
    return this.items.shift();
  }

  edit(index: number, text: string): boolean {
    const item = this.items[index];
    if (!item) return false;
    this.items[index] = { ...item, text };
    return true;
  }

  remove(index: number): boolean {
    if (!this.items[index]) return false;
    this.items.splice(index, 1);
    return true;
  }

  /** Move to the front so it is sent next. */
  promote(index: number): boolean {
    const item = this.items[index];
    if (!item) return false;
    this.items.splice(index, 1);
    this.items.unshift(item);
    return true;
  }

  clear(indices: number[] | "all"): void {
    if (indices === "all") this.items = [];
    else this.items = this.items.filter((_, i) => !indices.includes(i));
  }

  clearAll(): void {
    this.items = [];
  }

  view(): FollowUpEntryView[] {
    return this.items.map((i) => ({ text: i.text, imageCount: i.images?.length ?? 0 }));
  }
}

type UserUpdate = Extract<AcpUpdate, { kind: "user_message" | "user_message_chunk" }>;

export class EchoGuard {
  /** A dashboard prompt is written and not yet resolved (v1) / not yet accepted (v2). */
  private awaiting = false;
  /** v1: drop every user chunk for the whole active prompt. */
  private dropAllUntilResolved = false;
  private held: UserUpdate[] = [];
  private suppressedIds = new Set<string>();

  /** A dashboard prompt was just written. */
  begin(protocol: 1 | 2): void {
    this.awaiting = true;
    this.dropAllUntilResolved = protocol === 1;
    this.held = [];
  }

  /**
   * Route one user update. Returns `suppress` (mark id suppressed, then push),
   * `hold` (already stored; do not push yet) or `pass`.
   */
  route(u: UserUpdate): "suppress" | "hold" | "pass" {
    if (this.suppressedIds.has(u.messageId)) return "suppress";
    if (!this.awaiting) return "pass";
    if (this.dropAllUntilResolved) {
      this.suppressedIds.add(u.messageId);
      return "suppress";
    }
    this.held.push(u);
    return "hold";
  }

  /**
   * v2 acceptance (`{messageId}`): echoes of that id (held or later) are dropped;
   * other held user updates are released to the caller to push.
   */
  accepted(messageId: string | undefined): UserUpdate[] {
    this.awaiting = false;
    if (messageId) this.suppressedIds.add(messageId);
    const release = this.held.filter((u) => u.messageId !== messageId);
    this.held = [];
    return release;
  }

  /** v1 resolution / rejected prompt: the active window is over. */
  resolved(): UserUpdate[] {
    this.awaiting = false;
    this.dropAllUntilResolved = false;
    const release = this.held;
    this.held = [];
    return release;
  }
}
