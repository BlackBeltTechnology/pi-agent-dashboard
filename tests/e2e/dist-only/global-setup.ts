import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CANARY_ID, DIST_ONLY_MARKER, REPO_ROOT } from "./dist-only-lifecycle.js";

/**
 * Bootstrap the dist-only server for the `dist-only` Playwright project (task 8.5): a clean install prefix,
 * the prebuilt canary staged UNTRUSTED under `<prefix>/.pi/dashboard/plugins`, `pi-dashboard start` on a free port.
 * Sets `PW_DIST_ONLY_URL` for the workers. With `PW_DIST_ONLY_URL` already set it only attaches.
 *
 * The install mirrors `qa/tests/35-plugin-install-load.sh` (registry version, or local tarballs + overrides
 * through `QA_DASHBOARD_TARBALL` / `QA_EXTRA_TARBALLS`). The canary is staged by `scripts/stage-runtime-canary.mjs`
 * (built ONCE; nothing is rebuilt after the hash is taken).
 */
const BOOT_TIMEOUT_MS = Number(process.env.QA_BOOT_TIMEOUT ?? 90) * 1000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout).slice(-800)}`);
}

/** `package.json` for the app dir: the dashboard tarball + every first-party tarball forced local. */
function writeAppManifest(app: string, dashboardSpec: string, extras: string[]): void {
  const nameOf = (t: string) => JSON.parse(execFileSync("tar", ["-xzOf", t, "package/package.json"], { encoding: "utf8" })).name as string;
  const local = (t: string) => (/\.(tgz|tar\.gz)$/.test(t) ? `file:${t}` : t);
  const byName = Object.fromEntries(extras.map((t) => [nameOf(t), t]));
  const dependencies: Record<string, string> = {};
  const isTarball = /\.(tgz|tar\.gz)$/.test(dashboardSpec);
  dependencies[isTarball ? nameOf(dashboardSpec) : "@blackbelt-technology/pi-agent-dashboard"] = isTarball ? local(dashboardSpec) : dashboardSpec;
  const overrides: Record<string, string> = {};
  for (const [name, t] of Object.entries(byName)) {
    if (name in dependencies) dependencies[name] = `file:${t}`;
    else overrides[name] = `file:${t}`;
  }
  fs.writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({ name: "dist-only-prefix", private: true, version: "0.0.0", dependencies, ...(Object.keys(overrides).length ? { overrides } : {}) }, null, 2),
  );
}

async function waitHealthy(url: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3_000) })).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`dist-only server never answered /api/health 200 at ${url} within ${BOOT_TIMEOUT_MS / 1000}s`);
}

export default async function distOnlyGlobalSetup(): Promise<void> {
  if (process.env.PW_DIST_ONLY_URL) {
    await waitHealthy(process.env.PW_DIST_ONLY_URL);
    return; // attach: the caller owns the server (and put the canary in its plugins dir)
  }

  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dist-only-"));
  const app = path.join(prefix, "app");
  fs.mkdirSync(app, { recursive: true });
  const tarball = process.env.QA_DASHBOARD_TARBALL;
  const spec = tarball ?? `@blackbelt-technology/pi-agent-dashboard@${process.env.QA_DASHBOARD_VERSION ?? "latest"}`;
  writeAppManifest(app, spec, (process.env.QA_EXTRA_TARBALLS ?? "").split(/\s+/).filter(Boolean));
  sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: app });
  const binDir = path.join(app, "node_modules", ".bin");

  // Canary: staged untrusted (no pin), then copied in as a plain directory plugin.
  const stageDir = path.join(prefix, "canary-stage");
  const { stageRuntimeCanary } = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "stage-runtime-canary.mjs")).href)) as {
    stageRuntimeCanary: (o: { outDir: string; mode: "trusted" | "untrusted" }) => Promise<unknown>;
  };
  await stageRuntimeCanary({ outDir: stageDir, mode: "untrusted" });
  const pluginsDir = path.join(prefix, ".pi", "dashboard", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.cpSync(path.join(stageDir, "plugins", CANARY_ID), path.join(pluginsDir, CANARY_ID), { recursive: true });

  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: prefix, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
  delete env.JITI_TSCONFIG_PATHS;
  fs.writeFileSync(DIST_ONLY_MARKER, JSON.stringify({ prefix, binDir, port }));
  sh("pi-dashboard", ["start", "--port", String(port), "--no-tunnel"], { env });
  const url = `http://localhost:${port}`;
  await waitHealthy(url);
  process.env.PW_DIST_ONLY_URL = url; // workers spawn after global-setup and inherit this
}
