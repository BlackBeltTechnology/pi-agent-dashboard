/**
 * Tests for Node installation candidate enumeration.
 *
 * Mirrors `pi-installs/__tests__/candidates.test.ts` (the exemplar named in
 * the tasks). All filesystem access is injected; the `spawn` dep is a
 * tripwire that fails the test if enumeration ever spawns a process
 * (spec: "version is read without spawning").
 *
 * See change: add-node-runtime-family-selection.
 */
import { beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
	enumerateNodeCandidates,
	invalidateNodeCandidatesCache,
	NODE_CANDIDATE_KEYS,
	type EnumerateNodeDeps,
} from "../index.js";

/** In-memory fs fixture: explicit sets of files and directories. */
function fakeFs(files: string[], dirs: string[]) {
	const f = new Set(files);
	const d = new Set(dirs);
	return {
		exists: (p: string) => f.has(p),
		isDirectory: (p: string) => d.has(p),
		readDir: (p: string) =>
			[...d].filter((x) => path.dirname(x) === p).map((x) => path.basename(x)),
	};
}

/** Deps with every filesystem probe pointed at an empty host + spawn tripwire. */
function baseDeps(overrides: EnumerateNodeDeps = {}): EnumerateNodeDeps {
	return {
		exists: () => false,
		isDirectory: () => false,
		readDir: () => [],
		which: () => null,
		homedir: "/home/u",
		platform: "linux",
		resourcesPath: undefined,
		managedDir: undefined,
		spawn: () => {
			throw new Error("enumeration spawned a child process");
		},
		...overrides,
	};
}

function nodeExe(root: string, platform: NodeJS.Platform = "linux"): string {
	return platform === "win32"
		? path.win32.join(root, "node.exe")
		: path.join(root, "bin", "node");
}

