/**
 * REST routes for pi core version check and update.
 *
 *   GET  /api/pi-core/versions[?refresh=true]
 *   POST /api/pi-core/update                 { packages?: string[] }
 *
 * Complements /api/packages/* (extension management): this endpoint covers
 * globally-installed pi CLI packages like @earendil-works/pi-coding-agent,
 * pi-dashboard itself, pi-model-proxy, etc.
 */
import type { FastifyInstance } from "fastify";
import type {
	ApiResponse,
	PiCoreStatus,
	PiCoreUpdateRequest,
	PiCoreUpdateResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { PiCoreChecker } from "../pi-core-checker.js";
import type { PiCoreUpdater } from "../pi-core-updater.js";
import { PackageOperationBusyError } from "../package-manager-wrapper.js";

export interface PiCoreRouteDeps {
	piCoreChecker: PiCoreChecker;
	piCoreUpdater: PiCoreUpdater;
	/**
	 * Called after the updater finishes a batch (success or per-package failure).
	 * The server wires this to broadcast a `pi_core_update_complete` WS message
	 * so listeners (PiUpdateBadge, PiCoreVersionsSection, usePiCoreVersions
	 * hook instances in other open tabs) refetch their state.
	 */
	onUpdateComplete?: (payload: {
		results: Array<{ name: string; success: boolean; error?: string }>;
		sessionsReloaded: number;
	}) => void;
}

export function registerPiCoreRoutes(
	fastify: FastifyInstance,
	deps: PiCoreRouteDeps,
): void {
	const { piCoreChecker, piCoreUpdater } = deps;

	// bootstrapGate removed under change: eliminate-electron-runtime-install (task 3.5).
	// pi-core endpoints are unconditionally available; pi ships as regular npm dep.

	// ── GET /api/pi-core/versions ──────────────────────────────────

	fastify.get<{ Querystring: { refresh?: string } }>(
		"/api/pi-core/versions",
		async (request) => {
			const refresh = request.query.refresh === "true";
			try {
				const status = await piCoreChecker.getStatus(refresh);
				return { success: true, data: status } satisfies ApiResponse<PiCoreStatus>;
			} catch (err: any) {
				return { success: false, error: err?.message ?? String(err) } satisfies ApiResponse;
			}
		},
	);

	// ── POST /api/pi-core/update ───────────────────────────────────

	fastify.post<{ Body: PiCoreUpdateRequest }>(
		"/api/pi-core/update",
		async (request, reply) => {
			const requested = request.body?.packages ?? [];

			// Load current status to determine install source and eligibility.
			const status = await piCoreChecker.getStatus();
			const allByName = new Map(status.packages.map((p) => [p.name, p]));

			const targetNames =
				requested.length > 0
					? requested
					: status.packages.filter((p) => p.updateAvailable).map((p) => p.name);

			const resolved = [];
			const unknown: string[] = [];
			for (const name of targetNames) {
				const pkg = allByName.get(name);
				if (!pkg) {
					unknown.push(name);
					continue;
				}
				resolved.push(pkg);
			}

			if (unknown.length > 0) {
				reply.code(400);
				return {
					success: false,
					error: `Unknown package(s): ${unknown.join(", ")}`,
				} satisfies ApiResponse;
			}

			if (resolved.length === 0) {
				return {
					success: true,
					data: { results: [], sessionsReloaded: 0 },
				} satisfies ApiResponse<PiCoreUpdateResponse>;
			}

			try {
				const out = await piCoreUpdater.update(resolved);
				// Invalidate cache so next version check reflects new versions.
				piCoreChecker.invalidate();
				// Notify other browser tabs / the header badge hook instance so
				// their independent usePiCoreVersions state refetches.
				deps.onUpdateComplete?.(out);
				return { success: true, data: out } satisfies ApiResponse<PiCoreUpdateResponse>;
			} catch (err: any) {
				if (err instanceof PackageOperationBusyError) {
					reply.code(409);
					return { success: false, error: err.message } satisfies ApiResponse;
				}
				return { success: false, error: err?.message ?? String(err) } satisfies ApiResponse;
			}
		},
	);
}
