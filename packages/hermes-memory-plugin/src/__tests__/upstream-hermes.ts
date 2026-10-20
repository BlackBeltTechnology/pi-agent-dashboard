/**
 * Locate + load the locally installed `pi-hermes-memory` (design D5). CI has no
 * hermes install, so callers gate on `upstreamHermes()` and `it.skipIf` it.
 *
 * The REAL user home is used (`os.userInfo().homedir`), not `$HOME`: the test
 * isolation guard points `$HOME` at a tmp dir, and this is a read-only probe.
 * `loadConfig` is loaded via a DYNAMIC jiti import after an `existsSync` gate —
 * Node refuses to type-strip TS under `node_modules`, and a static import would
 * fail collection on machines without hermes.
 *
 * See change: resync-hermes-memory-config-0-9.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UpstreamHermes {
  root: string;
  version: string;
}

export function upstreamHermes(): UpstreamHermes | null {
  const root = path.join(os.userInfo().homedir, ".pi", "agent", "npm", "node_modules", "pi-hermes-memory");
  const pkg = path.join(root, "package.json");
  if (!fs.existsSync(pkg) || !fs.existsSync(path.join(root, "src", "config.ts"))) return null;
  const { version } = JSON.parse(fs.readFileSync(pkg, "utf-8")) as { version: string };
  return { root, version };
}

/** `interface MemoryConfig { … }` member names, block-scoped (types.ts declares other interfaces). */
export function upstreamMemoryConfigKeys(up: UpstreamHermes): string[] {
  const src = fs.readFileSync(path.join(up.root, "src", "types.ts"), "utf-8");
  const block = src.match(/export interface MemoryConfig\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("interface MemoryConfig not found in upstream types.ts");
  return [...block[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

type LoadConfig = (configPath?: string) => Record<string, unknown>;

export async function upstreamLoadConfig(up: UpstreamHermes): Promise<LoadConfig> {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(path.join(up.root, "src", "config.ts"))) as { loadConfig: LoadConfig };
  return mod.loadConfig;
}
