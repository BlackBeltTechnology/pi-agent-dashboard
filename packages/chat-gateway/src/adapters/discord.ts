/**
 * Discord transport for the vendored `PlatformAdapter` contract.
 *
 * TRANSPORT ONLY (task 2.2): this file knows about Discord and nothing else —
 * it never starts a child process, never launches pi in rpc mode, and never
 * opens an HTTP/TCP listener. Routing, binding, authorization and the headless
 * dashboard client all live above the adapter seam.
 *
 * All payload decisions (which control, custom_id codec, 2000-char chunking)
 * live in the pure `discord-payload.ts` so they are testable without a socket.
 *
 * Replaces upstream `@gamalan/pi-gateway`'s `adapters/discord.ts` (ambient
 * WebSocket/fetch, token-prefix bot-id derivation, reconnect-timer leak on
 * `stop()`) — see `NOTICE`.
 *
 * See change: add-chat-gateway.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  type Message,
  ModalBuilder,
  Partials,
  type SendableChannels,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  type AdapterCallbacks,
  BaseAdapter,
  type InteractivePrompt,
  type PlatformConfig,
  type PlatformMessage,
} from "./base.js";
import {
  chunkForDiscord,
  customIdFor,
  type DiscordControlSpec,
  parseCustomId,
  toDiscordControl,
} from "./discord-payload.js";

export interface DiscordAdapterConfig extends PlatformConfig {
  platform: "discord";
  botToken: string;
  /**
   * Guild channel ids explicitly opted in. Empty/absent = every guild channel
   * is inert (DMs are unaffected). L4 isolation.
   */
  allowedChannels?: string[];
}

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;

export class DiscordAdapter extends BaseAdapter {
  readonly platform = "discord";
  config: DiscordAdapterConfig;

  private client: Client | null = null;
  /** Set BEFORE disconnecting so nothing re-arms a reconnect/heartbeat. */
  private stopped = false;
  private onMessageCreate: ((message: Message) => void) | null = null;
  private onInteractionCreate: ((interaction: Interaction) => void) | null = null;
  /** requestId → the control spec we rendered, for modal re-hydration. */
  private readonly specs = new Map<string, DiscordControlSpec>();

