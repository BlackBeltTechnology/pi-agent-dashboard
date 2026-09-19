/**
 * Prop search — LLM picks from a candidate table; code only searches.
 *
 * Sources: the vendored CC0 subset under `assets/props/` (offline, searched
 * first) and Poly Pizza (optional, `POLY_PIZZA_KEY`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pkgRoot } from "../util/paths.js";

const ROOT = pkgRoot();

export type PropSource = "vendored" | "poly-pizza" | "generated";

export interface PropCandidate {
  source: PropSource;
  id: string;
  name: string;
  tags: string[];
  tris: number;
  bytes: number;
  licence: string;
  author: string;
  downloadUrl?: string;
}

interface ManifestItem {
  id: string;
  name: string;
  tags: string[];
  file: string;
  bytes: number;
  tris: number;
  licence: string;
  author: string;
}

interface Manifest {
  items: ManifestItem[];
}

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const POLY_PIZZA_ENDPOINT = "https://api.poly.pizza/v1.1/search";

export function vendoredManifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, "assets", "props", "manifest.json"), "utf8")) as Manifest;
}

/** Vendored candidates matching `query` (empty query → all), id-sorted. */
export function vendoredCandidates(query: string): PropCandidate[] {
  const q = query.trim().toLowerCase();
  return vendoredManifest()
    .items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.tags.some((t) => t.toLowerCase().includes(q)))
    .map((it) => ({
      source: "vendored" as const,
      id: it.id,
      name: it.name,
      tags: it.tags,
      tris: it.tris,
      bytes: it.bytes,
      licence: it.licence,
      author: it.author,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Absolute path of a vendored model. */
export function vendoredPath(id: string): string {
  return join(ROOT, "assets", "props", `${id}.glb`);
}

export interface PolySearchResult {
  candidates: PropCandidate[];
  notice?: string;
}

interface PolyResponse {
  results?: Array<Record<string, unknown>>;
}

/** Parse a Poly Pizza API response into candidate rows (defensive). */
export function parsePolyResponse(body: PolyResponse): PropCandidate[] {
  return (body.results ?? [])
    .map((r) => {
      const id = String(r.id ?? r.Id ?? r.uid ?? "");
      const tags = Array.isArray(r.Tags) ? (r.Tags as unknown[]).map(String) : [];
      return {
        source: "poly-pizza" as const,
        id,
        name: String(r.name ?? r.Name ?? id),
        tags,
        tris: Number(r.TriCount ?? r.tris ?? 0) || 0,
        bytes: Number(r.DownloadSize ?? r.bytes ?? 0) || 0,
        licence: String(r.Licence ?? r.licence ?? "CC0-1.0"),
        author: String(r.Designer ?? r.author ?? "Poly Pizza"),
        downloadUrl: String(r.Download ?? r.downloadUrl ?? ""),
      };
    })
    .filter((c) => c.id && c.downloadUrl);
}

/**
 * Query Poly Pizza. Unset key / unreachable / timeout → vendored-only with a
 * one-line notice (never throws).
 */
export async function searchPolyPizza(query: string, opts: { timeoutMs?: number; key?: string; endpoint?: string } = {}): Promise<PolySearchResult> {
  const key = opts.key ?? process.env.POLY_PIZZA_KEY;
  if (!key) return { candidates: [], notice: "online source skipped (no POLY_PIZZA_KEY)" };
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DECK3D_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${opts.endpoint ?? process.env.POLY_PIZZA_ENDPOINT ?? POLY_PIZZA_ENDPOINT}?${new URLSearchParams({ query, limit: "20" }).toString()}`;
    const res = await fetch(url, { headers: { "x-auth-token": key }, signal: controller.signal });
    if (!res.ok) return { candidates: [], notice: `online source skipped (HTTP ${res.status})` };
    return { candidates: parsePolyResponse((await res.json()) as PolyResponse) };
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "timeout" : "unreachable";
    return { candidates: [], notice: `online source skipped (${reason})` };
  } finally {
    clearTimeout(timer);
  }
}

export interface SearchResult {
  candidates: PropCandidate[];
  notices: string[];
}

/** Vendored first, then optional online source. Writes no files. */
export async function searchProps(query: string, opts: { timeoutMs?: number; key?: string; endpoint?: string } = {}): Promise<SearchResult> {
  const vendored = vendoredCandidates(query);
  const notices: string[] = [];
  const online = await searchPolyPizza(query, opts);
  if (online.notice) notices.push(online.notice);
  return { candidates: [...vendored, ...online.candidates], notices };
}
