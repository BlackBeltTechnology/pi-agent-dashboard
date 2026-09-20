/**
 * Socket-less FAKE platform adapter — the harness fixture for the team-controls
 * L3 scenarios (test-plan note: "Discord REST/gateway is stubbed at every
 * level — no live-guild test").
 *
 * GUARDED, exactly like `PI_BROWSER_RELAY_FAKE` in the browser plugin: nothing
 * constructs this unless `PI_CHAT_GATEWAY_FAKE` is set, so a normal install
 * cannot reach it. It exists because the docker harness carries no Discord
 * credential — the plugin would otherwise be inert there, and five of the seven
 * L3 rows (F1, F2, F6, F7 and the mirror half of the rest) need a platform to
 * talk TO. Without one there is nothing to render and nothing to assert.
 *
 * Driven over the FILESYSTEM on purpose, NOT a new wire surface:
 *
 *   - a spec APPENDS a JSON line to `inbound.jsonl` to act as a chat user;
 *   - it READS `outbound.jsonl` to see what the layer posted (mirror frames,
 *     elision markers, refusal replies).
 *
 * A test-only plugin message would be production surface an install could
 * reach; a scratch file cannot be reached from a chat platform at all.
 *
 * The delegation answer reuses the REAL rule (`assignersForRole`) rather than a
 * simplified one: F1/F2 assert what the panel does with a genuine answer, so a
 * stub that answered by a different rule would prove nothing about the rule
 * that actually ships.
 */

import fs from "node:fs";
import path from "node:path";
import type { DelegationAnswer } from "../server/team/surface.js";
import {
	type AdapterCallbacks,
	BaseAdapter,
	type ChannelOverwrite,
	type InteractivePrompt,
	type PlatformConfig,
	type PlatformMessage,
	type ProvisionChannelInput,
} from "./base.js";
import {
	assignersForRole,
	type MemberSummary,
} from "./discord-payload.js";

/**
 * `list` answers delegation with real assigners (F1). `nolist` reports it
 * UNAVAILABLE naming a missing permission (F2) — the platform half of "cannot
 * enumerate", which must never collapse to an empty roster.
 */
export type FakeMode = "list" | "nolist";

export interface FakeAdapterOptions {
	/** Scratch dir holding `inbound.jsonl` / `outbound.jsonl`. */
	dir: string;
	mode: FakeMode;
}

/** Poll interval for the inbound file. A spec's write is not synchronous with
 * the adapter, so the specs wait on the OBSERVED outbound effect, not on this. */
const INBOUND_POLL_MS = 50;

/**
 * Guild member roster. Deliberately three shapes:
 *
 *   - the OWNER always qualifies, whatever their position;
 *   - a NON-OWNER who can manage roles and sits above the target position —
 *     this is F1's "assignable by a non-owner member";
 *   - a bystander who can do neither, and must NOT appear (an over-eager stub
 *     would make the assertion vacuous).
 */
const OWNER_ID = "e2e_owner";
const MEMBERS: MemberSummary[] = [
	{ id: OWNER_ID, name: "E2E Owner", highestRolePosition: 10, canManageRoles: true },
	{ id: "e2e_delegator", name: "E2E Delegator", highestRolePosition: 5, canManageRoles: true },
	{ id: "e2e_bystander", name: "E2E Bystander", highestRolePosition: 0, canManageRoles: false },
];

/** Target position for every queried role: below the delegator, so the
 * delegator qualifies for any role the config maps. */
const TARGET_ROLE_POSITION = 1;

/** The missing permission `nolist` names. */
const MISSING_PERMISSION = "the Server Members intent";

/** One recorded outbound platform call. `kind` is the discriminator a spec
 * filters on. */
interface OutboundRecord {
	kind: "send" | "interactive" | "provision" | "overwrites" | "rename";
	channelId: string;
	content?: string;
	name?: string;
	overwrites?: ChannelOverwrite[];
}

export class FakeAdapter extends BaseAdapter {
	readonly platform = "fake";
	config: PlatformConfig = { enabled: true, platform: "fake" };

	private readonly dir: string;
	private readonly mode: FakeMode;
	private readonly outboundPath: string;
	private readonly inboundPath: string;
	private poll: ReturnType<typeof setInterval> | undefined;
	/** Lines of `inbound.jsonl` already emitted. */
	private consumed = 0;
	private sequence = 0;

	constructor(options: FakeAdapterOptions) {
		super();
		this.dir = options.dir;
		this.mode = options.mode;
		this.outboundPath = path.join(this.dir, "outbound.jsonl");
		this.inboundPath = path.join(this.dir, "inbound.jsonl");
	}

	/**
	 * Truncate both scratch files, then leave the adapter listening. Starting
	 * from empty is what makes a spec's assertions exact rather than
	 * "somewhere in the accumulated history" — the harness outlives one spec
	 * file, and every spec here reads the same two paths.
	 */
	async initialize(): Promise<void> {
		fs.mkdirSync(this.dir, { recursive: true });
		fs.writeFileSync(this.outboundPath, "");
		fs.writeFileSync(this.inboundPath, "");
	}

	async start(callbacks: AdapterCallbacks): Promise<void> {
		await super.start(callbacks);
		// Constructor-declared so it survives a restart of the plugin.
		this.poll = setInterval(() => {
			this.drainInbound();
		}, INBOUND_POLL_MS);
	}

