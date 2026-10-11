/** `--retriever-module <path>`: trusted local code, validated before any search (design M4). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Retriever } from "../retriever.js";
import { CliError, sha256 } from "../util.js";

export interface LoadedModule {
  path: string;
  sha256: string;
  retrievers: Retriever[];
}

export async function loadRetrieverModule(path: string, cwd: string, reservedIds: Iterable<string>): Promise<LoadedModule> {
  const abs = resolve(cwd, path);
  const fail = (reason: string): never => {
    throw new CliError(`--retriever-module ${abs}: ${reason}`);
  };
  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (e) {
    return fail(`cannot read module (${(e as Error).message})`);
  }
  let mod: { default?: unknown };
  try {
    mod = (await import(`${pathToFileURL(abs).href}?h=${sha256(bytes).slice(0, 12)}`)) as { default?: unknown };
  } catch (e) {
    return fail(`failed to load (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!Array.isArray(mod.default)) return fail("default export is not a Retriever[]");
  const seen = new Set(reservedIds);
  const out: Retriever[] = [];
  for (const [i, r] of (mod.default as unknown[]).entries()) {
    const o = r as Partial<Retriever> | null;
    if (!o || typeof o.id !== "string" || !o.id || typeof o.version !== "string" || !o.version || (o.asOf !== "strict" && o.asOf !== "none") || typeof o.search !== "function") {
      return fail(`entry ${i} is not a valid Retriever (needs id, version, asOf "strict"|"none", search())`);
    }
    if (seen.has(o.id)) return fail(`duplicate retriever id '${o.id}' (already loaded)`);
    seen.add(o.id);
    out.push(o as Retriever);
  }
  if (!out.length) return fail("default export is an empty Retriever[]");
  return { path: abs, sha256: sha256(bytes), retrievers: out };
}
