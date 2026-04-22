/**
 * Periodic polling of ragger server for workspace health and stats.
 * Broadcasts changes to connected browsers via WebSocket.
 */
import type { RaggerClient, RaggerHealth, RaggerWorkspaceStats } from "./ragger-client.js";
import type { BrowserGateway } from "../browser-gateway.js";

export interface RaggerPollerConfig {
	enabled: boolean;
	baseUrl: string;
	pollIntervalMs: number;
}

export interface RaggerCachedStatus {
	connected: boolean;
	workspaceCount: number;
	embeddingModel: string;
	model: string;
	workspaces: RaggerWorkspaceStats[];
	lastPolledAt: number;
}

export class RaggerPoller {
	private timer: ReturnType<typeof setInterval> | null = null;
	private cached: RaggerCachedStatus = {
		connected: false,
		workspaceCount: 0,
		embeddingModel: "",
		model: "",
		workspaces: [],
		lastPolledAt: 0,
	};

	constructor(
		private client: RaggerClient,
		private browserGateway: BrowserGateway,
		private config: RaggerPollerConfig,
	) {}

	start(): void {
		if (!this.config.enabled || this.timer) return;
		// Initial poll
		this.poll();
		this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs);
		console.log(`[ragger] Polling started (interval: ${this.config.pollIntervalMs}ms, url: ${this.config.baseUrl})`);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	getCached(): RaggerCachedStatus {
		return this.cached;
	}

	/** Force an immediate poll (e.g., after a user action) */
	async refresh(): Promise<RaggerCachedStatus> {
		await this.poll();
		return this.cached;
	}

	private async poll(): Promise<void> {
		try {
			const health = await this.client.getHealth();
			const wsResult = await this.client.listWorkspaces();
			const newStatus: RaggerCachedStatus = {
				connected: true,
				workspaceCount: health.workspace_count,
				embeddingModel: health.embedding_model,
				model: health.model,
				workspaces: wsResult.workspaces,
				lastPolledAt: Date.now(),
			};

			// Only broadcast if data changed
			if (JSON.stringify(newStatus) !== JSON.stringify(this.cached)) {
				this.cached = newStatus;
				this.broadcast();
			} else {
				this.cached.lastPolledAt = newStatus.lastPolledAt;
			}
		} catch {
			if (this.cached.connected) {
				// Only broadcast on state change (connected → disconnected)
				this.cached = {
					connected: false,
					workspaceCount: 0,
					embeddingModel: "",
					model: "",
					workspaces: [],
					lastPolledAt: Date.now(),
				};
				this.broadcast();
			}
		}
	}

	private broadcast(): void {
		this.browserGateway.broadcastToAll({
			type: "ragger_status_update",
			connected: this.cached.connected,
			workspaceCount: this.cached.workspaceCount,
			embeddingModel: this.cached.embeddingModel,
			model: this.cached.model,
			workspaces: this.cached.workspaces,
		} as any);
	}
}