	async stop(): Promise<void> {
		if (this.poll !== undefined) {
			clearInterval(this.poll);
			this.poll = undefined;
		}
		await super.stop();
	}

	/** Emit every line appended since the last drain. Malformed lines are
	 * skipped, not fatal — a spec may be mid-write. */
	private drainInbound(): void {
		let raw: string;
		try {
			raw = fs.readFileSync(this.inboundPath, "utf8");
		} catch {
			return;
		}
		const lines = raw.split("\n").filter((l) => l.length > 0);
		if (lines.length <= this.consumed) return;
		const fresh = lines.slice(this.consumed);
		this.consumed = lines.length;
		for (const line of fresh) {
			let parsed: { channelId?: string; userId?: string; content?: string };
			try {
				parsed = JSON.parse(line) as typeof parsed;
			} catch {
				continue;
			}
			if (typeof parsed.channelId !== "string" || typeof parsed.content !== "string") {
				continue;
			}
			const message: PlatformMessage = {
				id: `fake-in-${this.sequence++}`,
				platform: this.platform,
				channelId: parsed.channelId,
				userId: parsed.userId ?? "e2e_invoker",
				content: parsed.content,
				timestamp: Date.now(),
			};
			void this.emitMessage(message);
		}
	}

	private record(entry: OutboundRecord): void {
		fs.appendFileSync(this.outboundPath, `${JSON.stringify(entry)}\n`);
	}

	async sendMessage(channelId: string, content: string): Promise<string> {
		this.record({ kind: "send", channelId, content });
		return `fake-out-${this.sequence++}`;
	}

	async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
		this.record({ kind: "send", channelId, content });
		void messageId;
	}

	async deleteMessage(channelId: string, messageId: string): Promise<void> {
		void channelId;
		void messageId;
	}

	async setTyping(channelId: string, isTyping: boolean): Promise<void> {
		void channelId;
		void isTyping;
	}

	async getStatus(): Promise<{ connected: boolean; latency?: number }> {
		return { connected: true, latency: 0 };
	}

	async sendInteractive(
		channelId: string,
		prompt: InteractivePrompt,
	): Promise<{ messageId: string }> {
		this.record({ kind: "interactive", channelId, content: prompt.title });
		return { messageId: `fake-out-${this.sequence++}` };
	}

	async provisionChannel(input: ProvisionChannelInput): Promise<{ channelId: string }> {
		const channelId = `fake-channel-${this.sequence++}`;
		this.record({
			kind: "provision",
			channelId,
			name: input.name,
			overwrites: input.overwrites,
		});
		return { channelId };
	}

	async setChannelOverwrites(
		channelId: string,
		overwrites: ChannelOverwrite[],
	): Promise<void> {
		this.record({ kind: "overwrites", channelId, overwrites });
	}

	async renameChannel(channelId: string, name: string): Promise<void> {
		this.record({ kind: "rename", channelId, name });
	}

	/**
	 * Duck-typed delegation read, same signature as the Discord adapter's.
	 *
	 * `nolist` returns `unavailable` for EVERY role — never an empty `assigners`
	 * list, which the panel would render as "nobody can assign this" and which
	 * would therefore understate who holds the role.
	 */
	async assignersForRoles(
		guildId: string,
		roleIds: readonly string[],
	): Promise<Record<string, DelegationAnswer>> {
		void guildId;
		const out: Record<string, DelegationAnswer> = {};
		for (const roleId of roleIds) {
			out[roleId] =
				this.mode === "nolist"
					? { kind: "unavailable", missingPermission: MISSING_PERMISSION }
					: {
							kind: "assigners",
							members: assignersForRole(MEMBERS, {
								id: roleId,
								position: TARGET_ROLE_POSITION,
							}, OWNER_ID),
						};
		}
		return out;
	}
}

/** Where the fixture keeps `inbound.jsonl`/`outbound.jsonl` when the env
 * override is absent OR empty. */
const DEFAULT_FAKE_DIR = "/tmp/chat-gateway-fake";

/**
 * Build the fake from the environment, or `undefined` when the guard is unset.
 *
 * `PI_CHAT_GATEWAY_FAKE=1` → delegation lists assigners (F1).
 * `PI_CHAT_GATEWAY_FAKE=nolist` → delegation reports unavailable (F2).
 */
export function createFakeAdapterFromEnv(): FakeAdapter | undefined {
	const mode = process.env.PI_CHAT_GATEWAY_FAKE;
	if (mode !== "1" && mode !== "nolist") return undefined;
	// `||` not `??`: compose passes EMPTY STRING for an unset var, and `??` only
	// falls back on undefined/null — so `??` here yields `dir: ""` and the
	// fixture dies in `mkdir ''` (observed: "adapter failed to initialize —
	// gateway not started (Error: ENOENT: ... mkdir '')"). Empty and unset must
	// behave identically, because a spec sets NEITHER and still needs the dir.
	const override = process.env.PI_CHAT_GATEWAY_FAKE_DIR;
	return new FakeAdapter({
		dir: override !== undefined && override.length > 0 ? override : DEFAULT_FAKE_DIR,
		mode: mode === "nolist" ? "nolist" : "list",
	});
}
