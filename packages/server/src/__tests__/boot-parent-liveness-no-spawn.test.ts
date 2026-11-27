/**
 * `readLivePpid()` is on the `/api/health` hot path (tray 3s, Electron, Doctor).
 * A synchronous `ps` fork there measured 1–4 s event-loop stalls on macOS, so
 * the reader must never spawn a subprocess. The premise that makes this safe —
 * `process.ppid` is LIVE (re-read per access, follows reparenting) — is pinned
 * by the second test.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const execFileSyncSpy = vi.fn(() => {
  throw new Error("readLivePpid must not spawn a subprocess");
});
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, execFileSync: execFileSyncSpy };
});

describe("readLivePpid", () => {
  it("never spawns a subprocess and matches the live process.ppid", async () => {
    const { readLivePpid } = await import("../lifecycle/boot-parent-liveness.js");
    for (let i = 0; i < 3; i++) expect(readLivePpid()).toBe(process.ppid);
    expect(execFileSyncSpy).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "process.ppid is live: it follows reparenting after the original parent exits",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "ppid-live-"));
      const out = path.join(dir, "ppid.txt");
      // Middle process spawns a detached grandchild that reads ppid before and
      // after the middle process exits (reparent to launchd/init/subreaper).
      const grandchild =
        `const fs=require("fs");const a=process.ppid;` +
        `setTimeout(()=>fs.writeFileSync(${JSON.stringify(out)},a+" "+process.ppid),1200);`;
      const middle =
        `const {spawn}=require("child_process");` +
        `spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{detached:true,stdio:"ignore"}).unref();` +
        `setTimeout(()=>process.exit(0),200);`;
      await new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ["-e", middle], { stdio: "ignore" });
        p.on("exit", () => resolve());
        p.on("error", reject);
      });
      const deadline = Date.now() + 5000;
      while (!existsSync(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      const [before, after] = readFileSync(out, "utf-8").split(" ").map(Number);
      expect(after).not.toBe(before);
    },
    10_000,
  );
});
