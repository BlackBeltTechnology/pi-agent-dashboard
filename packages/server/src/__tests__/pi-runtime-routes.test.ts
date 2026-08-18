/**
 * Tests for the pi runtime discovery + selection endpoints
 * (test-plan E14–E17, E22, X12).
 *
 * The atomicity case (E15) injects a THROWING persist via an OverridesStore
 * subclass: a per-write-atomic store is not the same as a pair-atomic one, and
 * the assertion checks BOTH the file and the in-memory cache — a `setMany`
 * that mutated the cache before persisting would pass a disk-only assertion.
 *
 * See change: select-pi-runtime-install.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalidatePiCandidatesCache } from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import {
	OverridesStore,
	type Strategy,
	ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPiRuntimeRoutes } from "../routes/pi-runtime-routes.js";
import type { NetworkGuard } from "../routes/route-deps.js";

const noGuard = () => async () => {
	/* allow all */
};
const denyGuard =
	() =>
	async (_req: unknown, reply: { status(c: number): void; send(b: unknown): void }) => {
		reply.status(403);
		reply.send({ success: false, error: "blocked" });
	};

let root: string;
let overridesFile: string;

beforeEach(() => {
	// realpath: macOS resolves /tmp → /private/tmp, and the route persists the
	// realpath'd value the validator returns.
	root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "pi-runtime-routes-")),
	);
	overridesFile = path.join(root, "tool-overrides.json");
	invalidatePiCandidatesCache();
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	invalidatePiCandidatesCache();
});

/** A real pi install on disk; returns its two consumer entry files. */
function writeInstall(
	name: string,
	version: string,
): { pkgDir: string; spawn: string; module: string } {
	const pkgDir = path.join(root, name);
	fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }),
	);
	const spawn = path.join(pkgDir, "dist", "cli.js");
	const module = path.join(pkgDir, "dist", "index.js");
	fs.writeFileSync(spawn, "#!/usr/bin/env node\n");
	fs.writeFileSync(module, "export const pi = 1;\n");
	return { pkgDir, spawn, module };
}

function overrideOnly(tool: string): Strategy[] {
	return [
		{
			name: "override",
			run: (ctx) =>
				ctx.overrides[tool]
					? { ok: true, path: ctx.overrides[tool] }
					: { ok: false, reason: "no override set" },
		},
	];
}

function buildRegistry(store?: OverridesStore): ToolRegistry {
	const overrides =
		store ?? new OverridesStore({ filePath: overridesFile, warn: () => {} });
	const r = new ToolRegistry({ overrides, platform: "linux" });
	r.register({ name: "pi", kind: "executor", strategies: overrideOnly("pi") });
	r.register({
		name: "pi-coding-agent",
		kind: "module",
		strategies: overrideOnly("pi-coding-agent"),
	});
	return r;
}

function buildServer(
	registry: ToolRegistry,
	guard: () => unknown = noGuard,
): FastifyInstance {
	const fastify = Fastify();
	registerPiRuntimeRoutes(fastify, {
		registry,
		networkGuard: guard() as NetworkGuard,
		runtimeDeps: {
			// Hermetic: no PATH lookup, no `npm root -g`, no real MANAGED_DIR.
			managedDir: path.join(root, "managed"),
			repoRoot: path.join(root, "repo"),
			anchorDir: path.join(root, "anchor"),
			npmRootGlobal: () => "",
			which: () => null,
			floorPath: path.join(root, "no-such-package.json"),
		},
	});
	return fastify;
}

function readPersisted(): Record<string, { path: string }> {
	if (!fs.existsSync(overridesFile)) return {};
	return JSON.parse(fs.readFileSync(overridesFile, "utf8")).overrides;
}

