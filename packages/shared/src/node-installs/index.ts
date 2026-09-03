/**
 * Node installation enumeration + selection — the Node family picker's
 * shared foundation. Structural exemplar: `pi-installs`.
 *
 * See change: add-node-runtime-family-selection.
 */
export {
	NODE_CANDIDATE_KEYS,
	type EnumerateNodeDeps,
	enumerateNodeCandidates,
	invalidateNodeCandidatesCache,
	type NodeCandidate,
	type NodeCandidateKey,
} from "./candidates.js";
export {
	applySelection,
	isInsideRoot,
	NODE_FAMILY_MEMBERS,
	planSelection,
	type ApplySelectionDeps,
	type ApplySelectionResult,
	type HandSetDeviation,
	type NodeFamilyMember,
	type PlanSelectionInput,
	type SelectionPlan,
} from "./select.js";
export {
	versionFromDirName,
	scanVersionManagerInstalls,
	type VmInstallDir,
} from "./vm-roots.js";
export {
	prependSelectedNodeToPath,
	type ChildPathDeps,
} from "./child-path.js";
export {
	assessFamilyCoherence,
	detectSelectedCandidate,
	type FamilyCoherenceReport,
	type FamilyMismatch,
	type MemberCoherence,
} from "./coherence.js";
