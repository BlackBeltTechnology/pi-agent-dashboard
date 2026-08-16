/**
 * Guard tests for `scripts/check-skill-frontmatter.mjs`.
 *
 * The guard used to be a vitest `it.each` that could only pass or fail. It is
 * now a script emitting structured findings, so these tests cover each
 * severity, each source label, the wording-locked exemption, and the exit-code
 * contract — plus the original repository-wide assertion that no SKILL.md is
 * error-level broken.
 *
 * See change: fix-skill-discovery-parity (test-plan E11, E12, E13, E14).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  analyzeRepository,
  analyzeSkillFile,
  BUDGET_EXEMPT_SKILLS,
  PI_MAX_DESCRIPTION_LENGTH,
  REPO_DESCRIPTION_BUDGET,
  REPO_ROOT,
} from '../check-skill-frontmatter.mjs';

/** Build a SKILL.md body with a description of exactly `n` characters. */
function skillWithDescription(n, name = 'a-skill') {
  return `---\nname: ${name}\ndescription: ${'x'.repeat(n)}\n---\n\nBody`;
}

const rulesOf = (findings) => findings.map((f) => f.rule);

describe('description length severities (E11)', () => {
  it.each([
    [400, []],
    [401, ['description-over-budget']],
    [1024, ['description-over-budget']],
    [1025, ['description-too-long', 'description-over-budget']],
  ])('a %i-char description yields %j', (len, expected) => {
    const findings = analyzeSkillFile('skills/a-skill/SKILL.md', skillWithDescription(len));
    expect(rulesOf(findings).sort()).toEqual([...expected].sort());
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('labels the two thresholds with distinct sources', () => {
    const findings = analyzeSkillFile('skills/a-skill/SKILL.md', skillWithDescription(PI_MAX_DESCRIPTION_LENGTH + 1));
    const bySource = Object.fromEntries(findings.map((f) => [f.rule, f.source]));
    expect(bySource['description-too-long']).toBe('pi');
    expect(bySource['description-over-budget']).toBe('repository');
  });
});

describe('name severities (E12)', () => {
  it.each([
    [64, []],
    [65, ['name-too-long']],
  ])('a %i-char name yields %j', (len, expected) => {
    const name = 'a'.repeat(len);
    const findings = analyzeSkillFile('skills/x/SKILL.md', `---\nname: ${name}\ndescription: Fine.\n---\nBody`);
    expect(rulesOf(findings)).toEqual(expected);
    expect(findings.every((f) => f.severity === 'warning' && f.source === 'pi')).toBe(true);
  });

  it('warns without failing on an uppercase name', () => {
    const findings = analyzeSkillFile('skills/x/SKILL.md', '---\nname: MySkill\ndescription: Fine.\n---\nBody');
    expect(rulesOf(findings)).toEqual(['name-charset']);
    expect(findings[0].severity).toBe('warning');
  });

  it('warns without failing on consecutive hyphens', () => {
    const findings = analyzeSkillFile('skills/x/SKILL.md', '---\nname: my--skill\ndescription: Fine.\n---\nBody');
    expect(rulesOf(findings)).toEqual(['name-hyphens']);
    expect(findings[0].severity).toBe('warning');
  });
});

describe('description errors', () => {
  it.each([
    ['omitted', '---\nname: x\n---\nBody'],
    ['empty', '---\nname: x\ndescription: ""\n---\nBody'],
    ['whitespace', '---\nname: x\ndescription: "   "\n---\nBody'],
  ])('a %s description is an error naming the file', (_label, text) => {
    const findings = analyzeSkillFile('skills/x/SKILL.md', text);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].source).toBe('pi');
    expect(findings[0].file).toBe('skills/x/SKILL.md');
  });

  it('treats a missing frontmatter block as an error', () => {
    const findings = analyzeSkillFile('skills/x/SKILL.md', '# Just a heading\n');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe('frontmatter-missing');
  });

  it('treats unparseable frontmatter as an error, not a crash', () => {
    const text = '---\nname: x\ndescription: Use when Triggers: "a", "b"\n---\nBody';
    const findings = analyzeSkillFile('skills/x/SKILL.md', text);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe('frontmatter-unparseable');
  });
});