describe("POST /api/pi/runtime — atomic dual write", () => {
	it("E14: both overrides are present after one call", async () => {
		const A = writeInstall("a", "0.84.1");
		const fastify = buildServer(buildRegistry());
		const res = await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: A.spawn, module: A.module },
		});
		expect(res.statusCode).toBe(200);
		const persisted = readPersisted();
		expect(persisted.pi.path).toContain("cli.js");
		expect(persisted["pi-coding-agent"].path).toContain("index.js");
		await fastify.close();
	});

	it("E15: a throwing persist leaves NEITHER the file NOR the cache changed", async () => {
		const A = writeInstall("a", "0.84.1");
		const B = writeInstall("b", "0.83.0");
		class ThrowingStore extends OverridesStore {
			armed = false;
			protected override persist(o: Record<string, string>): void {
				if (this.armed) throw new Error("disk full");
				super.persist(o);
			}
		}
		const store = new ThrowingStore({ filePath: overridesFile, warn: () => {} });
		// Seed a known-good pair through the normal path.
		store.setMany({ pi: B.spawn, "pi-coding-agent": B.module });
		store.armed = true;

		const registry = buildRegistry(store);
		const fastify = buildServer(registry);
		const res = await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: A.spawn, module: A.module },
		});
		expect(res.statusCode).toBe(500);

		// On disk …
		expect(readPersisted().pi.path).toBe(B.spawn);
		expect(readPersisted()["pi-coding-agent"].path).toBe(B.module);
		// … AND in the in-memory cache (the half a disk-only assertion misses).
		expect(store.list().pi).toBe(B.spawn);
		expect(store.list()["pi-coding-agent"]).toBe(B.module);
		await fastify.close();
	});

	it("E16: Automatic clears one consumer while the other is set, in ONE persist", async () => {
		const A = writeInstall("a", "0.84.1");
		const B = writeInstall("b", "0.83.0");
		const registry = buildRegistry();
		registry.setOverrides({ pi: B.spawn, "pi-coding-agent": B.module });
		const fastify = buildServer(registry);

		const res = await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: null, module: A.module },
		});
		expect(res.statusCode).toBe(200);
		const persisted = readPersisted();
		expect(persisted.pi).toBeUndefined();
		expect(persisted["pi-coding-agent"].path).toBe(A.module);
		await fastify.close();
	});

	it("E17: the new selection resolves immediately, with no explicit rescan", async () => {
		const A = writeInstall("a", "0.84.1");
		const B = writeInstall("b", "0.83.0");
		const registry = buildRegistry();
		registry.setOverrides({ pi: B.spawn });
		// Prime the registry cache with the OLD resolution.
		expect(registry.resolve("pi").path).toBe(B.spawn);

		const fastify = buildServer(registry);
		await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: A.spawn },
		});
		expect(registry.resolve("pi").path).toBe(A.spawn);
		await fastify.close();
	});

	it("rejects a directory selection with 400 and names the failed check", async () => {
		const A = writeInstall("a", "0.84.1");
		const fastify = buildServer(buildRegistry());
		const res = await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: A.pkgDir },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain("not-a-directory");
		expect(readPersisted().pi).toBeUndefined();
		await fastify.close();
	});
});

describe("GET /api/pi/installs", () => {
	it("reports every location, and marks which candidate each consumer uses", async () => {
		const A = writeInstall("a", "0.84.1");
		const registry = buildRegistry();
		registry.setOverrides({ pi: A.spawn, "pi-coding-agent": A.module });
		const fastify = buildServer(registry);

		const body = (
			await fastify.inject({ method: "GET", url: "/api/pi/installs" })
		).json().data;
		// The four derived locations are always present, even when empty (E2).
		for (const key of ["bare-import", "managed", "npm-global", "repo-root"]) {
			expect(body.installs.some((i: { key: string }) => i.key === key)).toBe(
				true,
			);
		}
		expect(body.spawn.pinned).toBe(true);
		expect(body.module.pinned).toBe(true);
		await fastify.close();
	});

	it("X12: a corrupt tool-overrides.json is treated as no overrides, with no throw", async () => {
		fs.writeFileSync(overridesFile, "{ not json at all");
		const fastify = buildServer(buildRegistry());
		const res = await fastify.inject({
			method: "GET",
			url: "/api/pi/installs",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().data.spawn.pinned).toBe(false);
		await fastify.close();
	});
});

describe("E22: both endpoints are network-guarded", () => {
	it("the discovery and selection endpoints are rejected by the same guard", async () => {
		const fastify = buildServer(buildRegistry(), denyGuard);
		const get = await fastify.inject({
			method: "GET",
			url: "/api/pi/installs",
		});
		const post = await fastify.inject({
			method: "POST",
			url: "/api/pi/runtime",
			payload: { spawn: null },
		});
		expect(get.statusCode).toBe(403);
		expect(post.statusCode).toBe(403);
		await fastify.close();
	});
});
