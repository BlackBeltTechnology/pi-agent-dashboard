// Shared section-fetch resolver for the `kb_get` tool and the `kb get` CLI, so
// the two surfaces cannot diverge again. Resolves a path argument across EVERY
// indexed root (store-derived, remote included), accepts source-qualified
// paths, never silently picks one of several matches, and falls back from an
// exact heading path to a unique last heading.
// See change: fix-kb-get-roots-and-guard (design D1–D4).

import { relative } from "node:path";
import type { Chunk } from "./types.js";

/** A fetchable root. `relDir` (repo-relative, `/`-separated) exists only for
 *  filesystem roots; remote roots resolve by literal or id-qualified path. */
export interface FetchRoot {
  id: string;
  relDir?: string;
}

/** The store surface `resolveFetch` needs. */
export interface FetchStore {
  getChunk(root: string, path: string, headingPath?: string): Chunk | null;
  getChunkBySection?(root: string, path: string, section: string): Chunk[];
  /** All chunks of one file in document order (lists sections on a miss). */
  getChunks(root: string, path: string): Chunk[];
}

/** Most heading paths listed after a section-not-found marker. */
const SECTION_LIST_CAP = 50;

export type FetchResult =
  | { kind: "hit"; root: string; path: string; chunk: Chunk }
  | { kind: "ambiguous"; on: "path" | "section"; candidates: string[] }
  /** The path resolved, the section did not; `sections` = the file's distinct
   *  body heading paths in document order (frontmatter `:meta` excluded). */
  | { kind: "section-missing"; sections: string[] }
  | { kind: "missing" };

/** Build fetch roots from the store's distinct roots; `relDir` comes from the
 *  matching filesystem source (`relative(cwd, dir)`, normalized to `/`). */
export function buildFetchRoots(rootIds: string[], fsSources: Array<{ id: string; dir: string }>, cwd: string): FetchRoot[] {
  const dirs = new Map(fsSources.map((s) => [s.id, relative(cwd, s.dir).replace(/\\/g, "/")]));
  return rootIds.map((id) => (dirs.has(id) ? { id, relDir: dirs.get(id) } : { id }));
}

/** Every (root, path) reading of `arg` that exists in the store (design D2). */
function pathReadings(store: FetchStore, roots: FetchRoot[], arg: string): Array<{ root: string; path: string }> {
  const readings = new Map<string, { root: string; path: string }>();
  const add = (root: string, path: string) => {
    const key = `${root}\0${path}`;
    if (path && !readings.has(key) && store.getChunk(root, path)) readings.set(key, { root, path });
  };
  // 1. literal
  for (const r of roots) add(r.id, arg);
  // 2. id-qualified — the LONGEST matching id wins, so ids containing `:` round-trip
  const byId = roots.filter((r) => arg.startsWith(`${r.id}:`)).sort((a, b) => b.id.length - a.id.length)[0];
  if (byId) add(byId.id, arg.slice(byId.id.length + 1));
  // 3. dir-qualified
  for (const r of roots) {
    if (r.relDir && r.relDir !== "." && arg.startsWith(`${r.relDir}/`)) add(r.id, arg.slice(r.relDir.length + 1));
  }
  return [...readings.values()];
}

/** Section lookup inside one resolved file (design D3). */
function resolveSection(store: FetchStore, root: string, path: string, section: string): FetchResult {
  const matches = store.getChunkBySection ? store.getChunkBySection(root, path, section) : [store.getChunk(root, path, section)].filter((c): c is Chunk => !!c);
  // A long section split into several chunks shares one heading path — one section.
  const headings = [...new Set(matches.map((c) => c.headingPath))];
  if (!headings.length) {
    const body = store.getChunks(root, path).filter((c) => !c.chunkId.endsWith(":meta"));
    return { kind: "section-missing", sections: [...new Set(body.map((c) => c.headingPath))] };
  }
  if (headings.length > 1) return { kind: "ambiguous", on: "section", candidates: headings };
  return { kind: "hit", root, path, chunk: matches[0] };
}

export function resolveFetch(store: FetchStore, roots: FetchRoot[], arg: string, section?: string): FetchResult {
  const found = pathReadings(store, roots, arg);
  if (!found.length) return { kind: "missing" };
  if (found.length > 1) return { kind: "ambiguous", on: "path", candidates: found.map((f) => `${f.root}:${f.path}`).sort() };
  const { root, path } = found[0];
  // Section disambiguation only after the path resolved to exactly one root.
  if (section) return resolveSection(store, root, path, section);
  const chunk = store.getChunk(root, path);
  return chunk ? { kind: "hit", root, path, chunk } : { kind: "missing" };
}

export interface RenderedFetch {
  text: string;
  found: boolean;
  suppressedSections: number;
  candidates?: number;
}

/** Render a fetch result. `sectionHint` names how the caller passes a section
 *  (tool: "pass `section`", CLI: "pass --section <headingPath>"). */
export function renderFetch(r: FetchResult, arg: string, section: string | undefined, sectionHint: string): RenderedFetch {
  if (r.kind === "missing") return { text: `(not found: ${arg})`, found: false, suppressedSections: 0 };
  if (r.kind === "section-missing") {
    if (!r.sections.length) return { text: `(section not found: ${section} in ${arg} — no sections)`, found: false, suppressedSections: 0 };
    const extra = r.sections.length - SECTION_LIST_CAP;
    const lines = [`(section not found: ${section} in ${arg} — sections:)`, ...r.sections.slice(0, SECTION_LIST_CAP)];
    if (extra > 0) lines.push(`(+${extra} more section${extra === 1 ? "" : "s"})`);
    return { text: lines.join("\n"), found: false, suppressedSections: 0 };
  }
  if (r.kind === "ambiguous") {
    const head =
      r.on === "path"
        ? `(ambiguous: ${arg} is indexed in ${r.candidates.length} sources — pass one of:)`
        : `(ambiguous: section ${section} matches ${r.candidates.length} sections in ${arg} — pass one of as section:)`;
    return { text: [head, ...r.candidates].join("\n"), found: false, suppressedSections: 0, candidates: r.candidates.length };
  }
  const more = r.chunk.suppressedSections ?? 0;
  const text = more > 0 ? `${r.chunk.body}\n\n(+${more} more section${more === 1 ? "" : "s"} in this file — ${sectionHint} to fetch one)` : r.chunk.body;
  return { text, found: true, suppressedSections: more };
}
