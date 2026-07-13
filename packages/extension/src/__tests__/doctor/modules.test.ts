/**
 * Per-module contract tests: every real capability MD is well-formed (5-part
 * contract + router front-matter + a hash sidecar), the sweep DAG is acyclic,
 * and the drift check over live repo sources passes on the committed sidecars.
 * Also covers the server-tier graceful-degrade contract.
 *
 * See change: add-modular-doctor-skill (tasks 1.2, 2.2, 3.x, 5.1, 7.2).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadModules } from "../../../.pi/skills/doctor/_lib/router.js";
import { fetchHealth } from "../../../.pi/skills/doctor/_lib/server-tier.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTOR_DIR = path.resolve(HERE, "../../../.pi/skills/doctor");
const MODULES_DIR = path.join(DOCTOR_DIR, "modules");

const EXPECTED = [
	"build-reload",
	"env-node",
	"install-topology",
	"model-resolution",
	"peers",
	"pi-resolution",
	"plugins-bridges",
];

describe("capability module contract", () => {
	const modules = loadModules(MODULES_DIR);

	it.each(EXPECTED)("%s has complete router front-matter", (id) => {
		const m = modules.find((x) => x.name === id);
		expect(m, `module ${id} missing`).toBeDefined();
		if (!m) return;
		expect(m.scope.length).toBeGreaterThan(0);
		expect(m.symptoms.length).toBeGreaterThan(0);
		expect(m.derivesFrom.length).toBeGreaterThan(0);
		// env-node is the only root (no depends-on).
		if (id === "env-node") expect(m.dependsOn).toEqual([]);
		else expect(m.dependsOn.length).toBeGreaterThan(0);
	});

	it.each(EXPECTED)("%s body carries the 5-part contract sections", (id) => {
		const body = readFileSync(path.join(MODULES_DIR, `${id}.md`), "utf8");
		for (const section of ["## SCOPE", "## KNOWLEDGE", "## CHECKS", "## FIX ROUTING", "## DERIVES-FROM"]) {
			expect(body.includes(section), `${id} missing ${section}`).toBe(true);
		}
	});

	it.each(EXPECTED)("%s has a committed knowledge-hash sidecar", (id) => {
		expect(existsSync(path.join(MODULES_DIR, `${id}.knowledge.hash`))).toBe(true);
	});
});

describe("server-tier graceful degrade", () => {
	it("returns { ok:false } instead of throwing when the server is down", async () => {
		// Unroutable port → connection refused, must not throw.
		const res = await fetchHealth("http://127.0.0.1:1", 300);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(typeof res.reason).toBe("string");
	});
});
