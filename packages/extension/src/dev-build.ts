/**
 * Dev build-on-reload helper.
 * Builds the Vite client and requests server shutdown.
 */
import { execSync as defaultExecSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export interface DevBuildOptions {
  packageRoot: string;
  serverPort: number;
  /** @internal for testing */
  _execSync?: typeof defaultExecSync;
  /** @internal for testing */
  _fetch?: typeof fetch;
}

/**
 * Run the dev build and shutdown sequence.
 * Errors are caught and logged — never throws.
 */
export function runDevBuild(opts: DevBuildOptions): void {
  const execSyncFn = opts._execSync ?? defaultExecSync;
  const fetchFn = opts._fetch ?? fetch;

  try {
    console.log("🔨 Dashboard: building client...");
    execSyncFn("npm run build", { cwd: opts.packageRoot, stdio: "inherit" });
    console.log("✅ Dashboard: client built");
  } catch (err: any) {
    console.log(`❌ Dashboard: build failed — ${err.message}`);
  }

  try {
    console.log("🛑 Dashboard: stopping server...");
    fetchFn(`http://localhost:${opts.serverPort}/api/shutdown`, { method: "POST" }).catch(() => {});
    console.log("✅ Dashboard: server stopped");
  } catch {
    // Server may not be running — that's fine
  }
}
