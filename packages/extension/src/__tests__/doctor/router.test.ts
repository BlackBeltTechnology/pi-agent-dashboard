/**
 * Doctor router tests: front-matter parsing, symptom routing, sweep DAG
 * ordering + short-circuit, and auto-registration of a newly-added module MD
 * with no router edit.
 *
 * See change: add-modular-doctor-skill (tasks 1.1–1.4, 7.3).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFrontMatter } from "../../../.pi/skills/doctor/_lib/front-matter.js";
import {
	buildSweepOrder,
	buildSymptomMap,
	type DoctorModule,
	loadModules,
	planSweep,
	routeSymptom,
} from "../../../.pi/skills/doctor/_lib/router.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.resolve(HERE, "../../../.pi/skills/doctor/modules");

describe("front-matter parser", () => {
	it("parses scalar, block-list, and inline-list keys", () => {
		const md = [
			"---",
			"name: sample",
			"scope: A one sentence scope.",
			"symptoms:",
			"  - first phrase",
			"  - second phrase",
			"depends-on: [env-node, pi-resolution]",
			"derives-from:",
			"  - some/source.ts",
			"---",
			"body",
		].join("\n");
		const fm = parseFrontMatter(md, "fallback");
		expect(fm.name).toBe("sample");
		expect(fm.scope).toBe("A one sentence scope.");
		expect(fm.symptoms).toEqual(["first phrase", "second phrase"]);
		expect(fm.dependsOn).toEqual(["env-node", "pi-resolution"]);
		expect(fm.derivesFrom).toEqual(["some/source.ts"]);
	});

	it("falls back to the basename when name is absent", () => {
		expect(parseFrontMatter("---\nscope: x\n---", "peers").name).toBe("peers");
	});
});

describe("router over real modules", () => {
	let modules: DoctorModule[];
	beforeAll(() => {
		modules = loadModules(MODULES_DIR);
	});

	it("loads all seven capability modules", () => {
		const names = modules.map((m) => m.name).sort();
		expect(names).toEqual([
			"build-reload",
			"env-node",
			"install-topology",
			"model-resolution",
			"peers",
			"pi-resolution",
			"plugins-bridges",
		]);
	});

	it("routes a symptom phrase to exactly one module", () => {
		expect(routeSymptom(modules, "flow won't show")).toBe("plugins-bridges");
		expect(routeSymptom(modules, "pi version mismatch")).toBe("pi-resolution");
		expect(routeSymptom(modules, "waiting_peers")).toBe("peers");
	});

	it("builds a deterministic symptom map (first declaration wins)", () => {
		const map = buildSymptomMap(modules);
		expect(map.get("waiting peers")).toBe("peers");
	});

	it("orders the sweep env → pi → peers → plugins → runtime", () => {
		const order = buildSweepOrder(modules);
		expect(order.indexOf("env-node")).toBeLessThan(order.indexOf("pi-resolution"));
		expect(order.indexOf("pi-resolution")).toBeLessThan(order.indexOf("peers"));
		expect(order.indexOf("peers")).toBeLessThan(order.indexOf("plugins-bridges"));
		expect(order.indexOf("plugins-bridges")).toBeLessThan(
			order.indexOf("model-resolution"),
		);
	});

	it("short-circuits: a missing pi suppresses the bridge, not vice-versa", () => {
		const steps = planSweep(modules, new Set(["pi-resolution"]));
		const byId = new Map(steps.map((s) => [s.module, s]));
		// pi-resolution itself is the reported root cause (not suppressed).
		expect(byId.get("pi-resolution")?.suppressed).toBe(false);
		// peers depends on pi-resolution → suppressed, attributed to pi.
		expect(byId.get("peers")?.suppressed).toBe(true);
		expect(byId.get("peers")?.suppressedBy).toBe("pi-resolution");
		// plugins-bridges transitively depends on pi → also suppressed by pi.
		expect(byId.get("plugins-bridges")?.suppressed).toBe(true);
		expect(byId.get("plugins-bridges")?.suppressedBy).toBe("pi-resolution");
		// env-node does not depend on pi → still runs.
		expect(byId.get("env-node")?.suppressed).toBe(false);
	});
});

describe("auto-registration", () => {
	it("includes a new module in routing + sweep with no router edit", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "doctor-mods-"));
		try {
			// Copy the real modules so the DAG stays valid, then add a new one.
			for (const ent of readdirSync(MODULES_DIR)) {
				if (ent.endsWith(".md")) {
					writeFileSync(path.join(dir, ent), readFileSync(path.join(MODULES_DIR, ent), "utf8"));
				}
			}
			writeFileSync(
				path.join(dir, "tunnel.md"),
				[
					"---",
					"name: tunnel",
					"scope: zrok tunnel health.",
					"symptoms:",
					"  - tunnel down",
					"depends-on:",
					"  - env-node",
					"derives-from:",
					"  - zrok-env.ts",
					"---",
					"body",
				].join("\n"),
			);
			const modules = loadModules(dir);
			expect(routeSymptom(modules, "tunnel down")).toBe("tunnel");
			expect(buildSweepOrder(modules)).toContain("tunnel");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
