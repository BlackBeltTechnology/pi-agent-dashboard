/**
 * Static L1 contract tests for the anti-slop skill suite
 * (`packages/anti-slop`) and the dashboard mockup-loop adapter.
 *
 * Skills are prose, so these tests assert that the normative sentences and
 * artifacts EXIST (design D9) — not that an agent obeys them. Agent
 * compliance is covered by the manual-only rows of test-plan.md.
 *
 * See change: anti-slop-taste-v2 (test-plan E1-E15, E19, X1-X3).
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { BUDGET_EXEMPT_SKILLS, REPO_ROOT } from '../check-skill-frontmatter.mjs';

const PKG = join(REPO_ROOT, 'packages/anti-slop');
const SKILLS_DIR = join(PKG, '.pi/skills');
const SUITE = ['anti-slop-frontend', 'anti-slop-redesign', 'anti-slop-image-direction', 'anti-slop-brandkit'];
const NEW_SKILLS = SUITE.slice(1);
const UPSTREAM_SKILLS = ['taste-skill', 'redesign-skill', 'image-to-code-skill', 'imagegen-frontend-web', 'brandkit'];

const read = (p) => readFileSync(p, 'utf8');
const skillPath = (name) => join(SKILLS_DIR, name, 'SKILL.md');
const skillText = (name) => read(skillPath(name));
/** Collapse whitespace so wrapped prose matches a single-line pattern. */
const flat = (s) => s.replace(/\s+/g, ' ');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('no frontmatter');
  return parseYaml(m[1]);
}

/** Body of a `## Heading` section (up to the next `## `). */
function section(text, headingRe) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && headingRe.test(l));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

// ── UPSTREAM.md parsing (exported shape kept local; negative cases below) ──

