/**
 * Guard tests for `scripts/check-client-sinks.mjs` — the CI gate that keeps
 * raw navigation / HTML / script sinks out of browser-side source.
 *
 * See change: harden-client-sinks (design D4, test-plan #E11, #E12).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeClientSinks, REPO_ROOT } from '../check-client-sinks.mjs';

const fixtureRoots = [];

function makeFixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'client-sinks-guard-'));
  fixtureRoots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

const NAV_FILE = [
  'export function f(x: string, a: HTMLAnchorElement, el: HTMLElement) {', // 1
  '  window.open(x);', // 2
  '  a.href = x;', // 3
  '  location = x as any;', // 4
  '  el.setAttribute("src", x);', // 5
  '  return <a href={x}>go</a>;', // 6
  '}', // 7
].join('\n');

const HTML_FILE = [
  'export function g(x: string, el: HTMLElement) {', // 1
  '  el.innerHTML = x;', // 2
  '  document.write(x);', // 3
  '  eval(x);', // 4
  '  new Worker(x);', // 5
  '}', // 6
].join('\n');

const INERT_FILE = [
  '// window.open(x) inside a line comment',
  '/* el.innerHTML = x; location = x; */',
  'const s = "window.open(x); el.innerHTML = x";',
  'const t = `new Worker(x) and eval(x)`;',
  'export function h(x: string) {',
  '  // client-sinks: allow — constant same-origin target, reviewed',
  '  window.open(x);',
  '  // client-sinks: allow',
  '  window.open(x);', // 9 — annotation without a reason
  '  return <a href="https://literal.example">ok</a>;',
  '}',
].join('\n');

const FIXTURE = {
  'packages/client/src/nav.tsx': NAV_FILE,
  'packages/client/src/html.tsx': HTML_FILE,
  'packages/client/src/inert.tsx': INERT_FILE,
  'packages/client/src/imports-policy.ts': 'import { trustedMermaidParse } from "./lib/security/trusted-types.js";\nexport const p = trustedMermaidParse;\n',
  'packages/dashboard-plugin-runtime/src/server/pool.ts': 'export const w = (x: string) => new Worker(x);\nwindow.open("x" + w);\n',
  'packages/client/src/__tests__/a.test.tsx': 'window.open(x); el.innerHTML = x;\n',
  'packages/client/src/b.test.ts': 'window.open(x);\n',
};

const key = (v) => `${v.file}:${v.line}:${v.rule}`;

describe('client sink guard (#E11)', () => {
  it('nav rule set flags exactly the 5 nav tokens, plus the reason-less annotation', () => {
    const root = makeFixtureTree(FIXTURE);
    const { violations } = analyzeClientSinks(root, { ruleSets: ['nav'] });
    const navHits = violations.filter((v) => v.file === 'packages/client/src/nav.tsx').map((v) => v.line).sort();
    expect(navHits).toEqual([2, 3, 4, 5, 6]);
    // nothing from html.tsx, comments, strings, the server file or the tests
    expect(violations.some((v) => v.file === 'packages/client/src/html.tsx')).toBe(false);
    expect(violations.some((v) => v.file.includes('/server/'))).toBe(false);
    expect(violations.some((v) => /test\./.test(v.file) || v.file.includes('__tests__'))).toBe(false);
    const inert = violations.filter((v) => v.file === 'packages/client/src/inert.tsx');
    expect(inert.map((v) => v.line)).toEqual([9]);
    expect(inert[0].rule).toBe('annotation-missing-reason');
    expect(violations).toHaveLength(6);
  });

  it('full run adds the 4 html tokens and the policy-helper import', () => {
    const root = makeFixtureTree(FIXTURE);
    const nav = new Set(analyzeClientSinks(root, { ruleSets: ['nav'] }).violations.map(key));
    const { violations } = analyzeClientSinks(root, { ruleSets: ['nav', 'html'] });
    const added = violations.filter((v) => !nav.has(key(v)));
    expect(added.filter((v) => v.file === 'packages/client/src/html.tsx').map((v) => v.line).sort()).toEqual([2, 3, 4, 5]);
    expect(added.filter((v) => v.file === 'packages/client/src/imports-policy.ts')).toHaveLength(1);
    expect(added).toHaveLength(5);
    expect(violations.some((v) => v.file.includes('/server/') || v.file.includes('test'))).toBe(false);
  });

  it('every violation names the sanctioned helper', () => {
    const root = makeFixtureTree(FIXTURE);
    for (const v of analyzeClientSinks(root, { ruleSets: ['nav', 'html'] }).violations) {
      expect(v.hint).toMatch(/\S/);
    }
  });

  it('allowlisted chokepoint / policy modules pass', () => {
    const root = makeFixtureTree({
      'packages/client/src/lib/nav/safe-navigation.tsx': 'export const o = (x: string) => window.open(x);\n',
      'packages/client/src/lib/security/trusted-types.ts': 'export const s = (el: HTMLElement, x: string) => { el.innerHTML = x; };\n',
    });
    expect(analyzeClientSinks(root, { ruleSets: ['nav', 'html'] }).violations).toEqual([]);
  });

  it('the policy-helper import is allowed from its owning module', () => {
    const root = makeFixtureTree({
      'packages/client/src/components/MermaidBlock.tsx': 'import { trustedMermaidParse } from "../lib/security/trusted-types.js";\nexport const p = trustedMermaidParse;\n',
      'packages/team-app/src/ui/icons.tsx': 'import { trustedStaticSvg } from "./tt.js";\nexport const q = trustedStaticSvg;\n',
    });
    expect(analyzeClientSinks(root, { ruleSets: ['nav', 'html'] }).violations).toEqual([]);
  });
});

describe('CI wiring (#E12)', () => {
  it('ci.yml runs check-client-sinks.mjs in the same job as check-fixed-tick-waits.mjs', () => {
    const yml = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    // Split into top-level jobs (two-space indented keys under `jobs:`).
    const jobsBody = yml.slice(yml.indexOf('\njobs:'));
    const jobs = jobsBody.split(/\n {2}(?=[\w-]+:\s*\n)/);
    const job = jobs.find((j) => j.includes('check-fixed-tick-waits.mjs'));
    expect(job, 'a job runs check-fixed-tick-waits.mjs').toBeTruthy();
    expect(job).toMatch(/node scripts\/check-client-sinks\.mjs/);
  });
});
