/**
 * Tests for family-coherence reporting (tasks 3.1–3.3).
 *
 * Coherence = the resolvable node/npm/npx members' paths owned by ONE
 * installation root. Per-tool overrides remain supported; a hand-set
 * member is reported as a deviation, never silently overwritten.
 *
 * See change: add-node-runtime-family-selection (spec: "Family
 * incoherence is reported"; design D6).
 */
import { beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../../tool-registry/index.js";
import { OverridesStore } from "../../tool-registry/overrides.js";
import { assessFamilyCoherence, detectSelectedCandidate } from "../coherence.js";
import { invalidateNodeCandidatesCache } from "../index.js";
import type { NodeCandidate } from "../candidates.js";

const ROOT_A = "/home/u/.nvm/versions/node/v22.11.0";
const ROOT_B = "/home/u/.volta/tools/image/node/20.5.0";

function cand(root: string, key: NodeCandidate["key"], entries: { node?: boolean; npm?: boolean; npx?: boolean }): NodeCandidate {
	const sub = (f: string) => `${root}/bin/${f}`;
	const mk = (ok: boolean, p: string) => (ok ? p : null);
	return {
		key,
		label: key,
		root,
		nodeEntry: mk(entries.node ?? true, sub("node")),
		npmEntry: mk(entries.npm ?? true, sub("npm")),
		npxEntry: mk(entries.npx ?? true, sub("npx")),
		version: null,
	};
}

function freshRegistry(opts: {
	overrides?: Record<string, string>;
	// Which probed paths exist (default: everything under A and B).
	exists?: (p: string) => boolean;
	/** Injected into StrategyCtx.env — used for the managed-adoption test. */
	homedir?: string;
} = {}) {
	const store = new OverridesStore({
		filePath: path.join(os.tmpdir(), `node-coherence-test-${Math.random()}.json`),
		warn: () => {},
	});
	for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);
	const registry = new ToolRegistry({
		overrides: store,
		platform: "linux",
		env: opts.homedir ? { homedir: opts.homedir } : undefined,
	});
	registerDefaultTools(registry, {
		exists: opts.exists ?? (() => true),
		which: () => null,
	});
	return registry;
}

beforeEach(() => invalidateNodeCandidatesCache());

describe("assessFamilyCoherence", () => {
	it("3.1 three members in different roots → mismatch reported, naming the deviating member and its root", () => {
		const registry = freshRegistry({
			overrides: {
				node: `${ROOT_A}/bin/node`,
				npx: `${ROOT_A}/bin/npx`,
				npm: `${ROOT_B}/bin/npm`, // deviator
			},
			exists: (p) => p.startsWith(ROOT_A) || p.startsWith(ROOT_B),
		});
		const report = assessFamilyCoherence(registry, [
			cand(ROOT_A, "nvm", {}),
			cand(ROOT_B, "volta", {}),
		]);
		expect(report.coherent).toBe(false);
		expect(report.mismatch).not.toBeNull();
		expect(report.mismatch?.deviatingMembers).toEqual([
			{ member: "npm", root: ROOT_B },
		]);
	});

	it("3.2 a legitimately absent member does not by itself constitute a mismatch", () => {
		// exists() constrained so no OTHER root (e.g. the ephemeral-HOME
		// managed dir) can answer for the absent npm member.
		const registry = freshRegistry({
			overrides: {
				node: `${ROOT_A}/bin/node`,
				npx: `${ROOT_A}/bin/npx`,
				// npm absent: partial family (e.g. distro nodejs without npm).
			},
			exists: (p) => p.startsWith(ROOT_A),
		});
		const report = assessFamilyCoherence(registry, [
			cand(ROOT_A, "nvm", { npm: false }),
		]);
		expect(report.coherent).toBe(true);
		expect(report.mismatch).toBeNull();
	});

	it("3.3 a hand-set member pointing outside the family is named as the deviation", () => {
		const registry = freshRegistry({
			overrides: {
				node: `${ROOT_A}/bin/node`,
				npm: `${ROOT_A}/bin/npm`,
				npx: "/opt/corepack/shims/npx", // hand-set, unresolvable path
			},
			exists: (p) => p.startsWith(ROOT_A),
		});
		const report = assessFamilyCoherence(registry, [
			cand(ROOT_A, "nvm", {}),
		]);
		expect(report.handSetDeviations).toEqual([
			{ member: "npx", currentPath: "/opt/corepack/shims/npx" },
		]);
		// The deviating npx belongs to no candidate root — named, not silently kept.
		expect(report.mismatch?.deviatingMembers).toEqual([
			{ member: "npx", root: "/opt/corepack/shims/npx" },
		]);
	});

	it("a coherent family under one root is not flagged and adopts the candidate as selected", () => {
		const registry = freshRegistry({
			overrides: {
				node: `${ROOT_A}/bin/node`,
				npm: `${ROOT_A}/bin/npm`,
				npx: `${ROOT_A}/bin/npx`,
			},
		});
		const report = assessFamilyCoherence(registry, [cand(ROOT_A, "nvm", {})]);
		expect(report.coherent).toBe(true);
		expect(report.mismatch).toBeNull();
		expect(report.selectedCandidateKey).toBe("nvm");
	});
});

describe("detectSelectedCandidate (migration, design D5)", () => {
	it("an existing coherent trio (no overrides, resolved via chains) is adopted as selected", () => {
		// No overrides: the trio resolves through its normal chains into
		// one candidate — e.g. a managed runtime install.
		const managedRoot = "/home/u/.pi-dashboard/node";
		const registry = freshRegistry({
			exists: (p) => p.startsWith(managedRoot),
			homedir: "/home/u",
		});
		const report = assessFamilyCoherence(registry, [
			cand(managedRoot, "managed", {}),
		]);
		expect(report.selectedCandidateKey).toBe("managed");
		expect(detectSelectedCandidate(report)).toBe("managed");
	});

	it("an incoherent or absent family starts unset", () => {
		const registry = freshRegistry({
			overrides: {
				node: `${ROOT_A}/bin/node`,
				npm: `${ROOT_B}/bin/npm`,
			},
		});
		const report = assessFamilyCoherence(registry, [
			cand(ROOT_A, "nvm", {}),
			cand(ROOT_B, "volta", {}),
		]);
		expect(detectSelectedCandidate(report)).toBeNull();
	});
});
