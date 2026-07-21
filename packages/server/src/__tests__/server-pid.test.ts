import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writePid, readPid, removePid, isProcessAlive } from "../spawn-process/server-pid.js";

describe("server-pid", () => {
  const tmpDir = path.join(os.tmpdir(), "pi-dashboard-test-pid-" + process.pid);
  const pidPath = path.join(tmpDir, "server.pid");
  const opts = { pidPath };

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("writePid", () => {
    it("writes PID to file", () => {
      writePid(12345, opts);
      const content = fs.readFileSync(pidPath, "utf-8").trim();
      expect(content).toBe("12345");
    });

    it("creates parent directories", () => {
      const nestedPath = path.join(tmpDir, "nested", "dir", "server.pid");
      writePid(99, { pidPath: nestedPath });
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  describe("readPid", () => {
    it("reads PID from file", () => {
      fs.writeFileSync(pidPath, "42\n");
      expect(readPid(opts)).toBe(42);
    });

    it("returns null for missing file", () => {
      expect(readPid(opts)).toBeNull();
    });

    it("returns null for invalid content", () => {
      fs.writeFileSync(pidPath, "not-a-number\n");
      expect(readPid(opts)).toBeNull();
    });

    it("returns null for zero", () => {
      fs.writeFileSync(pidPath, "0\n");
      expect(readPid(opts)).toBeNull();
    });

    it("returns null for negative number", () => {
      fs.writeFileSync(pidPath, "-1\n");
      expect(readPid(opts)).toBeNull();
    });
  });

  describe("removePid", () => {
    it("removes existing PID file", () => {
      fs.writeFileSync(pidPath, "42\n");
      removePid(opts);
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("does not throw for missing file", () => {
      expect(() => removePid(opts)).not.toThrow();
    });
  });

  describe("isProcessAlive", () => {
    it("returns true for current process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it("returns false for non-existent PID", () => {
      // Use a very high PID that's unlikely to exist
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  describe("writePid + readPid roundtrip", () => {
    it("can write and read back", () => {
      writePid(55555, opts);
      expect(readPid(opts)).toBe(55555);
    });
  });
});