describe("enumerateNodeCandidates", () => {
	beforeEach(() => {
		// The module-level cache is NOT keyed on deps — tests must start cold
		// (same discipline as the pi-installs exemplar).
		invalidateNodeCandidatesCache();
	});

	it("returns every derived location as a row, even when absent", () => {
		const rows = enumerateNodeCandidates(baseDeps());
		const keys = rows.map((r) => r.key);
		for (const key of NODE_CANDIDATE_KEYS) {
			expect(keys).toContain(key);
		}
	});

	it("candidate roots mirror the strategy chains: bundled + managed + PATH are enumerated when present", () => {
		// Chain roots (spec tool-registry): bundled <resourcesPath>/node,
		// managed <managedDir>/node, PATH. Each must appear when it exists —
		// the mirror guarantee is one-directional (chain roots ⊆ enumeration);
		// version-manager roots are additive by scope decision (0.2).
		const fs = fakeFs(
			[
				nodeExe("/app/resources/node"),
				nodeExe("/home/u/.pi-dashboard/node"),
				"/usr/bin/node",
			],
			[
				"/app/resources/node",
				"/app/resources/node/bin",
				"/home/u/.pi-dashboard/node",
				"/home/u/.pi-dashboard/node/bin",
				"/usr/bin",
			],
		);
		const deps = baseDeps({
			resourcesPath: "/app/resources",
			managedDir: "/home/u/.pi-dashboard",
			...fs,
			which: (n) => (n === "node" ? "/usr/bin/node" : null),
		});
		const rows = enumerateNodeCandidates(deps);
		const byKey = new Map(rows.map((r) => [r.key, r]));
		expect(byKey.get("bundled")?.nodeEntry).toBe(nodeExe("/app/resources/node"));
		expect(byKey.get("managed")?.nodeEntry).toBe(
			nodeExe("/home/u/.pi-dashboard/node"),
		);
		expect(byKey.get("path")?.root).toBe("/usr/bin");
		expect(byKey.get("path")?.nodeEntry).toBe("/usr/bin/node");
	});

	it("a root with node but no npm yields a candidate with npmEntry absent — not a discarded candidate, not a fabricated path", () => {
		const fs = fakeFs(
			[nodeExe("/home/u/.pi-dashboard/node")],
			["/home/u/.pi-dashboard/node", "/home/u/.pi-dashboard/node/bin"],
		);
		const deps = baseDeps({
			managedDir: "/home/u/.pi-dashboard",
			...fs,
		});
		const rows = enumerateNodeCandidates(deps);
		const managed = rows.find((r) => r.key === "managed");
		expect(managed).toBeDefined();
		expect(managed?.nodeEntry).toBe(nodeExe("/home/u/.pi-dashboard/node"));
		expect(managed?.npmEntry).toBeNull();
		expect(managed?.npxEntry).toBeNull();
	});

	it("entries are FILES, not directories — a directory at the entry path is absent", () => {
		const entry = nodeExe("/home/u/.pi-dashboard/node");
		const fs = fakeFs(
			[entry],
			[
				entry,
				"/home/u/.pi-dashboard/node",
				"/home/u/.pi-dashboard/node/bin",
			],
		);
		// exists() true AND isDirectory() true for the entry path → absent.
		const deps = baseDeps({
			managedDir: "/home/u/.pi-dashboard",
			...fs,
		});
		const managed = enumerateNodeCandidates(deps).find(
			(r) => r.key === "managed",
		);
		expect(managed?.nodeEntry).toBeNull();
	});

	it("version is read from filesystem metadata only — the spawn tripwire is never called", () => {
		const fs = fakeFs(
			[nodeExe("/home/u/.pi-dashboard/node")],
			["/home/u/.pi-dashboard/node", "/home/u/.pi-dashboard/node/bin"],
		);
		const deps = baseDeps({
			managedDir: "/home/u/.pi-dashboard",
			...fs,
			// baseDeps' spawn() throws — reaching here means enumeration spawned.
		});
		const rows = enumerateNodeCandidates(deps);
		// Managed/bundled/PATH installs ship no version metadata file we read:
		// version stays absent rather than spawned-for (spec: version optional).
		const managed = rows.find((r) => r.key === "managed");
		expect(managed?.version).toBeNull();
	});

	it("version-manager installs are enumerated for nvm, fnm, volta, asdf with path-encoded versions", () => {
		const nvm1 = "/home/u/.nvm/versions/node/v20.11.0";
		const nvm2 = "/home/u/.nvm/versions/node/v22.11.0";
		const fnm = "/home/u/.fnm/node-versions/v20.11.0/installation";
		const volta = "/home/u/.volta/tools/image/node/20.5.0";
		const asdf = "/home/u/.asdf/installs/nodejs/20.5.0";
		const fs = fakeFs(
			[nvm1, nvm2, fnm, volta, asdf].map((d) => nodeExe(d)),
			[
				nvm1, `${nvm1}/bin`,
				nvm2, `${nvm2}/bin`,
				fnm, `${fnm}/bin`,
				volta, `${volta}/bin`,
				asdf, `${asdf}/bin`,
				// Parents must be visible as directories for the scan.
				"/home/u/.nvm/versions/node",
				"/home/u/.fnm/node-versions",
				"/home/u/.volta/tools/image/node",
				"/home/u/.asdf/installs/nodejs",
			],
		);
		const deps = baseDeps({ ...fs });
		const rows = enumerateNodeCandidates(deps);
		const vmRows = rows.filter((r) =>
			(["nvm", "fnm", "volta", "asdf"] as const).includes(
				r.key as "nvm" | "fnm" | "volta" | "asdf",
			),
		);
		const versions = vmRows.flatMap((r) => r.version ?? []);
		expect(versions).toContain("20.11.0");
		expect(versions).toContain("22.11.0");
		expect(versions).toContain("20.5.0");
		const nvm = rows.filter((r) => r.key === "nvm");
		expect(nvm).toHaveLength(2);
		expect(nvm.map((r) => r.version).sort()).toEqual(["20.11.0", "22.11.0"]);
	});

	it("win32: nvm-windows root and root-level binaries are probed", () => {
		// Convention (managed-node-path tests): paths are built with the HOST
		// path module; win32-ness only changes layout names (node.exe at the
		// version-dir root), not the join separator on a posix test host.
		const versionDir = path.join(
			"C:", "Users", "u", "AppData", "Roaming", "nvm", "v20.11.0",
		);
		const exe = path.join(versionDir, "node.exe");
		const nvmParent = path.join(
			"C:", "Users", "u", "AppData", "Roaming", "nvm",
		);
		const fs = fakeFs([exe], [nvmParent, versionDir]);
		const deps = baseDeps({
			platform: "win32",
			homedir: "C:/Users/u",
			...fs,
		});
		const rows = enumerateNodeCandidates(deps);
		const nvm = rows.filter((r) => r.key === "nvm");
		expect(nvm).toHaveLength(1);
		expect(nvm[0]?.nodeEntry).toBe(exe);
		expect(nvm[0]?.version).toBe("20.11.0");
	});

	it("entries on win32 live at the root, not under bin/", () => {
		const versionDir = path.join(
			"C:", "Users", "u", "AppData", "Roaming", "nvm", "v20.11.0",
		);
		const exe = path.join(versionDir, "node.exe");
		const npmCmd = path.join(versionDir, "npm.cmd");
		const nvmParent = path.join(
			"C:", "Users", "u", "AppData", "Roaming", "nvm",
		);
		const fs = fakeFs([exe, npmCmd], [nvmParent, versionDir]);
		const deps = baseDeps({
			platform: "win32",
			homedir: "C:/Users/u",
			...fs,
		});
		const nvm = enumerateNodeCandidates(deps).find((r) => r.key === "nvm");
		expect(nvm?.nodeEntry).toBe(exe);
		expect(nvm?.npmEntry).toBe(npmCmd);
		expect(nvm?.npxEntry).toBeNull();
	});

	it("enumeration results are cached until invalidated", () => {
		let present = false;
		const deps = baseDeps({
			managedDir: "/home/u/.pi-dashboard",
			exists: () => present,
		});
		const first = enumerateNodeCandidates(deps);
		const managedBefore = first.find((r) => r.key === "managed")?.nodeEntry;
		present = true;
		// Warm cache still returned — deps are not re-read.
		const second = enumerateNodeCandidates(deps);
		expect(second.find((r) => r.key === "managed")?.nodeEntry).toBe(managedBefore);
		invalidateNodeCandidatesCache();
		const third = enumerateNodeCandidates(deps);
		expect(third.find((r) => r.key === "managed")?.nodeEntry).not.toBeNull();
	});

	it("registry.rescan() invalidates the enumeration cache", async () => {
		const { ToolRegistry, registerDefaultTools } = await import(
			"../../tool-registry/index.js"
		);
		const { OverridesStore } = await import("../../tool-registry/overrides.js");
		const registry = new ToolRegistry({
			overrides: new OverridesStore({
				filePath: path.join(
					os.tmpdir(),
					`node-candidates-test-${Math.random()}.json`,
				),
				warn: () => {},
			}),
			platform: "linux",
			env: undefined,
		});
		registerDefaultTools(registry, { exists: () => false, which: () => null });

		let present = false;
		const deps = baseDeps({
			managedDir: "/home/u/.pi-dashboard",
			exists: () => present,
		});
		const before = enumerateNodeCandidates(deps);
		expect(before.find((r) => r.key === "managed")?.nodeEntry).toBeNull();
		present = true;
		registry.rescan();
		const after = enumerateNodeCandidates(deps);
		expect(after.find((r) => r.key === "managed")?.nodeEntry).not.toBeNull();
	});
});
