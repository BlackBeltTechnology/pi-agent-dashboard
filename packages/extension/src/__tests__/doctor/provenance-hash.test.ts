/**
 * Doctor provenance labeller + per-module knowledge-hash tests.
 *
 * See change: add-modular-doctor-skill (tasks 2.3, 4.1, 4.2, 7.1).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkDrift,
	computeKnowledgeHash,
	extractSemanticTokens,
	readStoredHash,
	writeStoredHash,
} from "../../../.pi/skills/doctor/_lib/knowledge-hash.js";
import {
	fileFact,
	serverFact,
	summariseProvenance,
} from "../../../.pi/skills/doctor/_lib/provenance.js";

describe("provenance labeller", () => {
	it("labels file-derived vs server-enriched and summarises", () => {
		const facts = [
			fileFact("pi version", "0.80.2"),
			fileFact("floor", "0.78.0"),
			serverFact("mode", "production"),
		];
		const s = summariseProvenance(facts);
		expect(s.fileDerived).toBe(2);
		expect(s.serverEnriched).toBe(1);
		expect(s.serverUnavailable).toBe(false);
	});

	it("flags serverUnavailable when no server-enriched fact is present", () => {
		const s = summariseProvenance([fileFact("pi version", "0.80.2")]);
		expect(s.serverUnavailable).toBe(true);
	});
});

describe("knowledge-hash semantic tokens", () => {
	it("is stable across whitespace / formatting changes", () => {
		const a = 'const peer = "@blackbelt-technology/pi-flows"; // v0.3.1';
		const b = "const   peer='@blackbelt-technology/pi-flows';\n\n// v0.3.1\n";
		expect(computeKnowledgeHash(extractSemanticTokens(a))).toBe(
			computeKnowledgeHash(extractSemanticTokens(b)),
		);
	});

	it("changes when a peer is renamed", () => {
		const before = 'probe("@pi/anthropic-messages")';
		const after = 'probe("@blackbelt-technology/pi-anthropic-messages")';
		expect(computeKnowledgeHash(extractSemanticTokens(before))).not.toBe(
			computeKnowledgeHash(extractSemanticTokens(after)),
		);
	});

	it("changes when the version floor is bumped", () => {
		const before = "minimum: 0.78.0";
		const after = "minimum: 0.80.0";
		expect(computeKnowledgeHash(extractSemanticTokens(before))).not.toBe(
			computeKnowledgeHash(extractSemanticTokens(after)),
		);
	});
});

describe("checkDrift", () => {
	it("drifts exactly when the stored hash mismatches the live tokens", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "doctor-hash-"));
		try {
			const hp = path.join(dir, "peers.knowledge.hash");
			const tokens = ["@blackbelt-technology/pi-flows", "0.3.1"];
			writeStoredHash(hp, computeKnowledgeHash(tokens));
			expect(readStoredHash(hp)).toBe(computeKnowledgeHash(tokens));
			expect(checkDrift("peers", tokens, hp).drifted).toBe(false);
			// rename a peer → drift
			expect(checkDrift("peers", ["@pi/pi-flows", "0.3.1"], hp).drifted).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats a missing sidecar as drift", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "doctor-hash-"));
		try {
			const hp = path.join(dir, "absent.knowledge.hash");
			expect(checkDrift("absent", ["x"], hp).drifted).toBe(true);
			expect(checkDrift("absent", ["x"], hp).stored).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});