  constructor(config: DiscordAdapterConfig) {
    super();
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const token = this.config.botToken || this.config.token;
    if (!token) {
      throw new Error("[discord] no bot token configured — adapter stays inert");
    }
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
    this.client = client;
    this.stopped = false;

    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, () => resolve());
      // NEVER include the token in an error — it is a credential.
      client.login(token).catch((err: unknown) => {
        reject(
          new Error(
            `[discord] login failed (check the bot token and its intents): ${errText(err)}`,
          ),
        );
      });
    });
  }

  async start(callbacks: AdapterCallbacks): Promise<void> {
    await super.start(callbacks);
    const client = this.requireClient();

    this.onMessageCreate = (message: Message) => {
      void this.handleMessage(message);
    };
    this.onInteractionCreate = (interaction: Interaction) => {
      void this.handleInteraction(interaction);
    };
    client.on(Events.MessageCreate, this.onMessageCreate);
    client.on(Events.InteractionCreate, this.onInteractionCreate);
  }

  async stop(): Promise<void> {
    // Flag first: any in-flight handler/reconnect path sees a stopped adapter
    // before the socket goes away, so nothing re-arms itself.
    this.stopped = true;
    const client = this.client;
    if (client) {
      if (this.onMessageCreate) client.off(Events.MessageCreate, this.onMessageCreate);
      if (this.onInteractionCreate) client.off(Events.InteractionCreate, this.onInteractionCreate);
      client.removeAllListeners();
      try {
        await client.destroy();
      } catch {
        // Destroy is best-effort; a dead socket is still stopped.
      }
    }
    this.onMessageCreate = null;
    this.onInteractionCreate = null;
    this.client = null;
    this.specs.clear();
    await super.stop();
  }

  async getStatus(): Promise<{ connected: boolean; latency?: number }> {
    try {
      const client = this.client;
      if (!client || this.stopped || !client.isReady()) return { connected: false };
      const ping = client.ws.ping;
      return Number.isFinite(ping) && ping >= 0
        ? { connected: true, latency: ping }
        : { connected: true };
    } catch {
      return { connected: false };
    }
  }

  // ── Outbound ────────────────────────────────────────────────────────────

  async sendMessage(channelId: string, content: string): Promise<string> {
    const channel = await this.sendableChannel(channelId);
    const chunks = chunkForDiscord(content);
    if (chunks.length === 0) chunks.push("…");
    let messageId = "";
    for (const chunk of chunks) {
      const sent = await channel.send(chunk);
      messageId = sent.id;
    }
    // The LAST chunk is the live tail — streaming edits continue there.
    return messageId;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    const channel = await this.sendableChannel(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit(content);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.sendableChannel(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.delete();
  }

  async setTyping(channelId: string, isTyping: boolean): Promise<void> {
    // Discord has no "stop typing" — the indicator expires on its own.
    if (!isTyping) return;
    const channel = await this.sendableChannel(channelId);
    if ("sendTyping" in channel && typeof channel.sendTyping === "function") {
      await channel.sendTyping();
    }
  }

  // ── Interactive ─────────────────────────────────────────────────────────

  async sendInteractive(
    channelId: string,
    prompt: InteractivePrompt,
  ): Promise<{ messageId: string }> {
    const spec = toDiscordControl(prompt);
    this.specs.set(prompt.requestId, spec);

    if (spec.kind === "message") {
      return { messageId: await this.sendMessage(channelId, spec.content) };
    }

    const channel = await this.sendableChannel(channelId);

    if (spec.kind === "buttons" && spec.rows) {
      const components = spec.rows.map((row) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          row.map((button) =>
            new ButtonBuilder()
              .setCustomId(button.customId)
              .setLabel(button.label)
              .setStyle(BUTTON_STYLES[button.style]),
          ),
        ),
      );
      const sent = await channel.send({ content: spec.content, components });
      return { messageId: sent.id };
    }

    if (spec.kind === "string-select" && spec.select) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(spec.select.customId)
        .setMinValues(spec.select.min)
        .setMaxValues(spec.select.max)
        .addOptions(spec.select.options.map((o) => ({ label: o.label, value: o.value })));
      if (spec.select.placeholder) menu.setPlaceholder(spec.select.placeholder);
      const sent = await channel.send({
        content: spec.content,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      });
      return { messageId: sent.id };
    }

    // modal: a modal can only be shown in RESPONSE to an interaction, so post a
    // trigger button; its click opens the modal (`showModal`) in handleInteraction.
    const trigger = new ButtonBuilder()
      .setCustomId(spec.modal?.customId ?? customIdFor(prompt.requestId, "modal", prompt.method))
      .setLabel("Respond")
      .setStyle(ButtonStyle.Primary);
    const sent = await channel.send({
      content: spec.content,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(trigger)],
    });
    return { messageId: sent.id };
  }

  async cleanupInteractive(channelId: string, messageId: string): Promise<void> {
    // Cross-surface dismiss (F2): strip the controls. The message may already
    // be gone (deleted, channel gone, adapter stopped) — never throw from here.
    try {
      const channel = await this.sendableChannel(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.edit({ components: [] });
    } catch {
      // Already gone / unreachable: nothing to clean up.
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  private async handleMessage(message: Message): Promise<void> {
    if (this.stopped) return;
    // Bots (including ourselves) never drive the gateway.
    if (message.author?.bot) return;

    const channel = message.channel;
    const isDM = channel.isDMBased();
    if (!isDM) {
      const allowed = this.config.allowedChannels ?? [];
      if (allowed.length > 0) {
        const parentId = channel.isThread() ? (channel.parentId ?? undefined) : undefined;
        if (!allowed.includes(message.channelId) && !(parentId && allowed.includes(parentId))) {
          return;
        }
      }
    }

    const platformMessage: PlatformMessage = {
      id: message.id,
      platform: this.platform,
      channelId: message.channelId,
      userId: message.author.id,
      content: message.content,
      timestamp: message.createdTimestamp,
      metadata: {
        isDM,
        threadId: channel.isThread() ? message.channelId : undefined,
        parentChannelId: channel.isThread() ? (channel.parentId ?? undefined) : undefined,
        userName: message.author.username,
      },
    };
    await this.emitMessage(platformMessage);
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (this.stopped) return;
    try {
      if (interaction.isButton()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;

        if (parsed.kind === "modal") {
          const spec = this.specs.get(parsed.requestId);
          if (!spec?.modal) return;
          await interaction.showModal(buildModal(spec));
          return;
        }
        // Ack FIRST (Discord's hard 3s window), answer later via editReply —
        // so a slow pi round-trip never surfaces as "interaction failed" (F5).
        await interaction.deferUpdate();
        this.emitInteractive({
          requestId: parsed.requestId,
          value: parsed.value,
          confirmed: parsed.value === "yes",
          userId: interaction.user.id,
        });
        await safeEditReply(interaction, `${interaction.message.content}\n\n_→ ${parsed.value}_`);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await interaction.deferUpdate();
        const chosen = parseCustomId(interaction.values[0] ?? "");
        if (!chosen) return;
        this.emitInteractive({
          requestId: chosen.requestId,
          value: chosen.value,
          userId: interaction.user.id,
        });
        await safeEditReply(interaction, `${interaction.message.content}\n\n_→ ${chosen.value}_`);
        return;
      }

      if (interaction.isModalSubmit()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (interaction.isFromMessage()) await interaction.deferUpdate();
        else await interaction.deferReply({ ephemeral: true });
        const inputId = this.specs.get(parsed.requestId)?.modal?.inputs[0]?.customId;
        let value = "";
        try {
          if (inputId) value = interaction.fields.getTextInputValue(inputId);
        } catch {
          // Field missing (user submitted an empty optional input).
        }
        this.emitInteractive({
          requestId: parsed.requestId,
          value,
          userId: interaction.user.id,
        });
        await safeEditReply(interaction, "_Response received._");
      }
    } catch (err) {
      console.error("[discord] interaction handling failed:", errText(err));
    }
  }

  private emitInteractive(response: {
    requestId: string;
    value?: string;
    confirmed?: boolean;
    userId: string;
  }): void {
    this.callbacks?.onInteractiveResponse?.(response);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private requireClient(): Client {
    if (!this.client) throw new Error("[discord] adapter not initialized");
    return this.client;
  }

  private async sendableChannel(channelId: string): Promise<SendableChannels> {
    const channel = await this.requireClient().channels.fetch(channelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`[discord] channel ${channelId} is not sendable`);
    }
    return channel;
  }
}

function buildModal(spec: DiscordControlSpec): ModalBuilder {
  const modal = spec.modal;
  if (!modal) throw new Error("[discord] control spec has no modal");
  const builder = new ModalBuilder().setCustomId(modal.customId).setTitle(modal.title);
  for (const input of modal.inputs) {
    const field = new TextInputBuilder()
      .setCustomId(input.customId)
      .setLabel(input.label)
      .setStyle(input.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(input.required);
    if (input.placeholder) field.setPlaceholder(input.placeholder);
    if (input.prefill) field.setValue(input.prefill);
    builder.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field));
  }
  return builder;
}

async function safeEditReply(
  interaction: { editReply: (content: string) => Promise<unknown> },
  content: string,
): Promise<void> {
  try {
    await interaction.editReply(content);
  } catch {
    // The message may be gone; the response was already emitted.
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
