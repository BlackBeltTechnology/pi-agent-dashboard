/**
 * Source-assertion for the `model-proxy` probe wiring in `server.ts`.
 *
 * The probe is satisfied by a boot-time mount flag, not a live `loadConfig()`
 * read: route registration is itself boot-frozen, so a later config save must
 * not flip the reported value. This guards the declaration/assignment shape
 * and that ALL THREE `RequirementProbeDeps` sites inject the closure.
 *
 * Pattern: `plugin-spawn-scope-env.test.ts`. See change:
 * remove-pi-model-proxy-upstream-references (E8, X2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"),
	"utf8",
);

const count = (needle: string): number => source.split(needle).length - 1;

describe("model-proxy probe wiring in server.ts (E8, X2)", () => {
	it("E8: all three RequirementProbeDeps sites inject isModelProxyEnabled", () => {
		expect(count("isModelProxyEnabled: () => modelProxyMounted")).toBe(3);
	});

	it("E8: modelProxyMounted is declared once, above the first injection site", () => {
		expect(count("let modelProxyMounted")).toBe(1);
		const decl = source.indexOf("let modelProxyMounted");
		const firstSite = source.indexOf("isModelProxyEnabled: () => modelProxyMounted");
		expect(firstSite).toBeGreaterThan(-1);
		expect(decl).toBeLessThan(firstSite);
	});

	it("X2: the boot value is assigned exactly once, inside the Model Proxy block", () => {
		const assign = "modelProxyMounted = fullCfg.modelProxy.enabled";
		expect(count(assign)).toBe(1);
		const assignIdx = source.indexOf(assign);
		// The `{ const fullCfg = loadConfig(); … }` block is the Model Proxy block.
		const cfgIdx = source.indexOf("const fullCfg = loadConfig();");
		expect(cfgIdx).toBeGreaterThan(-1);
		expect(assignIdx).toBeGreaterThan(cfgIdx);
	});

	it("X2: no other read/write of modelProxyMounted exists in the file", () => {
		const lines = source.split("\n").filter((l) => l.includes("modelProxyMounted"));
		expect(lines).toHaveLength(5);
		for (const line of lines) {
			const allowed =
				line.includes("let modelProxyMounted") ||
				line.includes("modelProxyMounted = fullCfg.modelProxy.enabled") ||
				line.includes("isModelProxyEnabled: () => modelProxyMounted");
			expect(allowed, `unexpected modelProxyMounted line: ${line.trim()}`).toBe(true);
		}
	});
});
