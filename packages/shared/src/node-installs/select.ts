/**
 * Atomic Node family selection — ONE `registry.setOverrides()` call
 * persists the whole family (or nothing). Structural sibling of the pi
 * picker's two-key fan-out (select-pi-runtime-install design D7); the
 * family has three keys, and the absent-member rule is the new part.
 *
 * Write rules (spec "One selection writes the whole family atomically";
 * design D5):
 * - member entry present → override set to the entry file;
 * - member entry absent → override CLEARED, unless the key is HAND-SET;
 * - HAND-SET (override exists and differs from the candidate's entry) →
 *   reported as a deviation and PRESERVED unless explicitly discarded —
 *   hand-set always outranks the absent-member clear.
 * - every written path is validated (existing FILE inside the selected
 *   root) BEFORE anything persists; a failure rejects the whole
 *   selection.
 *
 * See change: add-node-runtime-family-selection.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ToolRegistry } from "../tool-registry/index.js";
import type { NodeCandidate } from "./candidates.js";

/** Re-exported for callers that type against this module. */
export type { NodeCandidate };

/** The three family members, in canonical order. */
export const NODE_FAMILY_MEMBERS = ["node", "npm", "npx"] as const;
export type NodeFamilyMember = (typeof NODE_FAMILY_MEMBERS)[number];

/** A member whose current override points somewhere else than the candidate. */
export interface HandSetDeviation {
	member: NodeFamilyMember;
	currentPath: string;
}

export interface SelectionPlan {
	/**
	 * Changes for ONE `registry.setOverrides()` call. Only keys that
	 * actually change appear; an absent value means "clear this key".
	 */
	changes: Partial<Record<NodeFamilyMember, string | null>>;
	/** Hand-set members detected before the write, for the pre-write report. */
	handSetDeviations: HandSetDeviation[];
}

export interface PlanSelectionInput {
	candidate: NodeCandidate;
	currentOverrides: Readonly<Record<string, string>>;
	/** Hand-set members the user chose to discard (overwrite) anyway. */
	discardHandSet?: readonly NodeFamilyMember[];
}

/**
 * Pure: compute what a selection would write WITHOUT writing it. The UI
 * renders `handSetDeviations` before the write (spec: "reported before
 * the write").
 */
export function planSelection(input: PlanSelectionInput): SelectionPlan {
	const { candidate, currentOverrides, discardHandSet } = input;
	const changes: Partial<Record<NodeFamilyMember, string | null>> = {};
	const handSetDeviations: HandSetDeviation[] = [];
	for (const member of NODE_FAMILY_MEMBERS) {
		const entry = candidate[`${member}Entry` as const];
		const current = currentOverrides[member];
		const handSet =
			current !== undefined && current !== "" && current !== entry;
		if (handSet) handSetDeviations.push({ member, currentPath: current });
		if (handSet && !(discardHandSet ?? []).includes(member)) {
			// Preserved: leave the key untouched entirely.
			continue;
		}
		if (entry === null) {
			// Absent member: clear rather than point at a missing path.
			// (Only reachable for non-hand-set keys — hand-set keys either
			// preserved above or explicitly discarded, in which case an
			// absent member clears them too.) Planning the clear
			// unconditionally keeps the write an expression of the family
			// state; clearing an absent key is a harmless no-op.
			changes[member] = null;
			continue;
		}
		changes[member] = entry;
	}
	return { changes, handSetDeviations };
}

export interface ApplySelectionDeps {
	/** Existence probe (injectable for tests); default `fs.existsSync`. */
	exists?(p: string): boolean;
	/** Directory probe; default `fs.statSync(p).isDirectory()`. */
	isDirectory?(p: string): boolean;
}

export type ApplySelectionResult =
	| { ok: true; plan: SelectionPlan }
	| { ok: false; reason: string };

/**
 * Validate + persist a selection in ONE atomic write. Nothing persists
 * when any written path fails validation (all-or-nothing). Reads the
 * current overrides from the registry itself — the registry is the
 * source of truth for hand-set detection.
 */
export function applySelection(
	registry: ToolRegistry,
	candidate: NodeCandidate,
	deps: ApplySelectionDeps = {},
	discardHandSet: readonly NodeFamilyMember[] = [],
): ApplySelectionResult {
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
	const plan = planSelection({
		candidate,
		currentOverrides: registry.listOverrides(),
		discardHandSet,
	});

	// Validate EVERY entry the candidate exposes (not just changed keys):
	// the write atomically pins the family to this installation, so a
	// broken member is a broken selection even if its key was already set.
	for (const member of NODE_FAMILY_MEMBERS) {
		const entry = candidate[`${member}Entry` as const];
		if (entry === null) continue;
		if (!exists(entry)) {
			return { ok: false, reason: `entry does not exist: ${entry}` };
		}
		if (isDirectory(entry)) {
			return { ok: false, reason: `entry is a directory, not a file: ${entry}` };
		}
		const root = candidate.root;
		if (!root || !isInsideRoot(entry, root)) {
			return {
				ok: false,
				reason: `entry outside the selected installation root: ${entry}`,
			};
		}
	}

	registry.setOverrides(plan.changes as Record<string, string | null>);
	return { ok: true, plan };
}

/** Containment by construction — see design D3; rejects tampered paths. */
export function isInsideRoot(entry: string, root: string): boolean {
	const rel = path.relative(root, entry);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