describe('wording-locked exemption (E14)', () => {
  it.each([...BUDGET_EXEMPT_SKILLS])('%s raises no budget warning', (skill) => {
    const findings = analyzeSkillFile(`skills/${skill}/SKILL.md`, skillWithDescription(REPO_DESCRIPTION_BUDGET + 200, skill));
    expect(rulesOf(findings)).toEqual([]);
  });

  // Pinned to approved digests, NOT to HEAD: comparing a working-tree file with
  // `git show HEAD:<the same file>` passes after any committed edit, so a
  // HEAD-based lock silently stops protecting the wording it exists to protect.
  const APPROVED_DESCRIPTION_SHA256 = {
    'ship-change': '8759069009538a1daf9489c27595249ddd8d84a97a1624bb87efcfc3d1a9cad3',
    'frontend-mockup-loop': '161f387768adc25a77c6bbd9d4bda3607466b0faceeeffc4a1b71732aa2c5019',
    'anti-slop-frontend': '829c144c5ef7b8332d22c97899be3f0b040596daec850e1fd9aafcf1dce79c3c',
    // Trigger-rich descriptions exempted rather than reworded — the phrasing IS
    // their discovery surface. Pinned like the rest, so a later edit re-opens
    // the budget question instead of silently inheriting the exemption.
    'manage-flows': '151320713231c1057eae8d86dbfe9522cbf14fc5f1a9286c622ecb703ee1c48e',
    'software-cost-estimator': 'cddd4a1fc1dd4a227a8dbbc2217c0a1b32e6ffafb163d045516562441f13817d',
    'bpmn-package-explorer': '775e4f136a3be2ae1aef4833091b0d6eee231d6a69baace9033110a807e9fd15',
    'openforms-mui': '3852d183c0ca0f53b37177d6b8ee7ca236a6082a916a360289144616b358d7e0',
  };

  it('their descriptions match the approved wording byte for byte', () => {
    const { files } = analyzeRepository();
    const exempt = files.filter((f) => [...BUDGET_EXEMPT_SKILLS].some((s) => f.includes(`${s}/SKILL.md`)));
    expect(exempt.length).toBe(BUDGET_EXEMPT_SKILLS.size);

    for (const file of exempt) {
      const skill = [...BUDGET_EXEMPT_SKILLS].find((s) => file.includes(`${s}/SKILL.md`));
      const fm = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
      const digest = createHash('sha256').update(parseYaml(fm).description, 'utf8').digest('hex');
      expect(digest, `${skill} description changed — its wording is locked by spec`).toBe(
        APPROVED_DESCRIPTION_SHA256[skill],
      );
    }
  });
});

describe('exit-code contract (E13)', () => {
  const script = join(REPO_ROOT, 'scripts', 'check-skill-frontmatter.mjs');

  it('exits 0 for the repository, which must have warnings but no errors', () => {
    const out = execFileSync('node', [script], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(out).toMatch(/0 error\(s\)/);
  });

  it('reports every finding with a severity and a source label', () => {
    const { findings } = analyzeRepository();
    for (const f of findings) {
      expect(['error', 'warning']).toContain(f.severity);
      expect(['pi', 'repository']).toContain(f.source);
    }
  });

  it('never collects a documentation-tree file as a skill candidate', () => {
    const { files } = analyzeRepository();
    expect(files.every((f) => f.endsWith('SKILL.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('AGENTS.md'))).toBe(false);
  });
});

describe('repository is error-free', () => {
  it('discovers skill manifests to check', () => {
    const { files } = analyzeRepository();
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no SKILL.md with missing, empty, or unparseable frontmatter description', () => {
    const { findings } = analyzeRepository();
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors.map((f) => `${f.file}: ${f.message}`)).toEqual([]);
  });

  it('has no budget warning outside the exempt skills (6.8)', () => {
    const { findings } = analyzeRepository();
    const overBudget = findings.filter((f) => f.rule === 'description-over-budget');
    expect(overBudget.map((f) => f.file)).toEqual([]);
  });
});
