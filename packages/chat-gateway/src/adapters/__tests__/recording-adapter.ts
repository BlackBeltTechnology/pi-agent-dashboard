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
  type InteractivePrompt,
  type InteractiveResponse,
  type PlatformConfig,
  type PlatformMessage,
} from "../base.js";

export class RecordingAdapter extends BaseAdapter {
  readonly platform = "recording";
  config: PlatformConfig = { enabled: true, platform: "recording" };

  sent: Array<{ channelId: string; content: string; id: string }> = [];
  edited: Array<{ channelId: string; messageId: string; content: string }> = [];
  deleted: string[] = [];
  typing: Array<{ channelId: string; isTyping: boolean }> = [];
  interactive: Array<{ channelId: string; prompt: InteractivePrompt; messageId: string }> = [];
  cleaned: string[] = [];

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
