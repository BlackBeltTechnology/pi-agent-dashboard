/**
 * Tests for PackageManagerWrapper.reset() — the atomic reset-to-npm op:
 * install `npm:<name>` FIRST, then remove the local/git entry, same scope.
 * Mirrors the move op's install-first / remove-second machinery.
 * See change: reset-override-to-npm.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerDefaultTools } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/definitions.js";
import {
	OverridesStore,
	ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	InvalidResetRequestError,
	PackageManagerWrapper,
} from "../package/package-manager-wrapper.js";

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
		listConfiguredPackages: () => [],
	};
	return { pm, settingsManager };
}

let currentState: FakeState;
let currentFakePm: ReturnType<typeof makeFakePm>;

function makeFakePiModule() {
	return {
		DefaultPackageManager: function () {
			return currentFakePm.pm;
		},
		SettingsManager: { create: () => ({}) },
	};
}

function makeTestRegistry(): ToolRegistry {
	const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pmw-reset-"));
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

describe("PackageManagerWrapper.reset()", () => {
	let wrapper: PackageManagerWrapper;

	beforeEach(() => {
		currentState = { globalPackages: [], projectPackages: [] };
		currentFakePm = makeFakePm(currentState);
		wrapper = new PackageManagerWrapper(makeTestRegistry());
	});

	it("throws InvalidResetRequestError on empty source or publishedSource", async () => {
		await expect(
			wrapper.reset({ source: "", publishedSource: "npm:pi-web-access", scope: "global" }),
		).rejects.toThrow(InvalidResetRequestError);
		await expect(
			wrapper.reset({ source: "/local/x", publishedSource: "", scope: "global" }),
		).rejects.toThrow(InvalidResetRequestError);
	});

	it("throws InvalidResetRequestError when scope is local without cwd", async () => {
		await expect(
			wrapper.reset({ source: "/local/x", publishedSource: "npm:x", scope: "local" }),
		).rejects.toThrow(InvalidResetRequestError);
	});

	it("success: installs npm first, then removes the local entry (same scope), emits action=reset", async () => {
		currentState.globalPackages = ["/home/dev/pi-web-access"];

		const completions: any[] = [];
		const reloadFn = vi.fn().mockResolvedValue(3);
		wrapper.setCompleteListener((r) => completions.push(r));
		wrapper.setReloadSessions(reloadFn);

		const resetId = await wrapper.reset({
			source: "/home/dev/pi-web-access",
			publishedSource: "npm:pi-web-access",
			scope: "global",
		});
		expect(resetId).toMatch(/^[0-9a-f-]+$/);
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		// Install ran before remove.
		const installOrder = currentFakePm.pm.installAndPersist.mock.invocationCallOrder[0];
		const removeOrder = currentFakePm.pm.removeAndPersist.mock.invocationCallOrder[0];
		expect(installOrder).toBeLessThan(removeOrder);

		expect(currentFakePm.pm.installAndPersist).toHaveBeenCalledWith("npm:pi-web-access", { local: false });
		expect(currentFakePm.pm.removeAndPersist).toHaveBeenCalledWith("/home/dev/pi-web-access", { local: false });

		// Only npm remains.
		expect(currentState.globalPackages).toEqual(["npm:pi-web-access"]);

		expect(reloadFn).toHaveBeenCalledOnce();
		expect(completions).toHaveLength(1);
		expect(completions[0].action).toBe("reset");
		expect(completions[0].success).toBe(true);
		expect(completions[0].moveId).toBe(resetId);
		expect(completions[0].sessionsReloaded).toBe(3);
	});

	it("install failure leaves the local entry intact and reports failure", async () => {
		currentState.globalPackages = ["/home/dev/pi-web-access"];
		currentFakePm.pm.installAndPersist.mockRejectedValueOnce(new Error("npm 404"));

		const completions: any[] = [];
		wrapper.setCompleteListener((r) => completions.push(r));

		await wrapper.reset({
			source: "/home/dev/pi-web-access",
			publishedSource: "npm:pi-web-access",
			scope: "global",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		expect(completions[0].success).toBe(false);
		expect(completions[0].error).toMatch(/npm 404/);
		// Local entry untouched; remove never ran.
		expect(currentState.globalPackages).toEqual(["/home/dev/pi-web-access"]);
		expect(currentFakePm.pm.removeAndPersist).not.toHaveBeenCalled();
	});

	it("partial success when remove fails after a good install", async () => {
		currentState.globalPackages = ["/home/dev/pi-web-access"];
		currentFakePm.pm.removeAndPersist.mockRejectedValueOnce(new Error("EPERM unlink"));

		const completions: any[] = [];
		wrapper.setCompleteListener((r) => completions.push(r));

		await wrapper.reset({
			source: "/home/dev/pi-web-access",
			publishedSource: "npm:pi-web-access",
			scope: "global",
		});
		await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

		const result = completions[0];
		expect(result.success).toBe(true);
		expect(result.action).toBe("reset");
		expect(result.partialSuccess).toBeDefined();
		expect(result.partialSuccess.installed).toBe(true);
		expect(result.partialSuccess.removed).toBe(false);
		expect(result.partialSuccess.removeError).toMatch(/EPERM unlink/);
		// npm installed; local link still present.
		expect(currentState.globalPackages).toContain("npm:pi-web-access");
		expect(currentState.globalPackages).toContain("/home/dev/pi-web-access");
	});
});
