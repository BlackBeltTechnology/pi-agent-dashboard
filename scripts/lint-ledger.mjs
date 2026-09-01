/**
 * Promise-rule ledger helpers for the type-aware lint ladder.
 *
 * Two jobs, both of which the ladder got wrong by hand at least once:
 *
 * 1. `enumerateSites` — count sites from Biome's own diagnostics, with NO
 *    extension filter. A `.ts|.tsx|.mjs|.js|.jsx` filter previously dropped
 *    `packages/server/src/rpc-keeper/keeper.cjs:141`, produced 142 instead of
 *    143, and the gap was then rationalised as a phantom duplicate — which is
 *    what concealed the electron orphan.
 *
 * 2. `findOrphanSites` — every live diagnostic must fall inside some rung's
 *    claimed scope. A site owned by no rung is a permanent graduation blocker,
 *    because the ratchet graduates on repo-root `biome lint .`.
 *
 * See change: cleanup-client-plugin-promises.
 */
import { spawnSync } from "node:child_process";

/** Scopes claimed by the ladder's rungs. Order is irrelevant; coverage is not. */
export const LADDER_SCOPES = [
  { change: "cleanup-client-plugin-promises", prefixes: ["packages/client/", "packages/flows-plugin/", "packages/roles-plugin/", "packages/shell/", "packages/subagents-plugin/", "packages/automation-plugin/", "scripts/"] },
  { change: "cleanup-async-semantics-server-extension", prefixes: ["packages/server/", "packages/extension/", "packages/electron/"] },
];

/**
 * Every diagnostic site as `path:line`, straight from Biome's diagnostics.
 * Never filter by extension — count what Biome counted.
 */
export function enumerateSites(report) {
  const diagnostics = report?.diagnostics ?? [];
  return diagnostics.map((d) => `${d.location.path}:${d.location.start.line}`);
}

/**
 * Biome's JSON report, tolerating the non-zero exit it returns for ANY
 * diagnostic.
 *
 * Callers narrow the sites to git-tracked files afterwards, so a diagnostic in
 * an untracked scratch file is noise they already handle. Treating the exit
 * CODE as the failure signal defeats that: `execFileSync` throws before the
 * filter runs, and one stray unparseable file anywhere in the tree takes out
 * every test in this harness. Only unparseable stdout is a real failure.
 */
export function parseBiomeReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    const head = String(stdout ?? "").slice(0, 200);
    throw new Error(`biome did not emit parseable JSON (--reporter=json). First 200 chars: ${head}`, { cause });
  }
}

/** Run one Biome rule repo-wide and return its parsed report. */
export function runBiomeRule(rule, { cwd, maxDiagnostics = 20000 } = {}) {
  const { stdout, error } = spawnSync(
    "npx",
    ["biome", "lint", `--only=lint/nursery/${rule}`, ".", `--max-diagnostics=${maxDiagnostics}`, "--reporter=json"],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (error) throw error;
  return parseBiomeReport(stdout);
}

/** Sites falling outside every claimed scope — i.e. owned by no rung. */
export function findOrphanSites(sites, scopes = LADDER_SCOPES) {
  return sites.filter(
    (site) => !scopes.some((s) => s.prefixes.some((p) => site.startsWith(p))),
  );
}

/** Sites owned by one named rung. */
export function sitesOwnedBy(sites, changeName, scopes = LADDER_SCOPES) {
  const scope = scopes.find((s) => s.change === changeName);
  if (!scope) throw new Error(`unknown rung: ${changeName}`);
  return sites.filter((site) => scope.prefixes.some((p) => site.startsWith(p)));
}
