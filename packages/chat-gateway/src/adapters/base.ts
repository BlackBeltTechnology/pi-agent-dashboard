/**
 * Platform Adapter Base - Interface for Hermes-style platform adapters
 */

// ── Interactive UI types ──────────────────────────────────────────────────

/** Platform-agnostic description of an interactive prompt from pi. */
export interface InteractivePrompt {
	requestId: string;
	method:
		| "select"
		| "confirm"
		| "input"
		| "editor"
		| "notify"
		| "setStatus"
		| "setWidget"
		| "setTitle"
		| "set_editor_text";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	notifyType?: "info" | "warning" | "error";
}

/** User's response to an interactive prompt. */
export interface InteractiveResponse {
	requestId: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

// ── Message types ─────────────────────────────────────────────────────────

export interface PlatformMessage {
	id: string;
	platform: string;
	channelId: string;
	userId: string;
	content: string;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export interface PlatformConfig {
	enabled: boolean;
	platform: string;
	token?: string;
	botToken?: string;
	webhookSecret?: string;
}

export interface AdapterCallbacks {
	onMessage: (message: PlatformMessage) => Promise<void>;
	onTyping?: (userId: string, isTyping: boolean) => void;
	onDisconnect?: () => void;
	/** Fired when a user responds to an interactive prompt (button click, reply). */
	onInteractiveResponse?: (response: InteractiveResponse) => void;
}

export interface PlatformAdapter {
	readonly platform: string;
	readonly config: PlatformConfig;

	/**
	 * Initialize the adapter
	 */
	initialize(): Promise<void>;

	/**
	 * Start listening for messages
	 */
	start(callbacks: AdapterCallbacks): Promise<void>;

	/**
	 * Stop listening
	 */
	stop(): Promise<void>;

	/**
	 * Send a message to a channel
	 */
	sendMessage(channelId: string, content: string): Promise<string>; // Returns message ID

	/**
	 * Edit an existing message
	 */
	editMessage(
		channelId: string,
		messageId: string,
		content: string,
	): Promise<void>;

	/**
	 * Delete a message
	 */
	deleteMessage(channelId: string, messageId: string): Promise<void>;

	/**
	 * Set typing indicator
	 */
	setTyping(channelId: string, isTyping: boolean): Promise<void>;

	/**
	 * Get adapter health status
	 */
	getStatus(): Promise<{ connected: boolean; latency?: number }>;

	/**
	 * Send an interactive prompt (select, confirm, input, etc.).
	 * Returns the platform-specific message ID for potential cleanup.
	 */
	sendInteractive(
		channelId: string,
		prompt: InteractivePrompt,
	): Promise<{ messageId: string }>;

	/**
	 * Clean up interactive elements from a message (remove buttons, etc.).
	 * Optional — only needed if the platform can't auto-expire interactions.
	 */
	cleanupInteractive?(channelId: string, messageId: string): Promise<void>;
}

/**
 * Abstract base class for adapters
 */
export abstract class BaseAdapter implements PlatformAdapter {
	abstract readonly platform: string;
	abstract config: PlatformConfig;
	protected callbacks: AdapterCallbacks | null = null;
	protected running = false;

	async initialize(): Promise<void> {
		// Override in subclass
	}

	async start(callbacks: AdapterCallbacks): Promise<void> {
		this.callbacks = callbacks;
		this.running = true;
	}

	async stop(): Promise<void> {
		this.running = false;
		this.callbacks = null;
	}

	/** Clean up interactive elements (remove buttons, etc.). No-op by default. */
	async cleanupInteractive(
		_channelId: string,
		_messageId: string,
	): Promise<void> {
		// Default: nothing to clean up
	}

	abstract sendMessage(channelId: string, content: string): Promise<string>;
	abstract editMessage(
		channelId: string,
		messageId: string,
		content: string,
	): Promise<void>;
	abstract deleteMessage(channelId: string, messageId: string): Promise<void>;
	abstract setTyping(channelId: string, isTyping: boolean): Promise<void>;
	abstract getStatus(): Promise<{ connected: boolean; latency?: number }>;

	/**
	 * Default interactive prompt — sends as text with instructions.
	 * Override in platform-specific adapters for native interactive UI.
	 */
	async sendInteractive(
		channelId: string,
		prompt: InteractivePrompt,
	): Promise<{ messageId: string }> {
		const text = formatGenericPrompt(prompt);
		// Skip empty notifications (e.g. widget/status clears with no content)
		if (!text) {
			return { messageId: "0" };
		}
		const messageId = await this.sendMessage(channelId, text);
		return { messageId };
	}

	protected emitMessage(message: PlatformMessage): Promise<void> {
		if (this.callbacks?.onMessage) {
			return this.callbacks.onMessage(message).catch((err) => {
				// Log but don't crash the adapter loop
				console.error(`[${this.platform}] Error in onMessage callback:`, err);
			}) as Promise<void>;
		}
		return Promise.resolve();
	}

	protected generateMessageId(): string {
		return `${this.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}

// ── Generic interactive prompt formatter (fallback for non-interactive platforms) ─┐

function formatGenericPrompt(prompt: InteractivePrompt): string {
	switch (prompt.method) {
		case "select": {
			const options = prompt.options || [];
			const numbered = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
			return `**${prompt.title}**\n\n${numbered}\n\n_Reply with the number of your choice._`;
		}
		case "confirm": {
			const msg = prompt.message ? `\n\n_${prompt.message}_` : "";
			return `**${prompt.title}**${msg}\n\n_Reply yes or no._`;
		}
		case "input":
		case "editor": {
			const hint = prompt.placeholder ? `\n\n_(${prompt.placeholder})_` : "";
			const pre = prompt.prefill
				? `\n\n\`\`\`\n${prompt.prefill}\n\`\`\`\n\n_Reply with your ${prompt.method === "editor" ? "changes" : "input"}._`
				: `\n\n_Reply with your ${prompt.method === "editor" ? "text" : "input"}._`;
			return `**${prompt.title}**${hint}${pre}`;
		}
		case "notify":
		case "setStatus":
		case "setWidget":
		case "setTitle":
		case "set_editor_text": {
			const text = prompt.message || prompt.title;
			// Skip if pi clears a widget/status with no content (e.g. setWidget(name, undefined))
			if (!text) {
				return "";
			}
			const icon =
				prompt.notifyType === "warning"
					? "⚠️"
					: prompt.notifyType === "error"
						? "❌"
						: "ℹ️";
			return `${icon} ${text}`;
		}
		default: {
			console.warn(
				`[base] Unknown interactive method "${prompt.method}", falling back to plain text`,
			);
			return `**${prompt.title}**${prompt.message ? `\n\n_${prompt.message}_` : ""}\n\n_Reply with your response._`;
		}
	}
}
