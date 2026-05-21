/**
 * producer-file unit tests — atomic write, unexposed-key preservation,
 * missing-file handling. See change: add-subagent-inspector §16.2.3.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	mergeIntoProducerSettings,
	readProducerFile,
	writeProducerFile,
} from "../producer-file.js";

describe("producer-file helpers", () => {
	let tmpDir: string;
	let tmpFile: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-plugin-test-"));
		tmpFile = path.join(tmpDir, "config.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("readProducerFile returns {} when file is missing", () => {
		expect(readProducerFile(tmpFile)).toEqual({});
	});

	it("readProducerFile returns {} when JSON is malformed (no throw)", () => {
		fs.writeFileSync(tmpFile, "{not valid json");
		expect(readProducerFile(tmpFile)).toEqual({});
	});

	it("readProducerFile parses a well-formed file", () => {
		fs.writeFileSync(
			tmpFile,
			JSON.stringify({ inheritContext: false, customKey: "x" }),
		);
		expect(readProducerFile(tmpFile)).toEqual({ inheritContext: false, customKey: "x" });
	});

	it("writeProducerFile is atomic (tmp + rename)", () => {
		writeProducerFile({ inheritContext: true }, tmpFile);
		const written = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
		expect(written).toEqual({ inheritContext: true });
		// No leftover .tmp files
		const leftovers = fs.readdirSync(tmpDir).filter((n) => n.includes(".tmp-"));
		expect(leftovers).toEqual([]);
	});

	it("writeProducerFile creates the parent dir when missing", () => {
		const nested = path.join(tmpDir, "deeply", "nested", "config.json");
		writeProducerFile({ inheritContext: false }, nested);
		expect(fs.existsSync(nested)).toBe(true);
	});

	it("mergeIntoProducerSettings preserves unexposed keys verbatim", () => {
		const existing = {
			inheritContext: true,
			exposeInheritanceInTool: true,
			inheritance: { recentTurns: 10, toolOutputWindow: 3, maxChars: 30000 },
			customUserKey: "keep-me",
		};
		const merged = mergeIntoProducerSettings(existing, { inheritContext: false });
		expect(merged.inheritContext).toBe(false);
		expect(merged.exposeInheritanceInTool).toBe(true);
		expect(merged.inheritance).toEqual({ recentTurns: 10, toolOutputWindow: 3, maxChars: 30000 });
		expect(merged.customUserKey).toBe("keep-me");
	});

	it("mergeIntoProducerSettings leaves inheritContext alone when patch omits it", () => {
		const existing = { inheritContext: true, other: "x" };
		const merged = mergeIntoProducerSettings(existing, {});
		expect(merged).toEqual({ inheritContext: true, other: "x" });
	});

	it("round-trip: read empty, write, read returns the new state", () => {
		expect(readProducerFile(tmpFile)).toEqual({});
		writeProducerFile({ inheritContext: false }, tmpFile);
		expect(readProducerFile(tmpFile)).toEqual({ inheritContext: false });
	});
});
