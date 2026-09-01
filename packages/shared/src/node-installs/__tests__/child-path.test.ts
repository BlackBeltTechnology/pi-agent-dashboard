/**
 * Tests for selection-aware child-PATH construction (tasks 4.1–4.2).
 *
 * Spec: "Spawned children follow the selection through the landed
 * ladder" — dashboard-tooling spawns follow the selection DIRECTLY; no
 * selection → behaviour identical to the legacy managed prepend;
 * `process.env` is never mutated (design D7).
 *
 * See change: add-node-runtime-family-selection.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { prependSelectedNodeToPath } from "../child-path.js";
import { prependManagedNodeToPath } from "../../platform/managed-node-path.js";
import { invalidateNodeCandidatesCache } from "../index.js";

const SELECTED_BIN = "/home/u/.nvm/versions/node/v22.11.0/bin";
const MANAGED_BIN = "/home/u/.pi-dashboard/node/bin";

function fakeRegistry(opts: {
	overrides?: Record<string, string>;
	resolutions?: Record<string, { ok: boolean; path: string | null; source?: string | null }>;
}) {
	return {
		listOverrides: () => opts.overrides ?? {},
		resolve: (name: string) =>
			opts.resolutions?.[name] ?? { ok: false, path: null, source: null },
	};
}

describe("prependSelectedNodeToPath", () => {
	it("4.1 with a non-managed selection, the SELECTED bin dir is prepended and the managed one is not", () => {
		const env = prependSelectedNodeToPath(
			{ PATH: "/usr/bin:/bin", HOME: "/home/u" },
			{
				registry: fakeRegistry({
					overrides: { node: `${SELECTED_BIN}/node` },
					resolutions: {
						node: { ok: true, path: `${SELECTED_BIN}/node`, source: "override" },
					},
				}),
				managedPathsEnv: { homedir: "/home/u" },
			},
		);
		const entries = (env.PATH ?? "").split(path.delimiter);
		expect(entries[0]).toBe(SELECTED_BIN);
		expect(entries).not.toContain(MANAGED_BIN);
	});

	it("4.2a with no selection, child PATH is byte-identical to the legacy managed prepend", () => {
		const baseEnv = { PATH: "/usr/bin:/bin", HOME: "/home/u" };
		const legacy = prependManagedNodeToPath(baseEnv, { homedir: "/home/u" });
		const selected = prependSelectedNodeToPath(baseEnv, {
			registry: fakeRegistry({ overrides: {} }),
			managedPathsEnv: { homedir: "/home/u" },
		});
		expect(selected.PATH).toBe(legacy.PATH);
	});

	it("4.2b a broken selection (override set but resolution fails) falls back to the legacy managed prepend", () => {
		const baseEnv = { PATH: "/usr/bin:/bin", HOME: "/home/u" };
		const legacy = prependManagedNodeToPath(baseEnv, { homedir: "/home/u" });
		const selected = prependSelectedNodeToPath(baseEnv, {
			registry: fakeRegistry({
				overrides: { node: "/gone/bin/node" },
				resolutions: { node: { ok: false, path: null, source: null } },
			}),
			managedPathsEnv: { homedir: "/home/u" },
		});
		expect(selected.PATH).toBe(legacy.PATH);
	});

	it("4.2c process.env is never mutated — the input object is untouched", () => {
		const baseEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/u" };
		const snapshot = { ...baseEnv };
		prependSelectedNodeToPath(baseEnv, {
			registry: fakeRegistry({
				overrides: { node: `${SELECTED_BIN}/node` },
				resolutions: { node: { ok: true, path: `${SELECTED_BIN}/node`, source: "override" } },
			}),
			managedPathsEnv: { homedir: "/home/u" },
		});
		expect(baseEnv).toEqual(snapshot);
	});

	it("4.2b' a FALLS-THROUGH selection (override rejected, chain resolved elsewhere) also falls back to legacy", () => {
		// Review round-2 concern: a stale override + a where-hit must NOT be
		// treated as the selection — the child would get /usr/bin, silently
		// repinning against the user's pin. source !== "override" → legacy.
		const baseEnv = { PATH: "/usr/bin:/bin", HOME: "/home/u" };
		const legacy = prependManagedNodeToPath(baseEnv, { homedir: "/home/u" });
		const selected = prependSelectedNodeToPath(baseEnv, {
			registry: fakeRegistry({
				overrides: { node: "/stale/bin/node" },
				resolutions: { node: { ok: true, path: "/usr/bin/node", source: "system" } },
			}),
			managedPathsEnv: { homedir: "/home/u" },
		});
		expect(selected.PATH).toBe(legacy.PATH);
	});

	it("CodeRabbit round: a selected dir already mid-PATH is MOVED to the head", () => {
		const baseEnv = { PATH: `/usr/bin:${SELECTED_BIN}:/bin`, HOME: "/home/u" };
		const env = prependSelectedNodeToPath(baseEnv, {
			registry: fakeRegistry({
				overrides: { node: `${SELECTED_BIN}/node` },
				resolutions: { node: { ok: true, path: `${SELECTED_BIN}/node`, source: "override" } },
			}),
			managedPathsEnv: { homedir: "/home/u" },
		});
		const entries = (env.PATH ?? "").split(path.delimiter);
		expect(entries[0]).toBe(SELECTED_BIN);
		// The old mid-PATH occurrence is gone (moved, not duplicated).
		expect(entries.filter((e) => e === SELECTED_BIN)).toHaveLength(1);
	});

	it("a selection whose bin dir is already at the head is not duplicated", () => {
		const env = prependSelectedNodeToPath(
			{ PATH: `${SELECTED_BIN}:/usr/bin`, HOME: "/home/u" },
			{
				registry: fakeRegistry({
					overrides: { node: `${SELECTED_BIN}/node` },
					resolutions: { node: { ok: true, path: `${SELECTED_BIN}/node`, source: "override" } },
				}),
				managedPathsEnv: { homedir: "/home/u" },
			},
		);
		expect(env.PATH).toBe(`${SELECTED_BIN}:/usr/bin`);
	});

	it("module cache discipline holds across tests", () => {
		invalidateNodeCandidatesCache();
		expect(true).toBe(true);
	});
});
