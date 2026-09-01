/**
 * Consumer divergence vs install-set divergence (test-plan E6, E19, E21).
 *
 * The two predicates answer DIFFERENT questions and are reported under
 * distinct labels (design D5). The load-bearing case is E19: two different
 * installs that happen to hold the SAME version. A version-based predicate
 * calls that "in sync"; a package-directory predicate calls it diverged —
 * and the picker's sync checkbox uses the directory axis, so a version-based
 * divergence surface would contradict it.
 *
 * See change: select-pi-runtime-install.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalidatePiCandidatesCache as invalidate } from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import {
	OverridesStore,
	type Strategy,
	ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	consumerDivergenceMessage,
	piRuntimeSnapshot,
} from "../pi/pi-runtime.js";

let root: string;
beforeEach(() => {
	root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "pi-divergence-")),
	);
	invalidate();
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	invalidate();
});

function writeInstall(pkgDir: string, version: string) {
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

/** Place an install where the enumerator's `managed`/`repo-root` probe finds it. */
function asLocation(dir: string, name: string, version: string) {
	return writeInstall(path.join(dir, "node_modules", name), version);
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

function makeRegistry(): ToolRegistry {
	const overrides = new OverridesStore({
		filePath: path.join(root, "overrides.json"),
		warn: () => {},
	});
	const r = new ToolRegistry({ overrides, platform: "linux" });
	r.register({ name: "pi", kind: "executor", strategies: overrideOnly("pi") });
	r.register({
		name: "pi-coding-agent",
		kind: "module",
		strategies: overrideOnly("pi-coding-agent"),
	});
	return r;
}

function snapshot(registry: ToolRegistry, extra: Record<string, unknown> = {}) {
	return piRuntimeSnapshot({
		registry,
		managedDir: path.join(root, "managed"),
		repoRoot: path.join(root, "repo"),
		anchorDir: path.join(root, "anchor"),
		npmRootGlobal: () => "",
		which: () => null,
		floorPath: path.join(root, "server-package.json"),
		...extra,
	});
}

describe("consumer divergence (E19)", () => {
	it("E19: two DIFFERENT installs at the SAME version are NOT in sync AND are diverged", () => {
		const a = asLocation(
			path.join(root, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.84.1",
		);
		const b = asLocation(
			path.join(root, "repo"),
			"@earendil-works/pi-coding-agent",
			"0.84.1",
		);
		const registry = makeRegistry();
		registry.setOverrides({ pi: a.spawn, "pi-coding-agent": b.module });

		const snap = snapshot(registry);
		expect(snap.spawn.version).toBe("0.84.1");
		expect(snap.module.version).toBe("0.84.1");
		// A version-based predicate would report "in sync" here. Both surfaces
		// agree on the directory axis instead.
		expect(snap.inSync).toBe(false);
		expect(snap.consumerDiverged).toBe(true);
		expect(consumerDivergenceMessage(snap)).toContain("0.84.1");
	});

	it("E18: the two consumers' DIFFERENT entry files in ONE install are in sync", () => {
		const a = asLocation(
			path.join(root, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.84.1",
		);
		const registry = makeRegistry();
		registry.setOverrides({ pi: a.spawn, "pi-coding-agent": a.module });
		const snap = snapshot(registry);
		expect(snap.inSync).toBe(true);
		expect(snap.consumerDiverged).toBe(false);
		expect(consumerDivergenceMessage(snap)).toBeNull();
	});
});

describe("install-set divergence is a separate label (E21)", () => {
	it("E21: both consumers on one install + an unused older install → set diverged, consumers not", () => {
		const used = asLocation(
			path.join(root, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.84.1",
		);
		// An install nobody uses, at an older version.
		asLocation(
			path.join(root, "repo"),
			"@earendil-works/pi-coding-agent",
			"0.71.0",
		);
		const registry = makeRegistry();
		registry.setOverrides({ pi: used.spawn, "pi-coding-agent": used.module });

		const snap = snapshot(registry);
		expect(snap.consumerDiverged).toBe(false);
		expect(snap.installSetDiverged).toBe(true);
		expect(snap.installSetVersions.sort()).toEqual(["0.71.0", "0.84.1"]);
		// Distinct labels: the consumer message stays silent.
		expect(consumerDivergenceMessage(snap)).toBeNull();
	});
});

describe("floor evaluation on the snapshot (E6)", () => {
	it("E6: only the below-floor candidate is flagged", () => {
		asLocation(
			path.join(root, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.77.9",
		);
		asLocation(
			path.join(root, "repo"),
			"@earendil-works/pi-coding-agent",
			"0.78.1",
		);
		fs.writeFileSync(
			path.join(root, "server-package.json"),
			JSON.stringify({ piCompatibility: { minimum: "0.78.0" } }),
		);
		const snap = snapshot(makeRegistry());
		expect(snap.floor).toBe("0.78.0");
		const managed = snap.candidates.find((c) => c.key === "managed");
		const repo = snap.candidates.find((c) => c.key === "repo-root");
		expect(managed?.meetsFloor).toBe(false);
		expect(repo?.meetsFloor).toBe(true);
	});
});

describe("fixture seam (PI_DASHBOARD_PI_FIXTURE_DIR)", () => {
	afterEach(() => {
		delete process.env.PI_DASHBOARD_PI_FIXTURE_DIR;
		invalidate();
	});

	it("is INERT when unset — the default path is unchanged", () => {
		delete process.env.PI_DASHBOARD_PI_FIXTURE_DIR;
		const snap = snapshot(makeRegistry());
		// Explicit deps still win; nothing is read from a fixture tree.
		expect(snap.candidates.some((c) => c.key === "managed")).toBe(true);
	});

	it("redirects enumeration at a fixture tree when set", () => {
		const fixture = path.join(root, "fixture");
		asLocation(
			path.join(fixture, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.70.0",
		);
		fs.writeFileSync(
			path.join(fixture, "server-package.json"),
			JSON.stringify({ piCompatibility: { minimum: "0.78.0" } }),
		);
		process.env.PI_DASHBOARD_PI_FIXTURE_DIR = fixture;
		invalidate();
		// No explicit location deps — the seam must supply them.
		const snap = piRuntimeSnapshot({ registry: makeRegistry() });
		const managed = snap.candidates.find((c) => c.key === "managed");
		expect(snap.floor).toBe("0.78.0");
		expect(managed?.version).toBe("0.70.0");
		expect(managed?.meetsFloor).toBe(false);
	});
});

describe("divergence does not depend on candidate matching (review finding)", () => {
	it("a consumer pinned OUTSIDE every enumerated location still diverges", () => {
		// `pi` on an enumerated install …
		const enumerated = asLocation(
			path.join(root, "managed"),
			"@earendil-works/pi-coding-agent",
			"0.84.1",
		);
		// … and `pi-coding-agent` on a real install that matches NO candidate.
		const stray = writeInstall(path.join(root, "homebrew", "pi"), "0.71.0");
		const registry = makeRegistry();
		registry.setOverrides({
			pi: enumerated.spawn,
			"pi-coding-agent": stray.module,
		});

		const snap = snapshot(registry);
		// Deriving pkgDir from the MATCHED CANDIDATE would leave the module side
		// null here, silently suppressing the mismatch — the exact thing D5 says
		// must always be observable. Each consumer's pkgDir comes from its OWN
		// resolved entry.
		expect(snap.module.pkgDir).not.toBeNull();
		expect(snap.module.version).toBe("0.71.0");
		expect(snap.module.candidateKey).toBeNull();
		expect(snap.inSync).toBe(false);
		expect(snap.consumerDiverged).toBe(true);
		expect(consumerDivergenceMessage(snap)).toContain("0.71.0");
	});
});
