/**
 * Tests for atomic Node family selection (tasks 2.1–2.4).
 *
 * The single-write property is the point: ONE `registry.setOverrides()`
 * call persists the whole family (or nothing). Spies assert on CALL
 * COUNT, not just the resulting file.
 *
 * See change: add-node-runtime-family-selection (spec: "One selection
 * writes the whole family atomically"; design D5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../../tool-registry/index.js";
import { OverridesStore } from "../../tool-registry/overrides.js";
import {
	applySelection,
	planSelection,
	type NodeCandidate,
} from "../select.js";

function tmpStore(): OverridesStore {
	return new OverridesStore({
		filePath: path.join(os.tmpdir(), `node-select-test-${Math.random()}.json`),
		warn: () => {},
	});
}

function freshRegistry(opts: {
	exists?: (p: string) => boolean;
	overrides?: Record<string, string>;
	which?: (n: string) => string | null;
} = {}) {
	const store = tmpStore();
	for (const [k, v] of Object.entries(opts.overrides ?? {})) store.set(k, v);
	const registry = new ToolRegistry({
		overrides: store,
		platform: "linux",
		env: undefined,
	});
	registerDefaultTools(registry, {
		exists: opts.exists ?? (() => true),
		which: opts.which ?? (() => null),
	});
	return { registry, store };
}

function candidate(partial: Partial<NodeCandidate>): NodeCandidate {
	return {
		key: "nvm",
		label: "nvm",
		root: "/home/u/.nvm/versions/node/v22.11.0",
		nodeEntry: `${partial.root ?? "/home/u/.nvm/versions/node/v22.11.0"}/bin/node`,
		npmEntry: `${partial.root ?? "/home/u/.nvm/versions/node/v22.11.0"}/bin/npm`,
		npxEntry: `${partial.root ?? "/home/u/.nvm/versions/node/v22.11.0"}/bin/npx`,
		version: "22.11.0",
		...partial,
	};
}

describe("planSelection", () => {
	it("a full candidate plans all three keys", () => {
		const plan = planSelection({
			candidate: candidate({}),
			currentOverrides: {},
		});
		expect(Object.keys(plan.changes).sort()).toEqual(["node", "npm", "npx"]);
		expect(plan.handSetDeviations).toEqual([]);
	});

	it("an absent member plans a CLEAR, not a fabricated path", () => {
		const plan = planSelection({
			candidate: candidate({ npmEntry: null }),
			currentOverrides: {},
		});
		expect(plan.changes.npm).toBeNull();
		expect(plan.changes.node).toBe(
			"/home/u/.nvm/versions/node/v22.11.0/bin/node",
		);
	});

	it("a hand-set member is reported as a deviation and PRESERVED by default", () => {
		const plan = planSelection({
			candidate: candidate({}),
			currentOverrides: {
				npx: "/opt/corepack/shims/npx",
			},
		});
		expect(plan.handSetDeviations).toEqual([
			{ member: "npx", currentPath: "/opt/corepack/shims/npx" },
		]);
		expect("npx" in plan.changes).toBe(false);
	});

	it("a hand-set member whose path already equals the candidate entry is NOT a deviation", () => {
		const entry = "/home/u/.nvm/versions/node/v22.11.0/bin/npx";
		const plan = planSelection({
			candidate: candidate({ npxEntry: entry }),
			currentOverrides: { npx: entry },
		});
		expect(plan.handSetDeviations).toEqual([]);
		expect(plan.changes.npx).toBe(entry);
	});

	it("discardHandSet plans the overwrite for exactly the discarded members", () => {
		const plan = planSelection({
			candidate: candidate({}),
			currentOverrides: {
				npx: "/opt/corepack/shims/npx",
				npm: "/opt/volta/shims/npm",
			},
			discardHandSet: ["npx"],
		});
		expect("npx" in plan.changes).toBe(true);
		expect("npm" in plan.changes).toBe(false);
	});
});

describe("applySelection", () => {
	beforeEach(() => {
		// select.ts has no module cache, but keep the discipline uniform.
	});

	it("2.1 selecting a full candidate persists all three keys in ONE setOverrides call", () => {
		const { registry } = freshRegistry();
		const spy = vi.spyOn(registry, "setOverrides");
		const result = applySelection(registry, candidate({}), { exists: () => true });
		expect(result.ok).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		const arg = spy.mock.calls[0]?.[0] as Record<string, string | null>;
		expect(Object.keys(arg).sort()).toEqual(["node", "npm", "npx"]);
		spy.mockRestore();
	});

	it("2.2 selecting a candidate with an absent member CLEARS that override in the same write (via explicit discard of the prior value)", () => {
		// A prior npm override differing from the candidate entry is hand-set
		// by definition (design D5) — preserved unless discarded. The clear
		// is exercised through the discard path; it still happens in the
		// SAME single write.
		const { registry } = freshRegistry({
			overrides: { npm: "/old/npm" },
		});
		const spy = vi.spyOn(registry, "setOverrides");
		const result = applySelection(
			registry,
			candidate({ npmEntry: null }),
			{ exists: () => true },
			["npm"],
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan.handSetDeviations.map((d) => d.member)).toEqual(["npm"]);
		}
		expect(spy).toHaveBeenCalledTimes(1);
		const arg = spy.mock.calls[0]?.[0] as Record<string, string | null>;
		expect(arg.npm).toBeNull();
		spy.mockRestore();
	});

	it("2.3a a path outside the selected root is rejected and NOTHING is persisted", () => {
		const { registry } = freshRegistry();
		const spy = vi.spyOn(registry, "setOverrides");
		const bad = candidate({
			nodeEntry: "/elsewhere/bin/node",
		});
		const result = applySelection(registry, bad, {
			exists: () => true,
		});
		expect(result.ok).toBe(false);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("2.3b a DIRECTORY at an entry path is rejected and NOTHING is persisted", () => {
		const { registry } = freshRegistry();
		const spy = vi.spyOn(registry, "setOverrides");
		const result = applySelection(registry, candidate({}), {
			exists: () => true,
			isDirectory: (p) => p.endsWith("/node"),
		});
		expect(result.ok).toBe(false);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("2.3c a missing entry file is rejected and NOTHING is persisted", () => {
		const { registry } = freshRegistry();
		const spy = vi.spyOn(registry, "setOverrides");
		const result = applySelection(registry, candidate({}), {
			exists: () => false,
		});
		expect(result.ok).toBe(false);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("hand-set members are preserved across the write unless discarded", () => {
		const { registry, store } = freshRegistry({
			overrides: { npx: "/opt/corepack/shims/npx" },
		});
		const result = applySelection(registry, candidate({}), { exists: () => true });
		expect(result.ok).toBe(true);
		const overrides = store.list();
		expect(overrides.npx).toBe("/opt/corepack/shims/npx");
		expect(overrides.node).toBe(
			"/home/u/.nvm/versions/node/v22.11.0/bin/node",
		);
	});
});
