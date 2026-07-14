import { describe, expect, it } from 'vitest';
import {
  deferDecision,
  filesystemRealityCheck,
  parseManifest,
} from '../../.pi/skills/ship-it/scripts/manifest.ts';

// ── 6.1 parseManifest ────────────────────────────────────────────────
describe('parseManifest', () => {
  const wellFormed = `
## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1          | BVA       | L1    | automated   | 0     | call    | throws              |
| E2 | R1          | BVA       | L3    | automated   | max   | call    | 200                 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F2 | R2          | visual    | —     | manual-only | page  | look    | feels right         |
`;

  it('parses well-formed rows into {id, level, disposition}', () => {
    const rows = parseManifest(wellFormed);
    expect(rows).toEqual([
      { id: 'E1', level: 'L1', disposition: 'automated' },
      { id: 'E2', level: 'L3', disposition: 'automated' },
      { id: 'F2', level: '—', disposition: 'manual-only' },
    ]);
  });

  it('skips separator rows, header echoes, and non-table prose', () => {
    const rows = parseManifest(wellFormed);
    // 3 real rows only; the |---| separators and headers are not data.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.id !== 'id')).toBe(true);
  });

  it('tolerates malformed rows (wrong disposition, missing cells) by skipping them', () => {
    const malformed = `
| id | requirement | technique | level | disposition | x |
|----|----|----|----|----|----|
| G1 | R | t | L1 | automated | ok |
| G2 | R | t | L1 | bogus-value | ok |
| G3 | R | t | L1 |  | ok |
| | R | t | L1 | automated | ok |
`;
    const rows = parseManifest(malformed);
    expect(rows).toEqual([{ id: 'G1', level: 'L1', disposition: 'automated' }]);
  });

  it('returns [] for a table with no disposition column', () => {
    const noDispo = `
| id | requirement | technique | level | input |
|----|----|----|----|----|
| E1 | R | t | L1 | 0 |
`;
    expect(parseManifest(noDispo)).toEqual([]);
  });

  it('returns [] on empty / non-table input', () => {
    expect(parseManifest('')).toEqual([]);
    expect(parseManifest('no tables here')).toEqual([]);
  });
});

// ── 6.2 deferDecision ────────────────────────────────────────────────
describe('deferDecision', () => {
  const manifest = `
| id | requirement | technique | level | disposition | input | trigger | observable |
|----|----|----|----|----|----|----|----|
| E1 | R | t | L1 | automated   | a | b | c |
| M1 | R | t | —  | manual-only | a | b | c |
| M2 | R | t | —  | manual-only | a | b | c |
`;

  it('defers when every leftover maps to a manual-only manifest row (inline tag)', () => {
    const tasks = [
      '7.1 Manual: eyeball the layout (test-plan: manual-only)',
      '7.2 Manual: check hardware LED (test-plan: manual-only)',
    ];
    const r = deferDecision(tasks, manifest);
    expect(r.action).toBe('defer');
    expect(r.deferred).toEqual(tasks);
    expect(r.blockers).toEqual([]);
  });

  it('defers when leftover references a manual-only row by manifest id', () => {
    const tasks = ['7.1 Manual: eyeball (test-plan #M1)'];
    const r = deferDecision(tasks, manifest);
    expect(r.action).toBe('defer');
  });

  it('stops when any leftover is a non-manual (automated) row', () => {
    const tasks = [
      '6.1 Unit: parser (test-plan: automated)',
      '7.1 Manual: eyeball (test-plan: manual-only)',
    ];
    const r = deferDecision(tasks, manifest);
    expect(r.action).toBe('stop');
    expect(r.blockers).toContain(tasks[0]);
    expect(r.deferred).toContain(tasks[1]);
  });

  it('stops when a leftover has no recognizable manifest disposition', () => {
    const tasks = ['3.2 Implement the widget'];
    const r = deferDecision(tasks, manifest);
    expect(r.action).toBe('stop');
    expect(r.blockers).toEqual(tasks);
  });

  it('no-manifest → falls back to legacy keyword defer', () => {
    const tasks = [
      'Manual smoke: verify the flow by hand',
      'Run the e2e acceptance pass',
    ];
    const r = deferDecision(tasks, null);
    expect(r.action).toBe('defer');
  });

  it('no-manifest → legacy keyword stop when a non-keyword task remains', () => {
    const tasks = ['Implement the parser', 'Manual: verify'];
    const r = deferDecision(tasks, null);
    expect(r.action).toBe('stop');
    expect(r.blockers).toEqual(['Implement the parser']);
  });

  it('empty leftover list → defer (nothing blocks)', () => {
    expect(deferDecision([], manifest).action).toBe('defer');
    expect(deferDecision([], null).action).toBe('defer');
  });
});

// ── 6.4 filesystemRealityCheck ───────────────────────────────────────
describe('filesystemRealityCheck', () => {
  it('an automated scenario with a missing test file is NOT satisfied', () => {
    const scenarios = [
      { id: 'E1', disposition: 'automated', testFile: 'tests/e2e/a.spec.ts' },
    ];
    const exists = () => false; // checkbox may say [x], but file is gone
    const r = filesystemRealityCheck(scenarios, exists);
    expect(r.unsatisfied).toEqual(scenarios);
    expect(r.satisfied).toEqual([]);
  });

  it('an automated scenario whose test file exists is satisfied', () => {
    const scenarios = [
      { id: 'E1', disposition: 'automated', testFile: 'a.test.ts' },
    ];
    const r = filesystemRealityCheck(scenarios, () => true);
    expect(r.satisfied).toEqual(scenarios);
    expect(r.unsatisfied).toEqual([]);
  });

  it('manual-only scenarios are never gated on a test file', () => {
    const scenarios = [
      { id: 'M1', disposition: 'manual-only', testFile: '' },
    ];
    const r = filesystemRealityCheck(scenarios, () => false);
    expect(r.unsatisfied).toEqual([]);
    expect(r.satisfied).toEqual(scenarios);
  });

  it('mixes: only the missing automated file is unsatisfied', () => {
    const scenarios = [
      { id: 'E1', disposition: 'automated', testFile: 'have.ts' },
      { id: 'E2', disposition: 'automated', testFile: 'missing.ts' },
      { id: 'M1', disposition: 'manual-only', testFile: '' },
    ];
    const exists = (p) => p === 'have.ts';
    const r = filesystemRealityCheck(scenarios, exists);
    expect(r.unsatisfied.map((s) => s.id)).toEqual(['E2']);
  });
});
