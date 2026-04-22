/**
 * HTTP client for the ragger FastAPI server.
 * Wraps all endpoints from the ragger REST API.
 */

export interface RaggerHealth {
	status: string;
	persist_directory: string;
	workspace_count: number;
	embedding_model: string;
	model: string;
	ollama: {
		reachable: boolean;
		base_url: string;
		models: string[];
		error?: string;
	};
}

export interface RaggerWorkspaceStats {
	workspace: string;
	root_path: string;
	collection_name: string;
	file_count: number;
	chunk_count: number;
	indexed_extensions: string[];
	indexed_files?: Array<{
		relative_path: string;
		source: string;
		extension: string;
		language: string;
		chunk_count: number | null;
	}>;
	last_indexed_at: string;
	embedding_model: string;
	model: string;
}

export interface RaggerSearchHit {
	source: string;
	relative_path: string;
	workspace: string;
	extension: string;
	language: string;
	score: number | null;
	content_preview: string;
	content: string;
}

export interface RaggerSearchResult {
	workspace: string;
	query: string;
	results: RaggerSearchHit[];
}

export class RaggerClient {
	private baseUrl: string;

	constructor(baseUrl: string = "http://127.0.0.1:8170") {
		this.baseUrl = baseUrl;
	}

	async getHealth(): Promise<RaggerHealth> {
		return this.fetchJson<RaggerHealth>("/health");
	}

	async listWorkspaces(): Promise<{ workspaces: RaggerWorkspaceStats[] }> {
		return this.fetchJson("/workspaces");
	}

	async getWorkspaceStats(name: string): Promise<RaggerWorkspaceStats> {
		return this.fetchJson<RaggerWorkspaceStats>(`/workspaces/${encodeURIComponent(name)}/stats`);
	}

	async indexWorkspace(workspace: string, path: string, replace: boolean = true): Promise<RaggerWorkspaceStats & { duration_seconds: number }> {
		return this.fetchJson("/workspaces/index", {
			method: "POST",
			body: JSON.stringify({ workspace, path, replace }),
		});
	}

	async search(workspace: string, query: string, k: number = 5): Promise<RaggerSearchResult> {
		return this.fetchJson("/workspaces/search", {
			method: "POST",
			body: JSON.stringify({ workspace, query, k }),
		});
	}

	async deleteWorkspace(name: string): Promise<{ workspace: string; deleted: boolean }> {
		return this.fetchJson(`/workspaces/${encodeURIComponent(name)}`, { method: "DELETE" });
	}

	async isReachable(): Promise<boolean> {
		try {
			const health = await this.getHealth();
			return health.status === "ok";
		} catch {
			return false;
		}
	}

	private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			...init,
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...(init?.headers ?? {}),
			},
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Ragger API ${response.status}: ${text}`);
		}
		return response.json() as Promise<T>;
	}
}
