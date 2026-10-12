/**
 * buildSkillGraph — pure, deterministic skill relation graph.
 *
 * No fs, no clock, no hashing, no `node:` imports (browser- and CLI-safe).
 * Rules (design D2):
 *  - `references` (directed): ported from reference/skill-atlas scan.mjs.
 *    Hyphenated ids match with a non-id-char boundary, case-insensitively;
 *    single-word ids only as `/skill:x`, `skill: x`, `x skill`; ids < 4 chars skipped.
 *  - `bundle` (undirected): same defined `pkg`, group size 2–14.
 *  - `shares-tool` (undirected): backticked snake_case tokens shared by 2–6
 *    skills of the input set; one link per pair listing every shared token.
 * See change: add-skill-atlas-screen.
 */
import type { SkillGraph, SkillGraphInput, SkillLink, SkillLinkType, SkillNode, SkillOrigin } from "./types.js";

const ORIGIN_RANK: Record<SkillOrigin, number> = { project: 0, package: 1, global: 2 };
const MIN_REF_ID_LENGTH = 4;
const BUNDLE_MIN = 2;
const BUNDLE_MAX = 14;
const TOOL_MIN = 2;
const TOOL_MAX = 6;
const TOOL_TOKEN_RE = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\(\))?`/g;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One copy per id: project > package > global, then smallest filePath. */
function dedupe(inputs: readonly SkillGraphInput[]): SkillGraphInput[] {
  const byId = new Map<string, SkillGraphInput>();
  for (const s of inputs) {
    const cur = byId.get(s.id);
    if (
      !cur ||
      ORIGIN_RANK[s.origin] < ORIGIN_RANK[cur.origin] ||
      (ORIGIN_RANK[s.origin] === ORIGIN_RANK[cur.origin] && cmp(s.filePath, cur.filePath) < 0)
    ) {
      byId.set(s.id, s);
    }
  }
  return [...byId.values()].sort((a, b) => cmp(a.id, b.id));
}

/** Matcher for "skill A's body names skill `id`". */
function referenceMatcher(id: string): RegExp {
  const q = escapeRe(id);
  return id.includes("-")
    ? new RegExp(`(^|[^A-Za-z0-9_-])${q}([^A-Za-z0-9_-]|$)`, "i")
    : new RegExp(`(/skill:${q}\\b|\\bskill:\\s*${q}\\b|\\b${q} skill\\b)`, "i");
}

function toolTokens(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(TOOL_TOKEN_RE)) out.add(m[1]);
  return out;
}

export function buildSkillGraph(inputs: readonly SkillGraphInput[]): SkillGraph {
  const skills = dedupe(inputs);
  const links = new Map<string, SkillLink>();
  const add = (source: string, target: string, type: SkillLinkType, why: string): void => {
    if (source === target) return;
    const key = `${source}\0${target}\0${type}`;
    if (!links.has(key)) links.set(key, { source, target, type, why });
  };
  const undirected = (a: string, b: string): [string, string] => (cmp(a, b) <= 0 ? [a, b] : [b, a]);

  // 1. references
  const matchers = skills
    .filter((s) => s.id.length >= MIN_REF_ID_LENGTH)
    .map((s) => ({ id: s.id, re: referenceMatcher(s.id) }));
  for (const s of skills) {
    for (const { id, re } of matchers) {
      if (id !== s.id && re.test(s.body)) add(s.id, id, "references", `${s.id} names ${id} in its SKILL.md`);
    }
  }

  // 2. bundle
  const byPkg = new Map<string, string[]>();
  for (const s of skills) if (s.pkg) byPkg.set(s.pkg, [...(byPkg.get(s.pkg) ?? []), s.id]);
  for (const [pkg, members] of byPkg) {
    if (members.length < BUNDLE_MIN || members.length > BUNDLE_MAX) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = undirected(members[i], members[j]);
        add(a, b, "bundle", `shipped together in ${pkg}`);
      }
    }
  }

  // 3. shares-tool — one link per pair listing every shared distinctive token
  const byToken = new Map<string, string[]>();
  for (const s of skills) for (const t of toolTokens(s.body)) byToken.set(t, [...(byToken.get(t) ?? []), s.id]);
  const pairTokens = new Map<string, string[]>();
  for (const [token, members] of byToken) {
    if (members.length < TOOL_MIN || members.length > TOOL_MAX) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = undirected(members[i], members[j]).join("\0");
        pairTokens.set(key, [...(pairTokens.get(key) ?? []), token]);
      }
    }
  }
  for (const [key, tokens] of pairTokens) {
    const [a, b] = key.split("\0");
    add(a, b, "shares-tool", `both use ${tokens.sort(cmp).join(", ")}`);
  }

  const sorted = [...links.values()].sort(
    (x, y) => cmp(x.source, y.source) || cmp(x.target, y.target) || cmp(x.type, y.type),
  );
  const degree = new Map<string, number>();
  for (const l of sorted) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const nodes: SkillNode[] = skills.map((s) => ({
    id: s.id,
    description: s.description,
    filePath: s.filePath,
    origin: s.origin,
    ...(s.pkg ? { pkg: s.pkg } : {}),
    degree: degree.get(s.id) ?? 0,
  }));
  return { skills: nodes, links: sorted };
}
