import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readRecommendedWizardState,
	writeRecommendedWizardState,
	isRecommendedWizardCompleted,
} from "../lib/wizard-state.js";

describe("recommended wizard state", () => {
	let testDir: string;
	let origHome: string;

	beforeEach(() => {
		testDir = path.join(
			os.tmpdir(),
			`test-wizard-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		fs.mkdirSync(path.join(testDir, ".pi-dashboard"), { recursive: true });
		origHome = process.env.HOME!;
		process.env.HOME = testDir;
	});

	afterEach(() => {
		process.env.HOME = origHome;
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it("readRecommendedWizardState returns empty defaults before first write", () => {
		expect(readRecommendedWizardState()).toEqual({ skippedRecommended: [] });
	});

	it("isRecommendedWizardCompleted is false before any write", () => {
		expect(isRecommendedWizardCompleted()).toBe(false);
	});

	it("writeRecommendedWizardState persists skipped ids", () => {
		writeRecommendedWizardState({ skippedRecommended: ["pi-agent-browser", "pi-flows"] });
		const state = readRecommendedWizardState();
		expect(state.skippedRecommended).toEqual(["pi-agent-browser", "pi-flows"]);
		expect(state.completedAt).toBeDefined();
	});

	it("isRecommendedWizardCompleted is true after a write (even with empty list)", () => {
		writeRecommendedWizardState({ skippedRecommended: [] });
		expect(isRecommendedWizardCompleted()).toBe(true);
	});

	it("write replaces, not merges, the skipped list", () => {
		writeRecommendedWizardState({ skippedRecommended: ["a", "b"] });
		writeRecommendedWizardState({ skippedRecommended: ["c"] });
		expect(readRecommendedWizardState().skippedRecommended).toEqual(["c"]);
	});

	it("readRecommendedWizardState filters non-string skipped entries", () => {
		fs.writeFileSync(
			path.join(testDir, ".pi-dashboard", "recommended.json"),
			JSON.stringify({ skippedRecommended: ["ok", 42, null, "also-ok"] }),
		);
		const state = readRecommendedWizardState();
		expect(state.skippedRecommended).toEqual(["ok", "also-ok"]);
	});
});

describe("installRecommendedExtensions resolver behaviour (shape)", () => {
	it("manifest ids resolve to the expected sources", async () => {
		const { RECOMMENDED_EXTENSIONS } = await import(
			"@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js"
		);
		const byId = new Map(RECOMMENDED_EXTENSIONS.map((e: any) => [e.id, e.source]));
		expect(byId.get("pi-anthropic-messages")).toBe(
			"https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
		);
		expect(byId.get("pi-flows")).toBe(
			"https://github.com/BlackBeltTechnology/pi-flows.git",
		);
		expect(byId.get("pi-dashboard-subagents")).toBe(
			"https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git",
		);
		expect(byId.get("pi-web-access")).toBe("npm:pi-web-access");
		expect(byId.get("pi-agent-browser")).toBe("npm:pi-agent-browser");
	});
});
