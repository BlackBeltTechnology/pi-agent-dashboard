/**
 * Resolve how to start the host child: in a checkout (`host.ts` beside this file and `tsx`
 * resolvable) run the TypeScript source through tsx; otherwise run the bundled `host.js` (this
 * module is bundled into `dist/blender.js`, so "beside" is `dist/`). V8 flags always precede
 * `--import`, mirroring `bin/pi-craft`.
 *
 * See change: add-blender-wasm-mcp (design D2, task 3.1).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const JSPI_FLAG = "--experimental-wasm-jspi";

export interface HostEntry {
  /** Arguments after `process.execPath`, without V8 flags or host arguments. */
  args: string[];
}

function resolveTsx(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve("tsx");
  } catch {
    return undefined;
  }
}

export function resolveHostEntry(): HostEntry {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, "host.ts");
  const tsx = existsSync(src) ? resolveTsx() : undefined;
  if (tsx) return { args: ["--import", tsx, src] };
  return { args: [join(here, "host.js")] };
}

/** Full argv for the host: V8 `flags` first, then the entry, then host `extra` arguments. */
export function hostArgv(flags: readonly string[], extra: readonly string[]): string[] {
  return [...flags, ...resolveHostEntry().args, ...extra];
}
