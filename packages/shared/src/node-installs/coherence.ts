/**
 * Family-coherence reporting — when `node`, `npm`, and `npx` resolve
 * into different installation roots, SAY SO (spec: "Family incoherence
 * is reported"). Consumes registry Resolutions read-only; per-tool
 * overrides remain supported and a hand-set member is reported as a
 * deviation, never silently overwritten (design D6).
 *
 * Ownership rule: a resolved path belongs to the candidate whose ROOT
 * contains it (containment, same predicate the selection validator
 * uses) — per ROOT, not per key: two nvm versions share the key "nvm"
 * but are different installations, so a member resolving into the other
 * version's root still counts as a deviation (CodeRabbit round). A
 * resolvable member owned by NO enumerated candidate is still named —
 * as an external root — because "the family is split" is exactly what
 * the UI must surface.
 *
 * See change: add-node-runtime-family-selection.
 */

import type { ToolRegistry } from "../tool-registry/index.js";
import type { NodeCandidate, NodeCandidateKey } from "./candidates.js";
import { isInsideRoot, NODE_FAMILY_MEMBERS, type HandSetDeviation, type NodeFamilyMember } from "./select.js";

export interface MemberCoherence {
	ok: boolean;
	/** Resolved path, or the raw override when unresolvable, else null. */
	path: string | null;
	/** Owning candidate key, or null when external/absent. */
	candidateKey: NodeCandidateKey | null;
	/** True when the member carries an override that resolves elsewhere/not at all. */
	handSet: boolean;
}

export interface FamilyMismatch {
	/** Members whose root differs from the dominant root, each with its root. */
	deviatingMembers: Array<{ member: NodeFamilyMember; root: string }>;
}

export interface FamilyCoherenceReport {
	/** True when all RESOLVABLE members share one installation root. */
	coherent: boolean;
	members: Record<NodeFamilyMember, MemberCoherence>;
	mismatch: FamilyMismatch | null;
	/** Overrides that point away from the family (pre-write report, D5). */
	handSetDeviations: HandSetDeviation[];
	/**
	 * Adopted "selected" candidate under the migration rule (design D5):
	 * coherent AND (node pinned OR all three members resolve into one
	 * enumerated candidate). Display-only — adoption persists nothing.
	 */
	selectedCandidateKey: NodeCandidateKey | null;
}

/** Containment predicate: shared with the selection validator (design D3). */
function ownerKey(
	resolvedPath: string,
	candidates: NodeCandidate[],
): NodeCandidate | null {
	for (const c of candidates) {
		if (c.root && isInsideRoot(resolvedPath, c.root)) return c;
	}
	return null;
}

export function assessFamilyCoherence(
	registry: ToolRegistry,
	candidates: NodeCandidate[],
): FamilyCoherenceReport {
	const overrides = registry.listOverrides();
	const members = {} as Record<NodeFamilyMember, MemberCoherence>;
	const handSetDeviations: HandSetDeviation[] = [];
	// Root identity rides beside the key (same-key candidates differ by
	// root); null when external/absent.
	const ownerRoots = {} as Record<NodeFamilyMember, string | null>;

	for (const member of NODE_FAMILY_MEMBERS) {
		const resolution = registry.resolve(member);
		const override = overrides[member];
		const path = resolution.ok ? (resolution.path ?? null) : (override ?? null);
		const owner = path ? ownerKey(path, candidates) : null;
		members[member] = {
			ok: resolution.ok,
			path,
			candidateKey: owner?.key ?? null,
			handSet: false,
		};
		ownerRoots[member] = owner?.root ?? null;
	}

	// Dominant root = the ROOT shared by the most resolvable, owned members.
	const ownerCounts = new Map<string, number>(); // key: root ?? `ext:${path}`
	for (const member of NODE_FAMILY_MEMBERS) {
		const m = members[member];
		if (!m.path) continue;
		const k = ownerRoots[member] ?? `ext:${m.path}`;
		ownerCounts.set(k, (ownerCounts.get(k) ?? 0) + 1);
	}
	let dominant: string | null = null;
	let dominantCount = 0;
	for (const [k, n] of ownerCounts) {
		if (n > dominantCount) {
			dominant = k;
			dominantCount = n;
		}
	}

	const deviatingMembers: Array<{ member: NodeFamilyMember; root: string }> = [];
	for (const member of NODE_FAMILY_MEMBERS) {
		const m = members[member];
		if (!m.path) continue;
		const root = ownerRoots[member];
		const k = root ?? `ext:${m.path}`;
		if (k !== dominant) {
			// Name the ROOT the deviator came from — the owning candidate's
			// root when enumerable, the raw path when external.
			deviatingMembers.push({ member, root: root ?? m.path });
			if (overrides[member]) {
				m.handSet = true;
				handSetDeviations.push({ member, currentPath: overrides[member] });
			}
		}
	}

	// Coherent: all RESOLVABLE members share one root. A legitimately
	// absent member is not a mismatch (spec 3.2).
	const resolvable = NODE_FAMILY_MEMBERS.map((m) => members[m]).filter((m) => m.path);
	const coherent = resolvable.length > 0 && deviatingMembers.length === 0;

	// Migration adoption (design D5): adopt the dominant candidate when the
	// family is coherent AND either the user has explicitly pinned node
	// (override set) or ALL three members resolve (a coherent TRIO). A
	// partial family with no pin must NOT display as "selected"; an
	// incoherent family never adopts. Persisted nowhere (D5 — display
	// only). The dominant key here is a ROOT string; resolve it back to the
	// candidate's key.
	const dominantRoot = dominant !== null && !dominant.startsWith("ext:") ? dominant : null;
	const dominantCandidate = dominantRoot
		? candidates.find((c) => c.root === dominantRoot)
		: undefined;
	const nodePinned = Boolean(overrides.node);
	const adoptedKey =
		coherent && dominantCandidate && (nodePinned || resolvable.length === NODE_FAMILY_MEMBERS.length)
			? dominantCandidate.key
			: null;

	return {
		coherent,
		members,
		mismatch: deviatingMembers.length > 0 ? { deviatingMembers } : null,
		handSetDeviations,
		selectedCandidateKey: adoptedKey,
	};
}

/** The migration rule, isolated for callers that only want adoption. */
export function detectSelectedCandidate(
	report: FamilyCoherenceReport,
): NodeCandidateKey | null {
	return report.selectedCandidateKey;
}
