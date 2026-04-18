/**
 * Tests for cross-platform port-holder detection.
 * See change: fix-windows-server-parity.
 */
import { describe, it, expect, vi } from "vitest";
import { findPortHolders, parseNetstatListeners } from "../cli.js";

describe("parseNetstatListeners", () => {
  const selfPid = 99999;

  it("parses Windows netstat -ano output for a listening PID", () => {
    const output = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       12345",
      "  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4",
      "  TCP    127.0.0.1:8000         127.0.0.1:54321        ESTABLISHED     23456",
    ].join("\r\n");

    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([12345]);
  });

  it("excludes non-LISTENING rows (ESTABLISHED, TIME_WAIT)", () => {
    const output = [
      "  TCP    0.0.0.0:9999           0.0.0.0:0              ESTABLISHED     11111",
      "  TCP    0.0.0.0:9999           0.0.0.0:0              TIME_WAIT       22222",
    ].join("\n");
    expect(parseNetstatListeners(output, 9999, selfPid)).toEqual([]);
  });

  it("excludes the current process PID", () => {
    const output = `  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       ${selfPid}`;
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([]);
  });

  it("only matches the requested port (suffix-based)", () => {
    const output = [
      "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       1111",
      "  TCP    0.0.0.0:18000          0.0.0.0:0              LISTENING       2222",
      "  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       3333",
    ].join("\n");
    expect(parseNetstatListeners(output, 8000, selfPid).sort()).toEqual([1111]);
  });

  it("returns empty array for empty or garbage input", () => {
    expect(parseNetstatListeners("", 8000, selfPid)).toEqual([]);
    expect(parseNetstatListeners("not a netstat output\nblah", 8000, selfPid)).toEqual([]);
  });

  it("handles IPv6 listening addresses", () => {
    const output = "  TCP    [::]:8000              [::]:0                 LISTENING       7777";
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([7777]);
  });
});

describe("findPortHolders", () => {
  it("uses netstat on Windows (via injected exec)", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const exec = vi.fn().mockReturnValue(
        "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       12345\n",
      );
      const result = findPortHolders(8000, exec as any);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][0]).toMatch(/netstat/i);
      expect(exec.mock.calls[0][0]).not.toMatch(/lsof/i);
      expect(result).toEqual([12345]);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("uses lsof on Unix (via injected exec)", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const exec = vi.fn().mockReturnValue("12345\n67890\n");
      const result = findPortHolders(8000, exec as any);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][0]).toMatch(/lsof/);
      expect(exec.mock.calls[0][0]).toContain(":8000");
      expect(result.sort()).toEqual([12345, 67890].sort());
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("returns empty array on exec failure (best-effort)", () => {
    const exec = vi.fn().mockImplementation(() => { throw new Error("boom"); });
    expect(findPortHolders(8000, exec as any)).toEqual([]);
  });
});
