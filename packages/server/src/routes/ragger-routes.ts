/**
 * REST routes for proxying ragger API endpoints.
 * All routes are localhost-guarded.
 */
import type { FastifyInstance } from "fastify";
import type { RaggerClient } from "../ragger/ragger-client.js";
import type { RaggerPoller } from "../ragger/ragger-poller.js";

interface RaggerRouteDeps {
	raggerClient: RaggerClient;
	raggerPoller: RaggerPoller;
	networkGuard: (request: any, reply: any, done: (err?: Error) => void) => void;
}

export function registerRaggerRoutes(fastify: FastifyInstance, deps: RaggerRouteDeps): void {
	const { raggerClient, raggerPoller, networkGuard } = deps;

	// GET /api/ragger/status — cached health + workspace summary
	fastify.get("/api/ragger/status", { preHandler: networkGuard }, async () => {
		return raggerPoller.getCached();
	});

	// GET /api/ragger/workspaces — list all workspaces
	fastify.get("/api/ragger/workspaces", { preHandler: networkGuard }, async () => {
		try {
			const result = await raggerClient.listWorkspaces();
			return { success: true, data: result.workspaces };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});

	// GET /api/ragger/workspaces/:name — single workspace stats
	fastify.get("/api/ragger/workspaces/:name", { preHandler: networkGuard }, async (request: any) => {
		try {
			const stats = await raggerClient.getWorkspaceStats(request.params.name);
			return { success: true, data: stats };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});

	// GET /api/ragger/workspaces/:name/files — indexed file manifest
	fastify.get("/api/ragger/workspaces/:name/files", { preHandler: networkGuard }, async (request: any) => {
		try {
			const stats = await raggerClient.getWorkspaceStats(request.params.name);
			return { success: true, data: stats.indexed_files ?? [] };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});

	// POST /api/ragger/workspaces/index — trigger indexing
	fastify.post("/api/ragger/workspaces/index", { preHandler: networkGuard }, async (request: any) => {
		try {
			const { workspace, path, replace } = request.body;
			if (!path) return { success: false, error: "path is required" };
			const result = await raggerClient.indexWorkspace(workspace ?? "default", path, replace ?? true);
			// Trigger a poll refresh after indexing
			raggerPoller.refresh().catch(() => {});
			return { success: true, data: result };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});

	// POST /api/ragger/workspaces/search — proxy search
	fastify.post("/api/ragger/workspaces/search", { preHandler: networkGuard }, async (request: any) => {
		try {
			const { workspace, query, k } = request.body;
			if (!query) return { success: false, error: "query is required" };
			const result = await raggerClient.search(workspace ?? "default", query, k ?? 5);
			return { success: true, data: result };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});

	// DELETE /api/ragger/workspaces/:name — delete workspace
	fastify.delete("/api/ragger/workspaces/:name", { preHandler: networkGuard }, async (request: any) => {
		try {
			const result = await raggerClient.deleteWorkspace(request.params.name);
			raggerPoller.refresh().catch(() => {});
			return { success: true, data: result };
		} catch (err: any) {
			return { success: false, error: err.message };
		}
	});
}
