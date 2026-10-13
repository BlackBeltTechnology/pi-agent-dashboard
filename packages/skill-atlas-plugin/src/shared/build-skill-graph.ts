/**
 * buildSkillGraph — pure, deterministic skill relation graph.
 *
 * No fs, no clock, no hashing, no `node:` imports (browser- and CLI-safe).
 * Rules (design D2):
 *  - `references` (directed): ported from the personal skill-atlas tool's scan.mjs.
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

const HYPHEN_ID_RE = /^[A-Za-z0-9_-]+$/;
const WORD_ID_RE = /^[A-Za-z0-9_]+$/;
const isWordCode = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
const isIdCode = (c: number): boolean => isWordCode(c) || c === 45;

/**
 * Per-body mention index, built in linear passes (no per-id regex):
 *  - `idTokens`: lowercase `[a-z0-9_-]+` runs containing `-` (hyphenated ids
 *    match a whole run — the `(^|[^A-Za-z0-9_-])id([^A-Za-z0-9_-]|$)` rule);
 *  - `skillWords`: words in `/skill:x`, `skill: x` (no word char before
 *    `skill`) and `x skill` (whole word, no word char after `skill`) forms.
 */
function mentionIndex(body: string): { idTokens: Set<string>; skillWords: Set<string> } {
  const lower = body.toLowerCase();
  const idTokens = new Set<string>();
  // Only runs containing `-` can be hyphenated ids: expand each `-` to its run.
  for (let i = lower.indexOf("-"); i !== -1; ) {
    let a = i;
    while (a > 0 && isIdCode(lower.charCodeAt(a - 1))) a--;
    let b = i + 1;
    while (b < lower.length && isIdCode(lower.charCodeAt(b))) b++;
    idTokens.add(lower.slice(a, b));
    i = lower.indexOf("-", b);
  }
  const skillWords = new Set<string>();
  for (let i = lower.indexOf("skill"); i !== -1; i = lower.indexOf("skill", i + 1)) {
    const after = i + 5;
    // `skill: x` / `/skill:x`
    if (lower.charCodeAt(after) === 58 && (i === 0 || !isWordCode(lower.charCodeAt(i - 1)))) {
      let j = after + 1;
      while (j < lower.length && /\s/.test(lower[j])) j++;
      let k = j;
      while (k < lower.length && isWordCode(lower.charCodeAt(k))) k++;
      if (k > j) skillWords.add(lower.slice(j, k));
    }
    // `x skill`
    if (i >= 2 && lower.charCodeAt(i - 1) === 32 && (after >= lower.length || !isWordCode(lower.charCodeAt(after)))) {
      let k = i - 1;
      while (k > 0 && isWordCode(lower.charCodeAt(k - 1))) k--;
      if (k < i - 1) skillWords.add(lower.slice(k, i - 1));
    }
  }
  return { idTokens, skillWords };
}

/** Does a body (via its index) name skill `id`? Fast path for plain ids, regex otherwise. */
function mentions(id: string, body: string, idx: ReturnType<typeof mentionIndex>, re: () => RegExp): boolean {
  const lower = id.toLowerCase();
  if (id.includes("-")) return HYPHEN_ID_RE.test(id) ? idx.idTokens.has(lower) : re().test(body);
  return WORD_ID_RE.test(id) ? idx.skillWords.has(lower) : re().test(body);
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
  const targets = skills
    .filter((s) => s.id.length >= MIN_REF_ID_LENGTH)
    .map((s) => {
      let cached: RegExp | undefined;
      return { id: s.id, re: () => (cached ??= referenceMatcher(s.id)) };
    });
  for (const s of skills) {
    const idx = mentionIndex(s.body);
    for (const { id, re } of targets) {
      if (id !== s.id && mentions(id, s.body, idx, re)) add(s.id, id, "references", `${s.id} names ${id} in its SKILL.md`);
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
