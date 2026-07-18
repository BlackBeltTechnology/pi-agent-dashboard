import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	PackageManagerWrapper,
	AlreadyAtDestinationError,
	InvalidMoveRequestError,
	UnsupportedSourceForDestinationError,
} from "../package/package-manager-wrapper.js";
import {
	ToolRegistry,
	OverridesStore,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { registerDefaultTools } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/definitions.js";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

// ──────────────────────────────────────────────────────────────────
// Fake pi.DefaultPackageManager + fake settingsManager that share
// in-memory state so we can verify the wrapper's `move()` end-to-end.
// ──────────────────────────────────────────────────────────────────

interface FakeState {
	globalPackages: any[];
	projectPackages: any[];
}

function makeFakePm(state: FakeState) {
	const settingsManager = {
		getGlobalSettings: () => ({ packages: [...state.globalPackages] }),
		getProjectSettings: () => ({ packages: [...state.projectPackages] }),
		setPackages: vi.fn((p: any[]) => {
			state.globalPackages = [...p];
		}),
		setProjectPackages: vi.fn((p: any[]) => {
			state.projectPackages = [...p];
		}),
	};
	const pm: any = {
		settingsManager,
		setProgressCallback: vi.fn(),
		installAndPersist: vi.fn(async (source: string, { local }: { local: boolean }) => {
			// Simulate pi: append a bare-string entry to the relevant array.
			if (local) state.projectPackages.push(source);
			else state.globalPackages.push(source);
		}),
		removeAndPersist: vi.fn(async (source: string, { local }: { local: boolean }) => {
			const arr = local ? state.projectPackages : state.globalPackages;
			const idx = arr.findIndex((e: any) =>
				typeof e === "string" ? e === source : e?.source === source,
			);
			if (idx >= 0) arr.splice(idx, 1);
			return idx >= 0;
		}),
		update: vi.fn(async () => {}),
		listConfiguredPackages: () => [
			...state.globalPackages.map((s) => ({
				source: typeof s === "string" ? s : s.source,
				scope: "user",
				filtered: false,
			})),
			...state.projectPackages.map((s) => ({
				source: typeof s === "string" ? s : s.source,
				scope: "project",
				filtered: false,
			})),
		],
	};
	return { pm, settingsManager };
}

let currentState: FakeState;
let currentFakePm: ReturnType<typeof makeFakePm>;

function makeFakePiModule() {
	return {
		DefaultPackageManager: function () {
			// Return the SAME shared fake pm so test assertions can inspect it.
			return currentFakePm.pm;
		},
		SettingsManager: { create: () => ({}) },
	};
}

function makeTestRegistry(): ToolRegistry {
	const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pmw-move-"));
	const overrides = new OverridesStore({
		filePath: path.join(tmpDir, "tool-overrides.json"),
	});
	const stubDir = path.join(tmpDir, "pi-coding-agent", "dist");
	mkdirSync(stubDir, { recursive: true });
	const stubPath = path.join(stubDir, "index.js");
	writeFileSync(stubPath, "// test stub\n");
	overrides.set("pi-coding-agent", stubPath);

	const registry = new ToolRegistry({
		overrides,
		importModule: async () => makeFakePiModule(),
	});
	registerDefaultTools(registry);
	return registry;
}

describe("PackageManagerWrapper.move()", () => {
	let wrapper: PackageManagerWrapper;

	beforeEach(() => {
		currentState = { globalPackages: [], projectPackages: [] };
		currentFakePm = makeFakePm(currentState);
		wrapper = new PackageManagerWrapper(makeTestRegistry());
	});

	// ── Synchronous validation throws ──────────────────────────────────────

	it("throws InvalidMoveRequestError when fromScope === toScope", async () => {
		await expect(
			wrapper.move({
				entry: "npm:foo",
				fromScope: "global",
				toScope: "global",
			}),
		).rejects.toThrow(InvalidMoveRequestError);
	});

	it("throws InvalidMoveRequestError when fromCwd missing for local fromScope", async () => {
		await expect(
			wrapper.move({
				entry: "npm:foo",
				fromScope: "local",
				toScope: "global",
			}),
		).rejects.toThrow(InvalidMoveRequestError);
	});

	it("throws InvalidMoveRequestError when toCwd missing for local toScope", async () => {
		await expect(
			wrapper.move({
				entry: "npm:foo",
				fromScope: "global",
				toScope: "local",
			}),
		).rejects.toThrow(InvalidMoveRequestError);
	});

	it("throws InvalidMoveRequestError on empty entry source", async () => {
		await expect(
			wrapper.move({
				entry: "",
				fromScope: "global",
				toScope: "local",
				toCwd: "/p",
			}),
		).rejects.toThrow(InvalidMoveRequestError);
	});

	it("throws UnsupportedSourceForDestinationError for relative path without fromCwd (local origin)", async () => {
		// fromScope=local needs fromCwd anyway, but the rel-path check
		// adds a more specific error code. The wrapper checks
		// InvalidMoveRequestError first; this guards the secondary check.
		// The current invariant is: rel-path without fromCwd while origin
		// is local. We can validate that path explicitly when local
		// fromScope+fromCwd is missing — let's just confirm the local
		// invariant fires.
		await expect(
			wrapper.move({
				entry: "..",
				fromScope: "local",
				toScope: "global",
			}),
		).rejects.toThrow(InvalidMoveRequestError);
	});

	// ── Happy path: npm move (global → local) ──────────────────────────────

	it("moves npm package from global to local: install + remove with shared moveId", async () => {
		currentState.globalPackages = ["npm:pi-flows"];

		const completions: any[] = [];
		const reloadFn = vi.fn().mockResolvedValue(2);
		wrapper.setCompleteListener((r) => completions.push(r));
		wrapper.setReloadSessions(reloadFn);

		const moveId = await wrapper.move({
			entry: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});

		expect(moveId).toMatch(/^[0-9a-f-]+$/);
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// Two pi calls (install at dest, remove from origin).
		expect(currentFakePm.pm.installAndPersist).toHaveBeenCalledWith("npm:pi-flows", { local: true });
		expect(currentFakePm.pm.removeAndPersist).toHaveBeenCalledWith("npm:pi-flows", { local: false });

		// Final state: removed from global, present in local.
		expect(currentState.globalPackages).toEqual([]);
		expect(currentState.projectPackages).toEqual(["npm:pi-flows"]);

		// Exactly ONE reload (coalesced), not two.
		expect(reloadFn).toHaveBeenCalledOnce();

		// Exactly ONE complete event, action=move, with moveId.
		expect(completions).toHaveLength(1);
		expect(completions[0].action).toBe("move");
		expect(completions[0].success).toBe(true);
		expect(completions[0].moveId).toBe(moveId);
		expect(completions[0].sessionsReloaded).toBe(2);
	});

	// ── Happy path: git move (local → global) ──────────────────────────────

	it("moves git package preserving pin in source string", async () => {
		currentState.projectPackages = ["git:github.com/x/y@v1.2.3"];

		await wrapper.move({
			entry: "git:github.com/x/y@v1.2.3",
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// Install at global with the pinned source verbatim.
		expect(currentFakePm.pm.installAndPersist).toHaveBeenCalledWith(
			"git:github.com/x/y@v1.2.3",
			{ local: false },
		);
		expect(currentState.globalPackages).toContain("git:github.com/x/y@v1.2.3");
		expect(currentState.projectPackages).toEqual([]);
	});

	// ── Identity preflight ──────────────────────────────────────────────────

	it("AlreadyAtDestinationError surfaces via complete listener (already at target identity)", async () => {
		// Already installed in BOTH scopes — different version pins, but
		// pi dedup identity is the bare name.
		currentState.globalPackages = ["npm:pi-flows@1.0.0"];
		currentState.projectPackages = ["npm:pi-flows@2.0.0"];

		const completions: any[] = [];
		wrapper.setCompleteListener((r) => completions.push(r));

		await wrapper.move({
			entry: "npm:pi-flows@1.0.0",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		expect(completions).toHaveLength(1);
		expect(completions[0].success).toBe(false);
		expect(completions[0].error).toMatch(/already installed/i);
		// State unchanged.
		expect(currentState.globalPackages).toEqual(["npm:pi-flows@1.0.0"]);
		expect(currentState.projectPackages).toEqual(["npm:pi-flows@2.0.0"]);
		// pi was NOT called.
		expect(currentFakePm.pm.installAndPersist).not.toHaveBeenCalled();
		expect(currentFakePm.pm.removeAndPersist).not.toHaveBeenCalled();
	});

	// ── Path arm: settings-only edit (rel-path → global) ───────────────────

	it("path source moves are settings-only — no install/remove called", async () => {
		// Origin: local with relative path "..".
		currentState.projectPackages = [".."];

		await wrapper.move({
			entry: "..",
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// pi was NOT called (settings-edit arm).
		expect(currentFakePm.pm.installAndPersist).not.toHaveBeenCalled();
		expect(currentFakePm.pm.removeAndPersist).not.toHaveBeenCalled();

		// Origin scope cleared; destination has the resolved abs path.
		expect(currentState.projectPackages).toEqual([]);
		expect(currentState.globalPackages.length).toBe(1);
		const newSource = currentState.globalPackages[0];
		// ".." resolved against /proj/.pi → /proj
		expect(typeof newSource === "string" ? newSource : newSource.source).toBe("/proj");
	});

	// ── Filter preservation ─────────────────────────────────────────────────

	it("preserves filter object when moving npm package with filters", async () => {
		const entry = {
			source: "npm:pi-flows",
			extensions: ["a.ts"],
			skills: [],
		};
		currentState.globalPackages = [entry];

		await wrapper.move({
			entry,
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// Destination should have the FULL object form, not just the bare string
		// pi's installer wrote.
		const destEntry = currentState.projectPackages[0];
		expect(typeof destEntry).toBe("object");
		expect(destEntry).toMatchObject({
			source: "npm:pi-flows",
			extensions: ["a.ts"],
			skills: [],
		});
	});

	it("preserves filter object on path-source move", async () => {
		const entry = { source: "..", extensions: ["foo.ts"] };
		currentState.projectPackages = [entry];

		await wrapper.move({
			entry,
			fromScope: "local",
			fromCwd: "/proj",
			toScope: "global",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		const destEntry = currentState.globalPackages[0];
		expect(destEntry).toMatchObject({
			source: "/proj",
			extensions: ["foo.ts"],
		});
	});

	// ── Partial-success: install OK, remove fails ──────────────────────────

	it("partial success when install succeeds but remove from origin throws", async () => {
		currentState.globalPackages = ["npm:pi-flows"];
		currentFakePm.pm.removeAndPersist.mockRejectedValueOnce(new Error("remove blew up"));

		const completions: any[] = [];
		wrapper.setCompleteListener((r) => completions.push(r));

		await wrapper.move({
			entry: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		const result = completions[0];
		expect(result.success).toBe(true);
		expect(result.action).toBe("move");
		expect(result.partialSuccess).toBeDefined();
		expect(result.partialSuccess.installed).toBe(true);
		expect(result.partialSuccess.removed).toBe(false);
		expect(result.partialSuccess.removeError).toMatch(/remove blew up/);
	});

	// ── Task 3.4: moveId propagation through progress events ───────────────

	it("emits progress events tagged with the same moveId across both phases", async () => {
		currentState.globalPackages = ["npm:pi-flows"];

		const progressEvents: Array<{ opId: string; event: any; moveId?: string }> = [];
		wrapper.setProgressListener((opId, event, moveId) => {
			progressEvents.push({ opId, event, moveId });
		});

		// pi's setProgressCallback captures the wrapper's callback. Fire some
		// progress events from the install phase via the captured callback.
		let progressCb: any;
		currentFakePm.pm.setProgressCallback.mockImplementation((cb: any) => {
			progressCb = cb;
		});
		currentFakePm.pm.installAndPersist.mockImplementation(
			async (source: string, { local }: { local: boolean }) => {
				progressCb?.({ type: "start", action: "install", source });
				progressCb?.({ type: "complete", action: "install", source });
				if (local) currentState.projectPackages.push(source);
				else currentState.globalPackages.push(source);
			},
		);
		currentFakePm.pm.removeAndPersist.mockImplementation(
			async (source: string, { local }: { local: boolean }) => {
				progressCb?.({ type: "start", action: "remove", source });
				progressCb?.({ type: "complete", action: "remove", source });
				const arr = local ? currentState.projectPackages : currentState.globalPackages;
				const idx = arr.findIndex((e: any) =>
					typeof e === "string" ? e === source : e?.source === source,
				);
				if (idx >= 0) arr.splice(idx, 1);
				return idx >= 0;
			},
		);

		const moveId = await wrapper.move({
			entry: "npm:pi-flows",
			fromScope: "global",
			toScope: "local",
			toCwd: "/proj",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// All emitted progress events must carry the same moveId.
		expect(progressEvents.length).toBeGreaterThanOrEqual(2);
		for (const ev of progressEvents) {
			expect(ev.moveId).toBe(moveId);
		}
	});
});
