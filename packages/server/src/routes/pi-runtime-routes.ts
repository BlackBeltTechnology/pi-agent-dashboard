/**
 * REST routes for pi runtime discovery + selection.
 *
 *   GET  /api/pi/installs  → every discoverable pi install + per-consumer state
 *   POST /api/pi/runtime   → set BOTH consumers in one atomic transaction
 *
 * Guarded by the same `networkGuard` as `/api/tools`.
 *
 * The selection is ONE request on purpose (design D7): two sequential PUTs can
 * fail between them, leaving the spawn consumer pinned and the import consumer
 * not — exactly the mismatch the picker forbids while linked. An invariant a
 * crash can break is not an invariant.
 *
 * See change: select-pi-runtime-install.
 */

import { validatePiOverridePath } from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import type {
	PiInstallsResponse,
	SetPiRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import {
	consumerDivergenceMessage,
	PI_MODULE_TOOL,
	PI_SPAWN_TOOL,
	type PiRuntimeDeps,
	piRuntimeSnapshot,
} from "../pi/pi-runtime.js";
import type { NetworkGuard } from "./route-deps.js";

export interface PiRuntimeRoutesDeps {
	registry: ToolRegistry;
	networkGuard: NetworkGuard;
	/** Test seam: overrides the enumeration inputs. */
	runtimeDeps?: PiRuntimeDeps;
}

function buildInstallsResponse(
	deps: PiRuntimeDeps = {},
): PiInstallsResponse {
	const snap = piRuntimeSnapshot(deps);
	return {
		installs: snap.candidates.map((c) => ({
			key: c.key,
			label: c.label,
			pkgDir: c.pkgDir,
			spawnEntry: c.spawnEntry,
			moduleEntry: c.moduleEntry,
			version: c.version,
			meetsFloor: c.meetsFloor,
			floorUnknown: c.floorUnknown,
			readOnly: c.readOnly ?? false,
			usedBy: {
				spawn: snap.spawn.candidateKey === c.key,
				module: snap.module.candidateKey === c.key,
			},
		})),
		spawn: snap.spawn,
		module: snap.module,
		inSync: snap.inSync,
		consumerDiverged: snap.consumerDiverged,
		divergenceMessage: consumerDivergenceMessage(snap),
		installSetDiverged: snap.installSetDiverged,
		installSetVersions: snap.installSetVersions,
		floor: snap.floor,
	};
}

/**
 * Validate ONE consumer's selection. `null` is Automatic (clears the pin in the
 * same transaction); anything else must survive `validatePiOverridePath`, and
 * the error names the check that failed so a 400 is actionable.
 */
function resolveSelection(
	field: "spawn" | "module",
	value: string | null | undefined,
): { value: string | null } | { error: string } {
	if (value === null) return { value: null };
	if (typeof value !== "string" || !value.trim()) {
		return { error: `body.${field} must be an absolute path or null` };
	}
	const check = validatePiOverridePath(value.trim());
	if (!check.ok) {
		return {
			error: `${field}: ${check.reason} (failed check: ${check.failedCheck})`,
		};
	}
	return { value: check.resolvedPath ?? value.trim() };
}

export function registerPiRuntimeRoutes(
	fastify: FastifyInstance,
	{ registry, networkGuard, runtimeDeps }: PiRuntimeRoutesDeps,
): void {
	const deps: PiRuntimeDeps = { registry, ...(runtimeDeps ?? {}) };

	// ── GET /api/pi/installs ───────────────────────────────────────────
	fastify.get(
		"/api/pi/installs",
		{ preHandler: networkGuard },
		async () =>
			({
				success: true,
				data: buildInstallsResponse(deps),
			}) satisfies ApiResponse<PiInstallsResponse>,
	);

	// ── POST /api/pi/runtime ───────────────────────────────────────────
	fastify.post<{ Body: SetPiRuntimeRequest }>(
		"/api/pi/runtime",
		{ preHandler: networkGuard },
		async (request, reply) => {
			const body = request.body ?? {};
			const changes: Record<string, string | null> = {};

			for (const [field, tool] of [
				["spawn", PI_SPAWN_TOOL],
				["module", PI_MODULE_TOOL],
			] as const) {
				if (!(field in body)) continue;
				const resolved = resolveSelection(field, body[field]);
				if ("error" in resolved) {
					reply.status(400);
					return { success: false, error: resolved.error } satisfies ApiResponse;
				}
				changes[tool] = resolved.value;
			}

			if (Object.keys(changes).length === 0) {
				reply.status(400);
				return {
					success: false,
					error: "body must name at least one of `spawn` or `module`",
				} satisfies ApiResponse;
			}

			// One persist. A throwing persist leaves BOTH the file and the
			// in-memory cache untouched (OverridesStore.setMany). Caught here so
			// the failure returns this route's own envelope instead of Fastify's
			// default handler echoing the raw error text to the caller.
			try {
				registry.setOverrides(changes);
			} catch (err) {
				request.log.error({ err }, "pi runtime selection failed to persist");
				reply.status(500);
				return {
					success: false,
					error: "failed to persist the pi runtime selection",
				} satisfies ApiResponse;
			}

			// Audit line: which pi each consumer was pointed at, and when. The
			// runtime choice is a security-relevant, network-reachable change
			// whose effect (a different executed binary) shows up much later and
			// nowhere else in the logs — without this, "why is this box running
			// a different pi than yesterday" has no answer.
			// See change: select-pi-runtime-install.
			fastify.log.info(
				{
					spawn: changes[PI_SPAWN_TOOL] ?? "automatic",
					module: changes[PI_MODULE_TOOL] ?? "automatic",
				},
				"pi runtime selection applied",
			);

			// `setOverrides` bypasses `setOverride`, so the registry's cached
			// Resolution must be dropped explicitly or the very next spawn would
			// use the OLD binary while the UI showed the new selection.
			registry.rescan(PI_SPAWN_TOOL);
			registry.rescan(PI_MODULE_TOOL);

			return {
				success: true,
				data: buildInstallsResponse(deps),
			} satisfies ApiResponse<PiInstallsResponse>;
		},
	);
}
