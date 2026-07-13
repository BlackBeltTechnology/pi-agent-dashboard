import { describe, expect, it } from 'vitest';
import { assertNoWeakening } from '../../.pi/skills/ship-it/scripts/no-weakening.ts';

// A minimal unified-diff builder for a test file.
const diff = (removed, added) =>
  [
    'diff --git a/x.test.ts b/x.test.ts',
    '--- a/x.test.ts',
    '+++ b/x.test.ts',
    '@@ -1,3 +1,3 @@',
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join('\n');

describe('assertNoWeakening', () => {
  it('rejects an added .only', () => {
    const d = diff(['  it("works", () => {'], ['  it.only("works", () => {']);
    const r = assertNoWeakening(d);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/only/i);
  });

  it('rejects an added skip (.skip / xit / xdescribe)', () => {
    expect(assertNoWeakening(diff(['  it("a", () => {'], ['  it.skip("a", () => {'])).ok).toBe(false);
    expect(assertNoWeakening(diff(['  it("a", () => {'], ['  xit("a", () => {'])).ok).toBe(false);
    expect(assertNoWeakening(diff(['  describe("a", () => {'], ['  xdescribe("a", () => {'])).ok).toBe(false);
  });

  it('rejects deleting an assertion (net expect removal)', () => {
    const d = diff(
      ['    expect(a).toBe(1);', '    expect(b).toBe(2);'],
      ['    expect(a).toBe(1);'],
    );
    const r = assertNoWeakening(d);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/assert|delet|remov/i);
  });

  it('rejects weakening a strong matcher to a permissive one', () => {
    const d = diff(
      ['    expect(result).toEqual({ ok: true });'],
      ['    expect(result).toBeDefined();'],
    );
    const r = assertNoWeakening(d);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/weaken/i);
  });

  it('rejects weakening toThrow to not.toThrow', () => {
    const d = diff(
      ['    expect(fn).toThrow("boom");'],
      ['    expect(fn).not.toThrow();'],
    );
    expect(assertNoWeakening(d).ok).toBe(false);
  });

  it('accepts a genuine fix that changes an expected value (still a strong matcher)', () => {
    const d = diff(
      ['    expect(sum(2, 2)).toBe(5);'],
      ['    expect(sum(2, 2)).toBe(4);'],
    );
    expect(assertNoWeakening(d).ok).toBe(true);
  });

  it('accepts adding a new assertion (strengthening)', () => {
    const d = diff(
      ['    expect(a).toBe(1);'],
      ['    expect(a).toBe(1);', '    expect(b).toBe(2);'],
    );
    expect(assertNoWeakening(d).ok).toBe(true);
  });

  it('accepts a diff that only touches non-assertion lines', () => {
    const d = diff(['  const x = oldHelper();'], ['  const x = newHelper();']);
    expect(assertNoWeakening(d).ok).toBe(true);
  });

  it('accepts an empty diff', () => {
    expect(assertNoWeakening('').ok).toBe(true);
  });
});
