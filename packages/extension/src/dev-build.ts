/**
 * Dev build-on-reload helper.
 * Builds the Vite client and requests server shutdown.
 */
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { execSync as defaultExecSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { readLocalToken } from "./local-token-header.js";

export interface DevBuildOptions {
  packageRoot: string;
  serverPort: number;
  /** @internal for testing */
  _execSync?: typeof defaultExecSync;
  /** @internal for testing */
  _fetch?: typeof fetch;
  /** @internal for testing: the local token (default: read from `~/.pi/dashboard/local/token`). */
  _token?: string | undefined;
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
    // `/api/shutdown` is an operate route: under the strict `requireLocalProof` default a bare POST is
    // refused, so dial the loopback literal and carry a proof for this exact request. No token ⇒ no
    // proof header (the refusal is then the honest answer). See change: close-container-loopback-impersonation (D5).
    const url = `http://127.0.0.1:${opts.serverPort}/api/shutdown`;
    const token = "_token" in opts ? opts._token : readLocalToken();
    const headers = token ? httpProofHeaders(token, url, "POST") : {};
    fetchFn(url, { method: "POST", headers }).catch(() => {});
    console.log("✅ Dashboard: server stopped");
  } catch {
    // Server may not be running — that's fine
  }
}
