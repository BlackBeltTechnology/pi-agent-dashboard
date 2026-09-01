/**
 * REST routes for Node runtime family discovery + selection.
 *
 *   GET  /api/node/installs        → candidates + family coherence report
 *   POST /api/node/installs/select → ONE atomic family write (node+npm+npx)
 *
 * Guarded by the same `networkGuard` as `/api/pi/installs`. The selection
 * is ONE `registry.setOverrides()` call on purpose — see the pi picker's
 * identical rationale and
 * change: add-node-runtime-family-selection (spec: "One selection writes
 * the whole family atomically").
 */

import {
	assessFamilyCoherence,
	enumerateNodeCandidates,
	applySelection,
	planSelection,
	type FamilyCoherenceReport,
	type NodeCandidate,
} from "@blackbelt-technology/pi-dashboard-shared/node-installs/index.js";
import { getManagedDir } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";
import type {
	NodeInstallsResponse,
	SelectNodeRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import os from "node:os";
import type { NetworkGuard } from "./route-deps.js";

export interface NodeRuntimeRoutesDeps {
	registry: ToolRegistry;
	networkGuard: NetworkGuard;
	/** Test seam: overrides the enumeration inputs (resourcesPath/homedir). */
	enumerateEnv?: { resourcesPath?: string; homedir?: string };
}

/** Live enumeration inputs (injectable for tests). */
export function nodeEnumerationEnv(
	over?: NodeRuntimeRoutesDeps["enumerateEnv"],
): { resourcesPath?: string; homedir: string } {
	return {
		resourcesPath:
			over?.resourcesPath ??
			(process as { resourcesPath?: string }).resourcesPath,
		homedir: over?.homedir ?? os.homedir(),
	};
}

function buildNodeInstallsResponse(
	registry: ToolRegistry,
	env: { resourcesPath?: string; homedir?: string },
): NodeInstallsResponse {
	const candidates: NodeCandidate[] = enumerateNodeCandidates({
		resourcesPath: env.resourcesPath,
		homedir: env.homedir,
		managedDir: getManagedDir(),
		platform: process.platform,
	});
	const overrides = registry.listOverrides();
	const coherence: FamilyCoherenceReport = assessFamilyCoherence(
		registry,
		candidates,
	);
	return {
		candidates: candidates.map((c) => ({
			key: c.key,
			label: c.label,
			root: c.root,
			nodeEntry: c.nodeEntry,
			npmEntry: c.npmEntry,
			npxEntry: c.npxEntry,
			version: c.version,
			// Pre-compute the TRUE pre-write deviations per candidate so the
			// confirm dialog reports what THIS selection would do — not what
			// the current state looks like (review round-2 concern 1).
			pendingHandSet: planSelection({
				candidate: c,
				currentOverrides: overrides,
			}).handSetDeviations,
		})),
		coherence: {
			coherent: coherence.coherent,
			members: coherence.members,
			mismatch: coherence.mismatch,
			handSetDeviations: coherence.handSetDeviations,
			selectedCandidateKey: coherence.selectedCandidateKey,
		},
	};
}

export function registerNodeRuntimeRoutes(
	fastify: FastifyInstance,
	{ registry, networkGuard, enumerateEnv }: NodeRuntimeRoutesDeps,
): void {
	const env = enumerateEnv ?? nodeEnumerationEnv();

	// ── GET /api/node/installs ────────────────────────────────────────
	fastify.get(
		"/api/node/installs",
		{ preHandler: networkGuard },
		async () =>
			({
				success: true,
				data: buildNodeInstallsResponse(registry, env),
			}) satisfies ApiResponse<NodeInstallsResponse>,
	);

	// ── POST /api/node/installs/select ────────────────────────────────
	fastify.post(
		"/api/node/installs/select",
		{ preHandler: networkGuard },
		async (request, reply) => {
			const body = request.body as Partial<SelectNodeRuntimeRequest> | null;
			const root = body?.root;
			if (typeof root !== "string" || !root.trim()) {
				return reply.status(400).send({
					success: false,
					error: "body.root must be the candidate root being selected",
				});
			}
			const wanted = root.trim();
			const candidates = enumerateNodeCandidates({
				resourcesPath: env.resourcesPath,
				homedir: env.homedir,
				managedDir: getManagedDir(),
				platform: process.platform,
			});
			const candidate = candidates.find((c) => c.root === wanted);
			if (!candidate) {
				return reply.status(404).send({
					success: false,
					error: `no enumerated candidate with root ${wanted}`,
				});
			}
			if (!candidate.nodeEntry) {
				return reply.status(400).send({
					success: false,
					error:
						"candidate has no node entry — an installation without node cannot be selected",
				});
			}
			const discard = (body?.discardHandSet ?? []).filter(
				(m): m is "node" | "npm" | "npx" =>
					m === "node" || m === "npm" || m === "npx",
			);
			const result = applySelection(registry, candidate, {}, discard);
			if (!result.ok) {
				return reply.status(400).send({ success: false, error: result.reason });
			}
			return {
				success: true,
				data: {
					changes: result.plan.changes,
					handSetDeviations: result.plan.handSetDeviations,
				},
			} satisfies ApiResponse<{
				changes: Record<string, string | null>;
				handSetDeviations: Array<{ member: string; currentPath: string }>;
			}>;
		},
	);
}
