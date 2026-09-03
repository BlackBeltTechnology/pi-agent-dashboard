/**
 * Override-path validation for the two pi consumers (`pi`, `pi-coding-agent`).
 *
 * `overrideStrategy` only checks `exists(p)`, so any path on disk is accepted
 * today and subsequently spawned as pi on every session start. This validator
 * runs at the WRITE boundary instead (design D6): the picker and the existing
 * free-text Tools inputs both go through it.
 *
 * It accepts EITHER a resolvable pi package directory (which yields a version)
 * OR a plain executable file (a Windows `.cmd` shim has no adjacent pi
 * `package.json`; requiring one would make a legitimate install permanently
 * unpinnable). A DIRECTORY is always rejected — illegal for both consumers.
 *
 * Explicitly not a sandbox: it prevents fat-finger and drive-by
 * misconfiguration, not a determined operator who can already spawn sessions.
 * Two consequences are accepted rather than hidden:
 *   - TOCTOU: the path is validated at write time and executed later, so a
 *     file swapped in between is not caught. The real control on this surface
 *     is the route's `networkGuard`, not this function.
 *   - Any readable file is accepted; there is no signature or provenance check.
 *
 * See change: select-pi-runtime-install.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { type EnumerateDeps, pkgDirForEntry } from "./candidates.js";
import { readPkgVersion } from "./installs.js";

/** Names of the checks, so a 400 can say exactly which one failed. */
export type PiOverrideCheck = "exists" | "not-a-directory";

export interface PiOverrideValidation {
	ok: boolean;
	/** Which check failed; undefined when `ok`. */
	failedCheck?: PiOverrideCheck;
	/** Human-readable reason naming the failed check; undefined when `ok`. */
	reason?: string;
	/** Realpath'd path, when it exists. */
	resolvedPath: string | null;
	/** Containing pi package directory, or null when there is none. */
	pkgDir: string | null;
	/** Declared version, or null when there is no readable package.json. */
	version: string | null;
}

/** The two tools whose overrides this validator governs. */
export const PI_OVERRIDE_TOOLS = ["pi", "pi-coding-agent"] as const;

export function isPiOverrideTool(name: string): boolean {
	return (PI_OVERRIDE_TOOLS as readonly string[]).includes(name);
}

export function validatePiOverridePath(
	candidatePath: string,
	deps: EnumerateDeps = {},
): PiOverrideValidation {
	const exists = deps.exists ?? existsSync;
	const isDirectory =
		deps.isDirectory ??
		((p: string) => {
			try {
				return statSync(p).isDirectory();
			} catch {
				return false;
			}
		});
	const realpath =
		deps.realpath ??
		((p: string) => {
			try {
				return realpathSync(p);
			} catch {
				return p;
			}
		});
	const readVersion = deps.readVersion ?? readPkgVersion;

	if (!candidatePath || !exists(candidatePath)) {
		return {
			ok: false,
			failedCheck: "exists",
			reason: `path does not exist: ${candidatePath}`,
			resolvedPath: null,
			pkgDir: null,
			version: null,
		};
	}

	const resolvedPath = realpath(candidatePath);

	if (isDirectory(resolvedPath)) {
		return {
			ok: false,
			failedCheck: "not-a-directory",
			reason: `path is a directory, but pi overrides must point at an entry file: ${candidatePath}`,
			resolvedPath,
			pkgDir: null,
			version: null,
		};
	}

	// Accepted. A version is a bonus, not a requirement — a bare executable
	// with no adjacent package.json stays selectable with an unknown version.
	const pkgDir = pkgDirForEntry(resolvedPath, deps);
	return {
		ok: true,
		resolvedPath,
		pkgDir,
		version: pkgDir ? readVersion(`${pkgDir}/package.json`) : null,
	};
}
