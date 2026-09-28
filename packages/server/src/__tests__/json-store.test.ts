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

    // A stale `.tmp` left by a crash keeps its old mode, because writeFileSync's
    // `mode` only applies on create. The chmod must be unconditional.
    // See change: add-server-push-notifications (test-plan #X14).
    it.skipIf(process.platform === "win32")(
      "writes mode 0600 even over a stale 0644 .tmp (test-plan #X14)",
      () => {
        const fp = path.join(tmpDir, "push-tokens.json");
        fs.writeFileSync(fp + ".tmp", "stale", { mode: 0o644 });
        fs.chmodSync(fp + ".tmp", 0o644);
        writeJsonFile(fp, { tokens: [] }, { mode: 0o600 });
        expect(fs.statSync(fp).mode & 0o777).toBe(0o600);
        expect(fs.existsSync(fp + ".tmp")).toBe(false);
        expect(JSON.parse(fs.readFileSync(fp, "utf-8"))).toEqual({ tokens: [] });
      },
    );
  });
});
