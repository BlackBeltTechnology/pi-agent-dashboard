import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("nested-process-worker", () => {
  it("exits when its Force-Stopped parent process no longer exists", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const parent = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 100)"]);
    const child = spawn(process.execPath, [resolve(here, "../nested-process-worker.mjs")], {
      env: { ...process.env, PI_DASHBOARD_NESTED_PARENT_PID: String(parent.pid) },
      stdio: "ignore",
    });
    await once(parent, "exit");
    const [code] = await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("worker did not exit")), 10_000)),
    ]);
    expect(code).toBe(0);
  });
});
