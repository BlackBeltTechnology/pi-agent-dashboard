import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { writePid, readPid, removePid, isProcessAlive, isServerRunning } from "../spawn-process/server-pid.js";

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

  // See change: harden-dashboard-start-detection (test-plan #E16, #E17).
  describe("isServerRunning", () => {
    it("#E16 keeps the pid file of a live process whose dashboard stays silent", async () => {
      fs.writeFileSync(pidPath, `${process.pid}\n`);
      const before = fs.readFileSync(pidPath);
      const probe = vi.fn(async () => ({ running: false, timedOut: true }));
      expect(await isServerRunning(8000, { ...opts, probe })).toBeNull();
      expect(fs.readFileSync(pidPath).equals(before)).toBe(true);
      // bounded retries, not a single 2 s shot
      expect(probe).toHaveBeenCalledWith(8000, undefined, expect.objectContaining({ retries: 2, timeoutMs: 2000 }));
    });

    it("#E17 removes the pid file of a dead process", async () => {
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid!;
      fs.writeFileSync(pidPath, `${dead}\n`);
      const probe = vi.fn(async () => ({ running: false }));
      expect(await isServerRunning(8000, { ...opts, probe })).toBeNull();
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("returns the pid when the live process answers as the dashboard", async () => {
      fs.writeFileSync(pidPath, `${process.pid}\n`);
      const probe = vi.fn(async () => ({ running: true, pid: process.pid }));
      expect(await isServerRunning(8000, { ...opts, probe })).toBe(process.pid);
    });
  });
});
