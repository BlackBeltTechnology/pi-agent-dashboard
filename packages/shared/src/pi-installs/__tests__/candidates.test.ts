/**
 * Candidate enumeration + override validation (test-plan E1–E13, E18, E20,
 * X10, X11).
 *
 * Hermetic: every candidate location is a tmp fixture tree, and the two
 * subprocess-backed lookups (`npm root -g`, PATH `which`) are injected so the
 * suite never spawns. The spawn counter in E9 is the mechanical proof of the
 * "no `pi --version` ever" invariant (design D3).
 *
 * See change: select-pi-runtime-install.
 */
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EnumerateDeps,
	enumeratePiCandidates,
	invalidatePiCandidatesCache,
	PI_MODULE_ENTRY,
	PI_SPAWN_ENTRY,
	type PiCandidate,
	samePackageDir,
	validatePiOverridePath,
} from "../index.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "pi-candidates-"));
	invalidatePiCandidatesCache();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	invalidatePiCandidatesCache();
});

const ALIAS = "@earendil-works/pi-coding-agent";

/** Write a complete pi install (package.json + both entry files) at `pkgDir`. */
function writePiInstall(pkgDir: string, version: string | null): string {
	mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
	if (version !== null) {
		writeFileSync(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ name: ALIAS, version }),
		);
	} else {
		// Present but unreadable-as-JSON → null version, no throw (X10).
		writeFileSync(path.join(pkgDir, "package.json"), "{ corrupt");
	}
	writeFileSync(path.join(pkgDir, PI_SPAWN_ENTRY), "#!/usr/bin/env node\n");
	writeFileSync(path.join(pkgDir, PI_MODULE_ENTRY), "export const pi = 1;\n");
	return pkgDir;
}

function byKey(list: PiCandidate[], key: string): PiCandidate {
	const hit = list.find((c) => c.key === key);
	if (!hit) throw new Error(`no candidate with key ${key}`);
	return hit;
}

/** A fully-populated fixture: all four derived locations hold an install. */
function fullFixture(): EnumerateDeps {
	const anchor = path.join(root, "bundle", "packages", "shared", "src");
	mkdirSync(anchor, { recursive: true });
	writePiInstall(
		path.join(root, "bundle", "node_modules", ALIAS),
		"0.84.1",
	);
	writePiInstall(
		path.join(root, "managed", "node_modules", ALIAS),
		"0.83.0",
	);
	writePiInstall(path.join(root, "npmroot", ALIAS), "0.82.0");
	writePiInstall(path.join(root, "repo", "node_modules", ALIAS), "0.81.0");
	return {
		anchorDir: anchor,
		managedDir: path.join(root, "managed"),
		npmRootGlobal: () => path.join(root, "npmroot"),
		repoRoot: path.join(root, "repo"),
	};
}

describe("enumeratePiCandidates — discovery (E1–E3, E8)", () => {
	it("E1: returns one entry per location, each carrying pkgDir + both entries + version", () => {
		const list = enumeratePiCandidates(fullFixture());
		for (const key of ["bare-import", "managed", "npm-global", "repo-root"]) {
			const c = byKey(list, key);
			expect(c.pkgDir, key).toBeTruthy();
			expect(c.spawnEntry, key).toBeTruthy();
			expect(c.moduleEntry, key).toBeTruthy();
			expect(c.version, key).toMatch(/^0\.8\d\.\d$/);
		}
		expect(byKey(list, "bare-import").version).toBe("0.84.1");
		expect(byKey(list, "repo-root").version).toBe("0.81.0");
	});

	it("E2: an absent location is reported with null path and null version, not omitted", () => {
		const deps = fullFixture();
		const list = enumeratePiCandidates({
			...deps,
			managedDir: path.join(root, "does-not-exist"),
		});
		const managed = byKey(list, "managed");
		expect(managed.pkgDir).toBeNull();
		expect(managed.version).toBeNull();
		expect(managed.spawnEntry).toBeNull();
	});

	it("E3: managed pi lives under <MANAGED_DIR>/node_modules, not <MANAGED_DIR>/package.json", () => {
		const managedDir = path.join(root, "m");
		writePiInstall(path.join(managedDir, "node_modules", ALIAS), "0.79.2");
		// Deliberately nothing at <managedDir>/package.json.
		const list = enumeratePiCandidates({ managedDir });
		expect(byKey(list, "managed").version).toBe("0.79.2");
	});

	it("E8: a resolution matching no enumerated location yields a read-only `current` row with its own version", () => {
		const deps = fullFixture();
		const stray = writePiInstall(path.join(root, "homebrew", "pi"), "0.70.0");
		const list = enumeratePiCandidates({
			...deps,
			currentSpawnPath: path.join(stray, PI_SPAWN_ENTRY),
		});
		const current = byKey(list, "current");
		expect(current.readOnly).toBe(true);
		expect(current.version).toBe("0.70.0");
	});

	it("E8 (negative): a resolution inside a known location adds no `current` row", () => {
		const deps = fullFixture();
		const list = enumeratePiCandidates({
			...deps,
			currentSpawnPath: path.join(
				root,
				"repo",
				"node_modules",
				ALIAS,
				PI_SPAWN_ENTRY,
			),
		});
		expect(list.some((c) => c.key === "current")).toBe(false);
	});
});

