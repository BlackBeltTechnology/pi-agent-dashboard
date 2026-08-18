/**
 * Shared pi-install module: the ONE implementation of pi install enumeration,
 * version reading, floor resolution and version comparison. Consumed by the
 * dashboard server, the runtime picker and the doctor skill (which re-exports
 * from here rather than keeping its own copy).
 *
 * See change: select-pi-runtime-install (design D1, D11).
 */

export {
	type EnumerateDeps,
	enumeratePiCandidates,
	invalidatePiCandidatesCache,
	PI_MODULE_ENTRY,
	PI_PKG_ALIASES,
	PI_SPAWN_ENTRY,
	type PiCandidate,
	type PiCandidateKey,
	pkgDirForEntry,
	samePackageDir,
} from "./candidates.js";
export {
	enumeratePiInstalls,
	PI_COMPATIBILITY_FALLBACK,
	type PiCompatibilityRange,
	type PiInstall,
	piVersionDivergence,
	readPiCompatibilityRange,
	readPiFloor,
	readPkgVersion,
	resolvePiFloor,
} from "./installs.js";
export {
	isPiOverrideTool,
	PI_OVERRIDE_TOOLS,
	type PiOverrideCheck,
	type PiOverrideValidation,
	validatePiOverridePath,
} from "./validate.js";
export {
	compareVersions,
	isAbove,
	isBelow,
	parseVersion,
} from "./versions.js";