/** Parse the provenance header. Returns { sha, date, license, errors[] }. */
function parsePin(text) {
  const errors = [];
  const field = (name) => text.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  const commit = field('Commit')?.replace(/`/g, '');
  const date = field('Date');
  const license = field('License');
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) errors.push(`commit not 40-hex: ${commit}`);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`date not YYYY-MM-DD: ${date}`);
  if (!license || !/\bMIT\b/.test(license)) errors.push(`license not MIT: ${license}`);
  return { sha: commit, date, license, errors };
}

/** Parse `### <upstream-skill>` tables under `## Section map`. */
function parseSectionMap(text) {
  const map = {};
  const body = section(text, /Section map/i);
  let current = null;
  for (const line of body.split('\n')) {
    const h = line.match(/^###\s+`?([a-z0-9-]+)`?/);
    if (h) {
      current = h[1];
      map[current] = [];
      continue;
    }
    if (!current || !line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2 || /^-+$/.test(cells[0].replace(/:/g, '')) || /^upstream section$/i.test(cells[0])) continue;
    map[current].push({ source: cells[0], target: cells[1] });
  }
  return map;
}

function badTargets(rows) {
  return rows.filter(({ target }) => {
    const t = target.replace(/`/g, '').trim();
    if (!t || /^TBD$/i.test(t)) return true;
    if (/^dropped:/.test(t)) return t.replace(/^dropped:/, '').trim().length === 0;
    return !SUITE.some((s) => t.includes(s));
  });
}

/** True when `adaptedFrom` contains a ≥7-hex prefix of `sha`. */
function carriesShaPrefix(adaptedFrom, sha) {
  return (adaptedFrom.match(/\b[0-9a-f]{7,40}\b/g) ?? []).some((h) => sha.startsWith(h));
}

const upstream = read(join(PKG, 'UPSTREAM.md'));
const pin = parsePin(upstream);

describe('Pinned upstream provenance (E1-E3)', () => {
  it('E1: commit is exactly one 40-hex SHA; date + MIT present', () => {
    expect(pin.errors).toEqual([]);
    expect(upstream.match(/\b[0-9a-f]{40}\b/g)?.length).toBe(1);
  });

  it.each([
    ['39-hex', 'a'.repeat(39)],
    ['41-hex', 'a'.repeat(41)],
  ])('E1: a %s commit fails', (_l, sha) => {
    const bad = `- Commit: \`${sha}\`\n- Date: 2026-10-08\n- License: MIT\n`;
    expect(parsePin(bad).errors.length).toBeGreaterThan(0);
  });

  it('E2: every upstream skill has ≥1 mapped row, no TBD/empty target', () => {
    const map = parseSectionMap(upstream);
    for (const s of UPSTREAM_SKILLS) {
      expect(map[s], `section map for ${s}`).toBeDefined();
      expect(map[s].length).toBeGreaterThan(0);
      expect(badTargets(map[s]), `bad targets in ${s}`).toEqual([]);
    }
  });

  it('E2: a TBD or reasonless dropped target is flagged', () => {
    expect(badTargets([{ source: 'x', target: 'TBD' }]).length).toBe(1);
    expect(badTargets([{ source: 'x', target: 'dropped:' }]).length).toBe(1);
    expect(badTargets([{ source: 'x', target: '' }]).length).toBe(1);
  });

  /** Upstream skill(s) each package skill must name (beyond the repo prefix). */
  const EXPECTED_UPSTREAM = {
    'anti-slop-frontend': ['design-taste-frontend'],
    'anti-slop-redesign': ['redesign-skill'],
    'anti-slop-image-direction': ['image-to-code-skill', 'imagegen-frontend-web'],
    'anti-slop-brandkit': ['brandkit'],
  };

  it.each(SUITE)('E3: %s adapted_from names an upstream skill + pinned SHA prefix', (name) => {
    const af = String(frontmatter(skillText(name)).metadata?.adapted_from ?? '');
    // Strip the repo slug so `Leonxlnx/taste-skill@...` alone cannot satisfy the check.
    const named = af.replace(/Leonxlnx\/taste-skill@[0-9a-f]+/g, '');
    for (const u of EXPECTED_UPSTREAM[name]) expect(named, af).toContain(u);
    expect(carriesShaPrefix(af, pin.sha), af).toBe(true);
  });

  it('E3: a mismatched SHA prefix fails', () => {
    expect(carriesShaPrefix('Leonxlnx/taste-skill@deadbee', pin.sha)).toBe(false);
  });
});

describe('Package declares every shipped skill (E4-E7)', () => {
  const pkg = JSON.parse(read(join(PKG, 'package.json')));

  it('E4: pi.skills == skill dirs == the four suite skills', () => {
    const declared = pkg.pi.skills.map((p) => p.replace(/^\.pi\/skills\//, '').replace(/\/$/, '')).sort();
    const dirs = readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory()).sort();
    expect(declared).toEqual([...SUITE].sort());
    expect(dirs).toEqual([...SUITE].sort());
  });

  it('E5: files ships UPSTREAM.md and .pi/skills/', () => {
    expect(pkg.files).toContain('UPSTREAM.md');
    expect(pkg.files).toContain('.pi/skills/');
  });

  it.each(NEW_SKILLS)('E6: %s description ≤ 400 chars and not budget-exempt', (name) => {
    const fm = frontmatter(skillText(name));
    expect(fm.name).toBe(name);
    expect(fm.description.length).toBeLessThanOrEqual(400);
    expect(BUDGET_EXEMPT_SKILLS.has(name)).toBe(false);
  });

  it('E7: anti-slop-frontend description digest unchanged', () => {
    const d = frontmatter(skillText('anti-slop-frontend')).description;
    expect(createHash('sha256').update(d).digest('hex')).toMatch(/^829c144c/);
  });
});

describe('anti-slop-frontend refresh (E8-E10)', () => {
  const text = skillText('anti-slop-frontend');

  it('E8: profile table gates Part A / Part B / layout / image direction', () => {
    const rows = Object.fromEntries(
      text
        .split('\n')
        .filter((l) => /^\|\s*`(product-ui|marketing|new-site)`/.test(l))
        .map((l) => {
          const c = l.split('|').slice(1, -1).map((x) => x.trim());
          return [c[0].replace(/`/g, ''), c];
        }),
    );
    // columns: profile | Part A | Part B | layout | redesign default | image direction
    expect(rows['product-ui'].slice(1, 4)).toEqual(['✓', '✗', '✗']);
    expect(rows['product-ui'][5]).toMatch(/forbidden/);
    for (const p of ['marketing', 'new-site']) expect(rows[p].slice(1, 4)).toEqual(['✓', '✓', '✓']);
    expect(flat(text)).toMatch(/Design Read/);
  });

  it('E9: pre-flight covers added + existing items, each citing a rule id', () => {
    const items = section(text, /pre-flight/i)
      .split('\n')
      .reduce((acc, l) => {
        if (/^- \[ \]/.test(l)) acc.push(l);
        else if (acc.length && /^\s+\S/.test(l)) acc[acc.length - 1] += ` ${l.trim()}`;
        return acc;
      }, []);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it, it).toMatch(/\([ABT]\d+(?:[,/ ]+[ABT]\d+)*\)/);
    const all = items.join('\n').toLowerCase();
    for (const kw of ['theme parity', 'z-index', 'em-dash', 'accent', 'font', 'fake data', 'fake screenshot', 'contrast', 'motion']) {
      expect(all, kw).toContain(kw);
    }
    expect(items.some((i) => /marketing only/i.test(i) && /layout discipline/i.test(i))).toBe(true);
  });

  it('E10: theme parity states diff-scope, exclusions, screenshot sets, non-gating', () => {
    const tp = flat(section(text, /theme parity/i));
    expect(tp).toMatch(/added/i);
    expect(tp).toMatch(/diff/i);
    for (const ex of ['tests', 'fixtures', 'stories', '*.svg', 'token-definition']) expect(tp, ex).toContain(ex);
    expect(tp).toMatch(/default theme in dark/i);
    expect(tp).toMatch(/default theme in light/i);
    expect(tp).toMatch(/non-default palette/i);
    expect(tp).toMatch(/`marketing`[^.]*light and dark/i);
    expect(tp).toMatch(/non-gating/i);
  });
});

describe('anti-slop-redesign (E11)', () => {
  const t = flat(skillText('anti-slop-redesign'));
  it('names modes, defaults, audit-before, overhaul confirm, protected list', () => {
    for (const m of ['`greenfield`', '`preserve`', '`overhaul`']) expect(t).toContain(m);
    expect(t).toMatch(/`product-ui`[^|]*\|\s*`preserve`/);
    expect(t).toMatch(/`marketing`[^|]*\|\s*`preserve`/);
    expect(t).toMatch(/`new-site`[^|]*\|\s*`greenfield`/);
    expect(t).toMatch(/audit before/i);
    expect(t).toMatch(/`overhaul` requires explicit user confirmation/);
    for (const p of ['routes', 'nav labels', 'form field names', 'wordmark', 'legal copy', 'keyboard shortcuts', '`data-testid`']) {
      expect(t, p).toContain(p);
    }
  });
});

describe('anti-slop-image-direction (E12, E13, X3)', () => {
  const t = flat(skillText('anti-slop-image-direction'));
  it('E12: forbidden for product-ui; confirm names count/backend/paid; one image per section into refs/', () => {
    expect(t).toContain('Image direction is forbidden for `product-ui`');
    expect(t).toMatch(/image count/i);
    expect(t).toMatch(/backend/i);
    expect(t).toMatch(/paid/i);
    expect(t).toContain('pi-nano-banana');
    expect(t).toMatch(/one image per (planned )?section/i);
    expect(t).toContain('refs/');
  });

  it('E13: image text is placeholder; observed tells excluded; gates win', () => {
    expect(t).toMatch(/placeholder/i);
    expect(t).toMatch(/never transcribed/i);
    expect(t).toContain('direction.md');
    expect(t).toMatch(/observed tells/i);
    expect(t).toMatch(/excluded/i);
    expect(t).toMatch(/WCAG/);
  });

  it('X3: backend change requires a new confirmation, never silent', () => {
    expect(t).toMatch(/backend change requires a new confirmation/i);
    expect(t).toMatch(/never switch(es)? (the )?backend silently/i);
  });
});

describe('anti-slop-brandkit (E14)', () => {
  const t = flat(skillText('anti-slop-brandkit'));
  it('new-site + explicit request; confirm gate; proposal-only; logos are concepts', () => {
    expect(t).toContain('`new-site`');
    expect(t).toMatch(/explicit request/i);
    for (const kw of [/image count/i, /backend/i, /paid/i]) expect(t).toMatch(kw);
    expect(t).toMatch(/never write brand values into project tokens or UI contracts before the user approves/i);
    expect(t).toMatch(/logos? (are|is) (labelled|labeled)? ?concepts?/i);
  });
});

describe('image skills: fallback + headless (X1, X2)', () => {
  it.each(['anti-slop-image-direction', 'anti-slop-brandkit'])('%s states fallback and headless rules', (name) => {
    const t = flat(skillText(name));
    expect(t).toMatch(/report the reason/i);
    expect(t).toMatch(/text-only/i);
    expect(t).toMatch(/variation axes/i);
    expect(t).toMatch(/do not fail the task/i);
    expect(t).toMatch(/headless/i);
    expect(t).toMatch(/generate nothing/i);
  });
});

describe('Advisory authority under the mockup loop (E15)', () => {
  it.each(SUITE)('%s states advisory status, FIX step, never overrides WCAG-AA/severity', (name) => {
    const t = flat(skillText(name));
    expect(t).toMatch(/advisory/i);
    expect(t).toMatch(/FIX step/);
    expect(t).toMatch(/never overrides? a WCAG-AA or severity gate/i);
  });
});

describe('Dashboard layering adapter (E19)', () => {
  const t = read(join(REPO_ROOT, '.pi/skills/frontend-mockup-loop-dashboard/SKILL.md'));
  it('drops the stale 4-theme binding and binds product-ui / preserve / token guard', () => {
    for (const stale of ['studio', 'earth', 'athlete', 'gradient']) expect(t).not.toMatch(new RegExp(`\\b${stale}\\b`));
    for (const kw of ['ui-contract.md', 'product-ui', 'preserve', 'theme-token-guard.mjs']) expect(t).toContain(kw);
    expect(flat(t)).toMatch(/image direction (is )?off/i);
  });
});