describe("enumeratePiCandidates — entries are files (E4, E5)", () => {
	it("E4: every populated candidate's entries are files, never directories", () => {
		const list = enumeratePiCandidates(fullFixture());
		const populated = list.filter((c) => c.pkgDir);
		expect(populated.length).toBeGreaterThan(0);
		for (const c of populated) {
			for (const entry of [c.spawnEntry, c.moduleEntry]) {
				expect(entry).toBeTruthy();
				expect(
					validatePiOverridePath(entry as string).ok,
					`${c.key}: ${entry}`,
				).toBe(true);
			}
		}
	});

	it("E5: each candidate's entries are USABLE — spawnEntry is a real .js, moduleEntry imports", async () => {
		const list = enumeratePiCandidates(fullFixture());
		for (const c of list.filter((x) => x.pkgDir)) {
			expect(c.spawnEntry).toMatch(/\.js$/);
			await expect(import(c.moduleEntry as string)).resolves.toBeTruthy();
		}
	});

	it("E5 (fails-closed): a DIRECTORY value is rejected by the same assertion", () => {
		const dir = path.join(root, "repo", "node_modules", ALIAS);
		writePiInstall(dir, "0.84.1");
		const res = validatePiOverridePath(dir);
		expect(res.ok).toBe(false);
		expect(res.failedCheck).toBe("not-a-directory");
	});
});

describe("enumeratePiCandidates — floor evaluation (E6, E7)", () => {
	it("E6: only the below-floor candidate is flagged against floor 0.78.0", () => {
		writePiInstall(path.join(root, "a", "node_modules", ALIAS), "0.77.9");
		writePiInstall(path.join(root, "b", "node_modules", ALIAS), "0.78.0");
		writePiInstall(path.join(root, "c", "node_modules", ALIAS), "0.78.1");
		const flags = ["a", "b", "c"].map((dir) => {
			invalidatePiCandidatesCache();
			const list = enumeratePiCandidates({
				managedDir: path.join(root, dir),
				floor: "0.78.0",
			});
			return byKey(list, "managed").meetsFloor;
		});
		expect(flags).toEqual([false, true, true]);
	});

	it("E7: a PATH executable with no adjacent package.json is unknown-version, unflagged and selectable", () => {
		const shim = path.join(root, "bin", "pi");
		mkdirSync(path.dirname(shim), { recursive: true });
		writeFileSync(shim, "#!/bin/sh\nexec pi \"$@\"\n");
		chmodSync(shim, 0o755);
		const list = enumeratePiCandidates({
			which: () => shim,
			floor: "0.78.0",
		});
		const onPath = byKey(list, "path");
		expect(onPath.version).toBeNull();
		expect(onPath.meetsFloor).toBe(true);
		expect(onPath.floorUnknown).toBe(true);
		expect(onPath.spawnEntry).toBe(shim);
		expect(validatePiOverridePath(shim).ok).toBe(true);
	});
});

describe("enumeratePiCandidates — no spawns, cache lifecycle (E9, E10)", () => {
	it("E9: zero pi --version spawns ever, and zero subprocess spawns on the second call", () => {
		let spawns = 0;
		const deps: EnumerateDeps = {
			...fullFixture(),
			npmRootGlobal: () => {
				spawns += 1;
				return path.join(root, "npmroot");
			},
			which: () => {
				spawns += 1;
				return null;
			},
		};
		enumeratePiCandidates(deps);
		const afterFirst = spawns;
		enumeratePiCandidates(deps);
		expect(spawns - afterFirst).toBe(0);
		// The counter wraps EVERY subprocess this module can make; a
		// `pi --version` probe would have to go through it, and none exists.
		expect(afterFirst).toBeLessThanOrEqual(2);
	});

	it("E10: invalidating the cache reflects a version changed on disk", () => {
		const managedDir = path.join(root, "m");
		const pkgDir = path.join(managedDir, "node_modules", ALIAS);
		writePiInstall(pkgDir, "0.80.0");
		expect(byKey(enumeratePiCandidates({ managedDir }), "managed").version).toBe(
			"0.80.0",
		);
		writePiInstall(pkgDir, "0.84.1");
		// Still cached …
		expect(byKey(enumeratePiCandidates({ managedDir }), "managed").version).toBe(
			"0.80.0",
		);
		invalidatePiCandidatesCache();
		expect(byKey(enumeratePiCandidates({ managedDir }), "managed").version).toBe(
			"0.84.1",
		);
	});
});

