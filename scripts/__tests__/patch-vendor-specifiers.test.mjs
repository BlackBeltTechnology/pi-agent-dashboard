/**
 * Tests for `scripts/patch-vendor-specifiers.mjs` — test-plan E6.
 *
 * Idempotency is a contractual property, not a nicety: the Apache-2.0 §4(b)
 * notice is part of the patched bytes and of the recorded `patched` hash, so a
 * second run that stacked another header would silently drift the manifest. Run
 * count is varied 1x / 2x / 3x (BVA), not just "twice".
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importSpecifiers, PATCH_MARKER, patchText, patchTree, SPECIFIER_MAP } from '../patch-vendor-specifiers.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const UPSTREAM_CDP_RELAY = `/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import { spawn } from 'child_process';
import debug from 'debug';
import { ManualPromise } from '@isomorphic/manualPromise';
import { monotonicTime } from '@isomorphic/time';
import { raceAgainstDeadline } from '@isomorphic/timeoutRunner';
import { WSServer } from '@utils/wsServer';

export class CDPRelayServer {}
`;

const VENDOR_PREFIX = 'packages/browser-plugin/src/server/relay/vendor';

function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'patch-vendor-'));
  tempDirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, VENDOR_PREFIX, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

/** A stable hash over every file's path + bytes under the vendored tree. */
function treeHash(root) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const h = createHash('sha256');
  for (const file of walk(join(root, VENDOR_PREFIX)).sort()) {
    h.update(file.slice(root.length));
    h.update(readFileSync(file));
  }
  return h.digest('hex');
}

describe('patch-vendor-specifiers', () => {
  it('rewrites the 4 specifiers to package-relative paths and stamps one header', () => {
    const root = fixture({ 'playwright-core/src/tools/mcp/cdpRelay.ts': UPSTREAM_CDP_RELAY });
    const { changed, rewrites } = patchTree(root);

    expect(changed).toEqual([`${VENDOR_PREFIX}/playwright-core/src/tools/mcp/cdpRelay.ts`]);
    expect(rewrites).toBe(4);

    const body = readFileSync(join(root, VENDOR_PREFIX, 'playwright-core/src/tools/mcp/cdpRelay.ts'), 'utf-8');
    expect(body).toContain("'../../../../shims/manualPromise.js'");
    expect(body).toContain("'../../../../shims/time.js'");
    expect(body).toContain("'../../../../shims/timeoutRunner.js'");
    expect(body).toContain("'../../../../shims/wsServer.js'");
    expect(body.split(PATCH_MARKER).length - 1).toBe(1);
    // Builtins and declared deps are untouched.
    expect(body).toContain("from 'child_process'");
    expect(body).toContain("from 'debug'");
  });

  it('is idempotent across run counts 1, 2 and 3 (E6)', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/cdpRelay.ts': UPSTREAM_CDP_RELAY,
      'playwright-core/src/tools/mcp/cdpRelayV2.ts': "import { ManualPromise } from '@isomorphic/manualPromise';\n",
    });

    patchTree(root);
    const afterFirst = treeHash(root);
    patchTree(root);
    const afterSecond = treeHash(root);
    patchTree(root);
    const afterThird = treeHash(root);

    expect(afterSecond).toBe(afterFirst);
    expect(afterThird).toBe(afterFirst);

    const header = join(root, VENDOR_PREFIX, 'playwright-core/src/tools/mcp/cdpRelay.ts');
    expect(readFileSync(header, 'utf-8').split(PATCH_MARKER).length - 1).toBe(1);
  });

  it('reports an unmapped playwright-internal specifier instead of leaving it (fail-closed)', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/new.ts': "import x from '@protocol/foo';\n",
    });
    const { changed, unmapped } = patchTree(root);
    expect(changed).toEqual([]);
    expect(unmapped).toEqual([{ file: `${VENDOR_PREFIX}/playwright-core/src/tools/mcp/new.ts`, spec: '@protocol/foo' }]);
  });

  it('flags a stale notice: already patched AND a mapped specifier reappeared', () => {
    const root = fixture({
      'playwright-core/src/tools/mcp/cdpRelay.ts': UPSTREAM_CDP_RELAY,
    });
    patchTree(root);
    // Simulate a refresh that restored a bare specifier without clearing the
    // notice — the notice would then under-report the modification.
    const file = join(root, VENDOR_PREFIX, 'playwright-core/src/tools/mcp/cdpRelay.ts');
    writeFileSync(file, readFileSync(file, 'utf-8').replace("from '../../../../shims/manualPromise.js'", "from '@isomorphic/manualPromise'"));

    expect(patchTree(root).staleNotices).toEqual([`${VENDOR_PREFIX}/playwright-core/src/tools/mcp/cdpRelay.ts`]);
  });

  it('also scans shims for internal specifiers (they are on the rewritten import path)', () => {
    const root = fixture({ 'shims/broken.ts': "import z from '@utils/wsServer';\n" });
    const { unmapped } = patchTree(root);
    expect(unmapped).toEqual([{ file: `${VENDOR_PREFIX}/shims/broken.ts`, spec: '@utils/wsServer' }]);
  });
});

describe('patchText helpers', () => {
  it('does not confuse @isomorphic/time with the @isomorphic/timeoutRunner prefix', () => {
    const { text } = patchText("import a from '@isomorphic/time';\nimport b from '@isomorphic/timeoutRunner';\n", 'playwright-core/a/b/file.ts');
    expect(text).toContain("'../../../shims/time.js'");
    expect(text).toContain("'../../../shims/timeoutRunner.js'");
  });

  it('finds static and (via importSpecifiers) quoted import specifiers', () => {
    expect(importSpecifiers("import a from 'x';\nimport 'side-effect';\nconst y = 1;")).toEqual(['x', 'side-effect']);
    expect(Object.keys(SPECIFIER_MAP)).toHaveLength(4);
  });
});
