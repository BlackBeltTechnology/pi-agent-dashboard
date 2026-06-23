import { describe, expect, it } from 'vitest';
import {
  parseFindings,
  splitFindings,
} from '../../.pi/skills/implement/scripts/parse-findings.ts';

const line = (o) => JSON.stringify(o);

describe('parseFindings', () => {
  it('keeps only finding events, ignoring progress/heartbeat/complete', () => {
    const stdout = [
      line({ type: 'review_context', reviewType: 'uncommitted' }),
      line({ type: 'status', phase: 'analyzing' }),
      line({ type: 'heartbeat', status: 'reviewing' }),
      line({ type: 'finding', severity: 'critical', comment: 'SQL injection\nmore' }),
      line({ type: 'finding', severity: 'minor', comment: 'rename var' }),
      line({ type: 'complete', status: 'success' }),
    ].join('\n');
    const findings = parseFindings(stdout);
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('critical');
  });

  it('skips malformed (non-JSON) lines without throwing', () => {
    const stdout = [
      'garbage-not-json',
      '',
      '   ',
      line({ type: 'finding', severity: 'major', comment: 'await missing' }),
    ].join('\n');
    expect(parseFindings(stdout)).toHaveLength(1);
  });

  it('returns empty array for no findings', () => {
    expect(parseFindings(line({ type: 'complete', status: 'success' }))).toEqual([]);
    expect(parseFindings('')).toEqual([]);
  });
});

describe('splitFindings', () => {
  it('buckets critical/major/high/warn/error as must-fix', () => {
    const findings = [
      { type: 'finding', severity: 'critical' },
      { type: 'finding', severity: 'major' },
      { type: 'finding', severity: 'warning' },
      { type: 'finding', severity: 'minor' },
      { type: 'finding', severity: 'info' },
    ];
    const { all, mustFix } = splitFindings(findings);
    expect(all).toHaveLength(5);
    expect(mustFix).toHaveLength(3);
  });

  it('treats missing severity as not must-fix', () => {
    const { mustFix } = splitFindings([{ type: 'finding' }]);
    expect(mustFix).toHaveLength(0);
  });
});
