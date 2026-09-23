/**
 * Tests for `scripts/refresh-vendor.mjs` — test-plan X3.
 *
 * The refresh contract is verified by fault injection: a fetch that returns
 * bytes differing from the recorded `upstream` hash must abort BEFORE patching,
 * leaving the tree untouched. A test cannot prove the CI tree matches upstream
 * (regenerating both hashes from one tree is circular); this is the check that
 * actually can.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D2).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { manifestPath, refreshVendor, rehash, upstreamPathFor, verifyUpstream } from '../refresh-vendor.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const UPSTREAM = "import { ManualPromise } from '@isomorphic/manualPromise';\nexport class X {}\n";
const WRONG_REVISION = "import { ManualPromise } from '@isomorphic/time';\nexport class WRONGLY_REVISIONED {}\n";

const VENDOR_PREFIX = 'packages/browser-plugin/src/server/relay/vendor';
const FILE = 'playwright-core/src/tools/mcp/cdpRelay.ts';

/** A root carrying a one-entry manifest and the pristine (unpatched) file. */
function fixture({ onDisk = UPSTREAM, recordedUpstream = sha256(UPSTREAM) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'refresh-vendor-'));
  tempDirs.push(root);

  const abs = join(root, VENDOR_PREFIX, FILE);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, onDisk);

  const manifest = {
    $comment: 'test',
    upstreamCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    files: {
      [`relay/vendor/${FILE}`]: { kind: 'upstream-verbatim', upstream: recordedUpstream, patched: sha256(onDisk) },
    },
  };
  mkdirSync(dirname(manifestPath(root)), { recursive: true });
  writeFileSync(manifestPath(root), JSON.stringify(manifest, null, 2));
  return root;
}

const fetchReturning = (body) => async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) });
const fetchFailing = async () => ({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) });

describe('refresh-vendor', () => {
  it('aborts on an unfaithful upstream copy before patching, tree untouched (X3)', async () => {
    const root = fixture();
    const before = readFileSync(join(root, VENDOR_PREFIX, FILE), 'utf-8');
    const manifestBefore = readFileSync(manifestPath(root), 'utf-8');

    const result = await refreshVendor({ root, fetchImpl: fetchReturning(WRONG_REVISION) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].rel).toBe(`relay/vendor/${FILE}`);
    expect(result.mismatches[0].reason).toContain('upstream hash');
    // No patch, no rehash: both the source file and the manifest are untouched.
    expect(readFileSync(join(root, VENDOR_PREFIX, FILE), 'utf-8')).toBe(before);
    expect(readFileSync(manifestPath(root), 'utf-8')).toBe(manifestBefore);
  });

  it('reports a fetch failure as a mismatch, not a crash', async () => {
    const root = fixture();
    const result = await refreshVendor({ root, fetchImpl: fetchFailing, write: false });
    expect(result.ok).toBe(false);
    expect(result.mismatches[0].reason).toContain('fetch failed');
  });

  it('verifies, copies the upstream bytes, patches and rehashes, preserving upstream', async () => {
    const root = fixture();
    const result = await refreshVendor({ root, fetchImpl: fetchReturning(UPSTREAM) });

    expect(result.ok).toBe(true);
    expect(result.changed).toEqual([`${VENDOR_PREFIX}/${FILE}`]);

    const entry = result.patched.files[`relay/vendor/${FILE}`];
    expect(entry.kind).toBe('upstream-verbatim');
    // `upstream` is never derived from disk; `patched` now reflects the rewrite.
    expect(entry.upstream).toBe(sha256(UPSTREAM));
    expect(entry.patched).not.toBe(entry.upstream);

    const onDisk = readFileSync(manifestPath(root), 'utf-8');
    expect(JSON.parse(onDisk).files[`relay/vendor/${FILE}`].upstream).toBe(sha256(UPSTREAM));
  });

  it('patches the FETCHED bytes, not a wrong revision already on disk', async () => {
    // The file on disk came from another revision; the fetch returns the pinned
    // one. The refresh must overwrite from the fetch before patching, or the
    // `upstream` assertion would be checking nothing that survives.
    const root = fixture({ onDisk: WRONG_REVISION });
    const result = await refreshVendor({ root, fetchImpl: fetchReturning(UPSTREAM) });

    expect(result.ok).toBe(true);
    const patchedOnDisk = readFileSync(join(root, VENDOR_PREFIX, FILE), 'utf-8');
    expect(patchedOnDisk).not.toContain('WRONGLY_REVISIONED');
    expect(patchedOnDisk).toContain('class X');
    expect(patchedOnDisk).toContain("from '../../../../shims/manualPromise.js'");
    expect(patchedOnDisk).toContain('MODIFIED for');
  });

  it('--verify performs no copy, patch or rehash', async () => {
    const root = fixture({ onDisk: WRONG_REVISION });
    const before = readFileSync(join(root, VENDOR_PREFIX, FILE), 'utf-8');
    const manifestBefore = readFileSync(manifestPath(root), 'utf-8');

    const result = await refreshVendor({ root, fetchImpl: fetchReturning(UPSTREAM), verifyOnly: true });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, VENDOR_PREFIX, FILE), 'utf-8')).toBe(before);
    expect(readFileSync(manifestPath(root), 'utf-8')).toBe(manifestBefore);
  });

  it('verifyUpstream ignores authored entries (no upstream counterpart)', async () => {
    const manifest = {
      upstreamCommit: 'x',
      files: { 'relay/vendor/shims/wsServer.ts': { kind: 'authored', patched: 'abc' } },
    };
    const mismatches = await verifyUpstream(manifest, { fetchImpl: fetchFailing });
    expect(mismatches).toEqual([]);
  });

  it('rehash rewrites patched from disk and keeps kind/upstream', () => {
    const root = fixture();
    const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf-8'));
    const next = rehash(manifest, root);
    expect(next.files[`relay/vendor/${FILE}`]).toEqual({
      kind: 'upstream-verbatim',
      upstream: sha256(UPSTREAM),
      patched: sha256(UPSTREAM),
    });
  });
});

describe('upstreamPathFor', () => {
  it('maps playwright-core files into packages/playwright-core', () => {
    expect(upstreamPathFor('playwright-core/src/tools/mcp/log.ts')).toBe('packages/playwright-core/src/tools/mcp/log.ts');
  });

  it('maps shims into packages/isomorphic', () => {
    expect(upstreamPathFor('shims/manualPromise.ts')).toBe('packages/isomorphic/manualPromise.ts');
  });

  it('throws for a path with no rule rather than guessing', () => {
    expect(() => upstreamPathFor('elsewhere/file.ts')).toThrow(/no upstream path rule/);
  });
});
