/**
 * In-memory `PlatformAdapter` — the adapter-level FAKE the test plan picks over
 * a live Discord guild for the F/X rows. Records every outbound call in order
 * and lets a test drive the inbound callbacks by hand.
 *
 * No `discord.js`, no network, no timers.
 *
 * See change: add-chat-gateway.
 */

import {
  type AdapterCallbacks,
  BaseAdapter,
  type ChannelOverwrite,
  type InteractivePrompt,
  type InteractiveResponse,
  type PlatformConfig,
  type PlatformMessage,
  type ProvisionChannelInput,
} from "../base.js";

/** One recorded provisioning call, for the call-sequence assertions. */
export interface RecordedProvisionCall {
  kind: "create-channel" | "set-overwrites" | "rename-channel";
  at: number;
  guildId?: string;
  channelId?: string;
  name?: string;
  overwrites?: ChannelOverwrite[];
}

export class RecordingAdapter extends BaseAdapter {
  readonly platform = "recording";
  config: PlatformConfig = { enabled: true, platform: "recording" };

  sent: Array<{ channelId: string; content: string; id: string }> = [];
  edited: Array<{ channelId: string; messageId: string; content: string }> = [];
  deleted: string[] = [];
  typing: Array<{ channelId: string; isTyping: boolean }> = [];
  interactive: Array<{ channelId: string; prompt: InteractivePrompt; messageId: string }> = [];
  cleaned: string[] = [];

  // ── Provisioning fixture (task 10i.1) ───────────────────────────────────

  /** EVERY provisioning call in order, with a timestamp — the call sequence. */
  provisionCalls: RecordedProvisionCall[] = [];
  /** Set to reject provisioning (a platform that cannot set overwrites). */
  failProvision: string | null = null;
  /** Set to reject an overwrite update (a reconciliation failure). */
  failOverwrites: string | null = null;
  /** Delay applied to `setChannelOverwrites`, to test synchronous revocation. */
  overwriteDelayMs = 0;
  /** Resolved by test control to hold an overwrite update open. */
  private releaseOverwrites: (() => void) | null = null;
  private nowMs = 1_000;

  private seq = 0;

  async sendMessage(channelId: string, content: string): Promise<string> {
    const id = this.nextId();
    this.sent.push({ channelId, content, id });
    return id;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    this.edited.push({ channelId, messageId, content });
  }

  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    this.deleted.push(messageId);
  }

  async setTyping(channelId: string, isTyping: boolean): Promise<void> {
    this.typing.push({ channelId, isTyping });
  }

  async getStatus(): Promise<{ connected: boolean; latency?: number }> {
    return { connected: this.running, latency: 0 };
  }

  async sendInteractive(
    channelId: string,
    prompt: InteractivePrompt,
  ): Promise<{ messageId: string }> {
    const messageId = this.nextId();
    this.interactive.push({ channelId, prompt, messageId });
    return { messageId };
  }

  async cleanupInteractive(_channelId: string, messageId: string): Promise<void> {
    this.cleaned.push(messageId);
  }

  // ── Provisioning ────────────────────────────────────────────────────────

  async provisionChannel(
    input: ProvisionChannelInput,
  ): Promise<{ channelId: string }> {
    if (this.failProvision) throw new Error(this.failProvision);
    const channelId = `c${++this.seq}`;
    this.provisionCalls.push({
      kind: "create-channel",
      at: (this.nowMs += 1),
      guildId: input.guildId,
      channelId,
      name: input.name,
      overwrites: input.overwrites.map((o) => ({ ...o })),
    });
    return { channelId };
  }

  async setChannelOverwrites(
    channelId: string,
    overwrites: ChannelOverwrite[],
  ): Promise<void> {
    if (this.overwriteDelayMs > 0) {
      await new Promise<void>((resolve) => {
        this.releaseOverwrites = resolve;
        setTimeout(resolve, this.overwriteDelayMs);
      });
      this.releaseOverwrites = null;
    }
    if (this.failOverwrites) throw new Error(this.failOverwrites);
    this.provisionCalls.push({
      kind: "set-overwrites",
      at: (this.nowMs += 1),
      channelId,
      overwrites: overwrites.map((o) => ({ ...o })),
    });
  }

  async renameChannel(channelId: string, name: string): Promise<void> {
    this.provisionCalls.push({
      kind: "rename-channel",
      at: (this.nowMs += 1),
      channelId,
      name,
    });
  }

  /** Release a held overwrite update early (with `overwriteDelayMs` set). */
  releaseHeldOverwrites(): void {
    this.releaseOverwrites?.();
    this.releaseOverwrites = null;
  }

  /** Only the provisioning calls of one kind — the create-then-patch assertion. */
  provisionCallsOfKind(kind: RecordedProvisionCall["kind"]): RecordedProvisionCall[] {
    return this.provisionCalls.filter((c) => c.kind === kind);
  }

  // ── Test drivers ────────────────────────────────────────────────────────

  /** Drive `callbacks.onMessage` as if the platform delivered `msg`. */
  async emitMessage(msg: PlatformMessage): Promise<void> {
    await super.emitMessage(msg);
  }

  /** Drive `callbacks.onInteractiveResponse` as if the user answered. */
  emitInteractiveResponse(resp: InteractiveResponse): void {
    this.callbacks?.onInteractiveResponse?.(resp);
  }

  /** Clear every recording (the registered callbacks are kept). */
  reset(): void {
    this.sent = [];
    this.edited = [];
    this.deleted = [];
    this.typing = [];
    this.interactive = [];
    this.cleaned = [];
    this.provisionCalls = [];
    this.failProvision = null;
    this.failOverwrites = null;
    this.overwriteDelayMs = 0;
    this.seq = 0;
  }

  /** The registered callbacks, for assertions. */
  get registered(): AdapterCallbacks | null {
    return this.callbacks;
  }

  private nextId(): string {
    this.seq += 1;
    return `m${this.seq}`;
  }
}
