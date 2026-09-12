/**
 * The recommended-extensions enricher must forward the `model-proxy` service
 * dep so `/api/packages/recommended` never reports "probe not wired" for an
 * entry declaring `requires.services: ["model-proxy"]`.
 *
 * The real manifest declares no `services`, so this file mocks the exact
 * subpath the route imports. See change:
 * remove-pi-model-proxy-upstream-references (E7, X1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

// Pulled transitively by package-manager-wrapper.
vi.mock("@earendil-works/pi-coding-agent", () => ({
	DefaultPackageManager: function () {
		return {};
	},
	SettingsManager: { create: () => ({}) },
}));

// A single entry declaring the closed-registry service under test.
vi.mock("@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js", () => ({
	RECOMMENDED_EXTENSIONS: [
		{
			id: "probe-consumer-plugin",
			source: "npm:probe-consumer-plugin",
			displayName: "Probe consumer",
			fallbackDescription: "A test entry declaring a model-proxy service requirement.",
			status: "optional",
			unlocks: ["something"],
			requires: { services: ["model-proxy"] },
		},
	],
}));

// Stub the network fetchers so enrichment never leaves the process.
vi.mock("../package/npm-search-proxy.js", async (importActual) => {
	const actual = await importActual<typeof import("../package/npm-search-proxy.js")>();
	return {
		...actual,
		fetchPackageMeta: vi.fn(async () => null),
		fetchGithubPackageJson: vi.fn(async () => null),
	};
});

import {
	registerRecommendedRoutes,
	invalidateRecommendedCache,
} from "../routes/recommended-routes.js";

function makeWrapper(): any {
	return { listInstalled: vi.fn(async () => []) };
}

async function fetchRecommended(deps: { isModelProxyEnabled?: () => boolean }) {
	// The 60s module cache is shared across fastify instances.
	invalidateRecommendedCache();
	const fastify = Fastify();
	registerRecommendedRoutes(fastify, {
		packageManagerWrapper: makeWrapper(),
		...deps,
	});
	await fastify.ready();
	const res = await fastify.inject({ method: "GET", url: "/api/packages/recommended" });
	await fastify.close();
	return { status: res.statusCode, body: res.json() as any };
}

function entryOf(body: any) {
	return body.data.recommended.find((e: any) => e.id === "probe-consumer-plugin");
}

beforeEach(() => invalidateRecommendedCache());
afterEach(() => vi.clearAllMocks());

describe("GET /api/packages/recommended — model-proxy probe (E7, X1)", () => {
	it("E7a: enabled dep → requirement satisfied, no missingRequirements", async () => {
		const { status, body } = await fetchRecommended({ isModelProxyEnabled: () => true });
		expect(status).toBe(200);
		const entry = entryOf(body);
		expect(entry.requirements.services[0]).toEqual({
			name: "model-proxy",
			satisfied: true,
		});
		// `missingRequirements` is always an array when `requirements` is present
		// (see recommended-routes.test.ts) — [] means all satisfied.
		expect(entry.missingRequirements).toEqual([]);
	});

	it("E7b: disabled dep → missingRequirements ['model-proxy']", async () => {
		const { body } = await fetchRecommended({ isModelProxyEnabled: () => false });
		const entry = entryOf(body);
		expect(entry.requirements.services[0].satisfied).toBe(false);
		expect(entry.missingRequirements).toEqual(["model-proxy"]);
	});

	it("X1: throwing dep is swallowed → HTTP 200, entry survives without requirements", async () => {
		const { status, body } = await fetchRecommended({
			isModelProxyEnabled: () => {
				throw new Error("boom");
			},
		});
		expect(status).toBe(200);
		const entry = entryOf(body);
		expect(entry).toBeDefined();
		expect(entry.requirements).toBeUndefined();
		expect(entry.missingRequirements).toBeUndefined();
	});
});