describe("enumeratePiCandidates — degradation (X10, X11)", () => {
	it("X10: an unreadable package.json yields a null version and does not throw", () => {
		const managedDir = path.join(root, "m");
		writePiInstall(path.join(managedDir, "node_modules", ALIAS), null);
		const deps = { ...fullFixture(), managedDir };
		const list = enumeratePiCandidates(deps);
		expect(byKey(list, "managed").version).toBeNull();
		expect(byKey(list, "repo-root").version).toBe("0.81.0");
	});

	it("X11: `npm root -g` failing drops only the npm-global candidate", () => {
		const list = enumeratePiCandidates({
			...fullFixture(),
			npmRootGlobal: () => {
				throw new Error("npm root -g exited 1");
			},
		});
		expect(byKey(list, "npm-global").pkgDir).toBeNull();
		expect(byKey(list, "repo-root").pkgDir).toBeTruthy();
		expect(byKey(list, "bare-import").pkgDir).toBeTruthy();
	});
});

describe("sync derivation on package directory (E18, E20)", () => {
	it("E18: the two consumers' different entry FILES in one install compare equal", () => {
		const pkgDir = writePiInstall(path.join(root, "one"), "0.84.1");
		const spawn = path.join(pkgDir, PI_SPAWN_ENTRY);
		const mod = path.join(pkgDir, PI_MODULE_ENTRY);
		expect(spawn).not.toBe(mod);
		expect(
			samePackageDir(
				validatePiOverridePath(spawn).pkgDir,
				validatePiOverridePath(mod).pkgDir,
			),
		).toBe(true);
	});

	it("E20: a symlinked path and a direct path to one install compare equal", () => {
		const pkgDir = writePiInstall(path.join(root, "real"), "0.84.1");
		const link = path.join(root, "link");
		symlinkSync(pkgDir, link);
		expect(
			samePackageDir(
				validatePiOverridePath(path.join(link, PI_SPAWN_ENTRY)).pkgDir,
				validatePiOverridePath(path.join(pkgDir, PI_MODULE_ENTRY)).pkgDir,
			),
		).toBe(true);
	});

	it("E19 (unit half): two DIFFERENT installs at the same version do NOT compare equal", () => {
		const a = writePiInstall(path.join(root, "a"), "0.84.1");
		const b = writePiInstall(path.join(root, "b"), "0.84.1");
		expect(samePackageDir(a, b)).toBe(false);
	});
});

describe("validatePiOverridePath (E11–E13)", () => {
	it("E11: a non-existent path fails the `exists` check by name", () => {
		const res = validatePiOverridePath("/nonexistent/pi");
		expect(res.ok).toBe(false);
		expect(res.failedCheck).toBe("exists");
		expect(res.reason).toContain("/nonexistent/pi");
	});

	it("E12: a real package directory fails the `not-a-directory` check by name", () => {
		const pkgDir = writePiInstall(path.join(root, "pkg"), "0.84.1");
		const res = validatePiOverridePath(pkgDir);
		expect(res.ok).toBe(false);
		expect(res.failedCheck).toBe("not-a-directory");
	});

	it("E13: an executable with no adjacent package.json is accepted with an unknown version", () => {
		const shim = path.join(root, "bin", "pi.cmd");
		mkdirSync(path.dirname(shim), { recursive: true });
		writeFileSync(shim, "@echo off\n");
		const res = validatePiOverridePath(shim);
		expect(res.ok).toBe(true);
		expect(res.version).toBeNull();
		expect(res.pkgDir).toBeNull();
	});

	it("accepts a real entry file and reports its version", () => {
		const pkgDir = writePiInstall(path.join(root, "pkg"), "0.84.1");
		const res = validatePiOverridePath(path.join(pkgDir, PI_SPAWN_ENTRY));
		expect(res.ok).toBe(true);
		expect(res.version).toBe("0.84.1");
		// Compared via realpath: macOS reports /tmp as /private/tmp.
		expect(samePackageDir(res.pkgDir, pkgDir)).toBe(true);
	});
});
