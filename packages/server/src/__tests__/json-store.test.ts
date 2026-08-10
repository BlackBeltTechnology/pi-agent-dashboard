import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeJsonFile } from "../persistence/json-store.js";

describe("json-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readJsonFile", () => {
    it("returns fallback when file does not exist", () => {
      const result = readJsonFile(path.join(tmpDir, "missing.json"), { x: 1 });
      expect(result).toEqual({ x: 1 });
    });

    it("returns fallback for empty file", () => {
      const fp = path.join(tmpDir, "empty.json");
      fs.writeFileSync(fp, "");
      expect(readJsonFile(fp, [])).toEqual([]);
    });

    it("returns fallback for invalid JSON", () => {
      const fp = path.join(tmpDir, "bad.json");
      fs.writeFileSync(fp, "{not valid json");
      expect(readJsonFile(fp, "default")).toBe("default");
    });

    it("parses valid JSON", () => {
      const fp = path.join(tmpDir, "good.json");
      fs.writeFileSync(fp, JSON.stringify({ a: 1, b: [2, 3] }));
      expect(readJsonFile(fp, {})).toEqual({ a: 1, b: [2, 3] });
    });
  });

  describe("writeJsonFile", () => {
    it("writes JSON atomically", () => {
      const fp = path.join(tmpDir, "out.json");
      writeJsonFile(fp, { hello: "world" });
      const content = JSON.parse(fs.readFileSync(fp, "utf-8"));
      expect(content).toEqual({ hello: "world" });
    });

    it("creates parent directories", () => {
      const fp = path.join(tmpDir, "a", "b", "out.json");
      writeJsonFile(fp, [1, 2, 3]);
      expect(JSON.parse(fs.readFileSync(fp, "utf-8"))).toEqual([1, 2, 3]);
    });

    it("overwrites existing file", () => {
      const fp = path.join(tmpDir, "overwrite.json");
      writeJsonFile(fp, { v: 1 });
      writeJsonFile(fp, { v: 2 });
      expect(JSON.parse(fs.readFileSync(fp, "utf-8"))).toEqual({ v: 2 });
    });

    it("does not leave .tmp file", () => {
      const fp = path.join(tmpDir, "clean.json");
      writeJsonFile(fp, {});
      expect(fs.existsSync(fp + ".tmp")).toBe(false);
    });
  });
});
