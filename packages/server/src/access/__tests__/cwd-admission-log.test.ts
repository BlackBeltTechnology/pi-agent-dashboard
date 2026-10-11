/**
 * Rate-limited `[cwd-admission] indeterminate` sink (test-plan E40).
 * See change: harden-plugin-cwd-admission.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CWD_ADMISSION_LOG_INTERVAL_MS,
  CWD_ADMISSION_LOG_MAX_ENTRIES,
  createIndeterminateLogger,
} from "../cwd-admission-log.js";

const info = (cwd: string, elapsedMs = 3000) => ({ cwd, failedProbes: ["git-common-dir"], elapsedMs });

describe("createIndeterminateLogger", () => {
  it("E40: one line per cwd per 60 s; the 61 s repeat logs again", () => {
    const warn = vi.fn();
    let t = 0;
    const log = createIndeterminateLogger({ warn }, () => t);
    for (const at of [0, 10_000, 59_999]) {
      t = at;
      log(info("/w"));
    }
    expect(warn).toHaveBeenCalledTimes(1);
    t = CWD_ADMISSION_LOG_INTERVAL_MS + 1000; // 61 s
    log(info("/w"));
    expect(warn).toHaveBeenCalledTimes(2);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("[cwd-admission] indeterminate");
    expect(line).toContain('"/w"');
    expect(line).toContain("git-common-dir");
    expect(line).toContain("elapsedMs=3000");
  });

  it("E40: distinct cwds are logged independently and the throttle map is LRU-bounded at 512", () => {
    const warn = vi.fn();
    const log = createIndeterminateLogger({ warn }, () => 0);
    for (let i = 0; i < CWD_ADMISSION_LOG_MAX_ENTRIES + 1; i++) log(info(`/w${i}`));
    expect(warn).toHaveBeenCalledTimes(CWD_ADMISSION_LOG_MAX_ENTRIES + 1);
    expect(log.size).toBe(CWD_ADMISSION_LOG_MAX_ENTRIES);
    // The oldest was evicted, so it logs again immediately; a recent one stays throttled.
    log(info("/w0"));
    expect(warn).toHaveBeenCalledTimes(CWD_ADMISSION_LOG_MAX_ENTRIES + 2);
    log(info(`/w${CWD_ADMISSION_LOG_MAX_ENTRIES}`));
    expect(warn).toHaveBeenCalledTimes(CWD_ADMISSION_LOG_MAX_ENTRIES + 2);
  });

  it("a hostile cwd is JSON-quoted and cannot forge a second log line", () => {
    const warn = vi.fn();
    createIndeterminateLogger({ warn }, () => 0)(info("/w\n[cwd-admission] forged"));
    expect(String(warn.mock.calls[0][0])).not.toContain("\n");
  });
});
