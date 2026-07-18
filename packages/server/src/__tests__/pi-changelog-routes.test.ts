/**
 * Fastify integration tests for `GET /api/pi-core/changelog`.
 *
 * Covers every scenario in spec
 * `pi-changelog-display#Requirement: Changelog REST endpoint`.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerPiChangelogRoutes } from "../routes/pi-changelog-routes.js";
import { _resetChangelogCache } from "../changelog/changelog-parser.js";

// We can't easily patch findChangelogPath at import-time (vitest module
// mocks vary), so we set up a fake managed install at HOME/.pi-dashboard
// and rely on findChangelogPath's defaultManagedDir() reading $HOME.
let tmpHome: string;
let originalHome: string | undefined;

function makeManagedPkg(pkg: string, files: Record<string, string>): string {
  const dir = path.join(tmpHome, ".pi-dashboard", "node_modules", pkg);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const SAMPLE_CHANGELOG = `# Changelog

## [0.70.0] - 2026-04-23

### Breaking Changes

- broke X

### Fixed

- a fix

## [0.69.0] - 2026-04-22

### Breaking Changes

- broke Y

## [0.68.0] - 2026-04-20

### Fixed

- another fix
`;

describe("pi-changelog-routes", () => {
  let app: FastifyInstance;
  let bootstrapState: any;
  let originalOffline: string | undefined;

  beforeEach(async () => {
    _resetChangelogCache();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cl-route-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    // Disable remote-CHANGELOG fetch so existing tests deterministically
    // exercise the local-file path. The new remote-source tests below
    // toggle PI_OFFLINE off and stub fetch explicitly. See change:
    // read-changelog-from-github.
    originalOffline = process.env.PI_OFFLINE;
    process.env.PI_OFFLINE = "1";
    bootstrapState = {
      get: () => ({ status: "ready" as const }),
    };
    app = Fastify({ logger: false });
    registerPiChangelogRoutes(app, { bootstrapState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (originalHome !== undefined) process.env.HOME = originalHome;
    if (originalOffline !== undefined) process.env.PI_OFFLINE = originalOffline;
    else delete process.env.PI_OFFLINE;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns 200 with filtered releases for a valid range", async () => {
    makeManagedPkg("@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.70.0",
        repository: "https://github.com/badlogic/pi-mono.git",
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.68.0&to=0.70.0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pkg).toBe("@mariozechner/pi-coding-agent");
    expect(body.from).toBe("0.68.0");
    expect(body.to).toBe("0.70.0");
    // (0.68.0, 0.70.0] → 0.69.0 + 0.70.0
    expect(body.releases.map((r: any) => r.version)).toEqual(["0.70.0", "0.69.0"]);
    expect(body.hasBreaking).toBe(true);
    expect(body.changelogUrl).toBe(
      "https://github.com/badlogic/pi-mono/blob/main/CHANGELOG.md",
    );
    expect(typeof body.parsedAt).toBe("string");
  });

  it("hasBreaking is false when no release in range has breaking changes", async () => {
    makeManagedPkg("@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.68.0",
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.67.0&to=0.68.0",
    });
    const body = res.json();
    expect(body.releases.map((r: any) => r.version)).toEqual(["0.68.0"]);
    expect(body.hasBreaking).toBe(false);
  });

  it("rejects a malformed package name (path traversal) with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=..%2F..%2Fetc%2Fpasswd&from=0.0.1&to=0.0.2",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/valid npm package name/);
  });

  it("accepts any valid npm name (non-core) and returns 200 empty when no CHANGELOG", async () => {
    // `evil-pkg` is a syntactically valid name; with no CHANGELOG located
    // it degrades to the empty response, not a 400. See change:
    // extend-whats-new-to-all-packages.
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=evil-pkg&from=0.0.1&to=0.0.2",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().releases).toEqual([]);
  });

  it("returns 200 with empty releases when CHANGELOG missing", async () => {
    // Whitelisted package but nothing on disk.
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.68.0&to=0.70.0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.releases).toEqual([]);
    expect(body.hasBreaking).toBe(false);
    expect(body.changelogUrl).toBeNull();
  });

  it("rejects missing from/to with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.68.0",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unparseable versions with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=junk&to=0.70.0",
    });
    expect(res.statusCode).toBe(400);
  });

  // NOTE: "returns 503 when bootstrap is not ready" test removed.
  // The bootstrap gate on this route was deliberately removed in change
  // `eliminate-electron-runtime-install` (task 3.5, 2026-05-23). The
  // route file's own docstring confirms it: "Bootstrap gate removed
  // under change: eliminate-electron-runtime-install (task 3.5)". The
  // `PiChangelogRouteDeps` interface comment also says the field was
  // removed; the route is unconditionally available. This test was
  // documented as deferred to a "Phase 3.9 sweep" in
  // eliminate-electron-runtime-install/tasks.md task 5.9; this is that
  // sweep.

  it("returns no releases when from === to", async () => {
    makeManagedPkg("@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG,
      "package.json": "{}",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.70.0&to=0.70.0",
    });
    const body = res.json();
    // Half-open (from, to] — equal endpoints means range is empty.
    expect(body.releases).toEqual([]);
    expect(body.hasBreaking).toBe(false);
  });

  it("derives null changelogUrl when repository is missing or non-GitHub", async () => {
    makeManagedPkg("@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG,
      "package.json": JSON.stringify({ name: "x", version: "0.70.0" }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.68.0&to=0.70.0",
    });
    expect(res.json().changelogUrl).toBeNull();
  });
});

// ── Remote-CHANGELOG path ─────────────────────────────────────────────────────────
// See change: read-changelog-from-github.

import { vi } from "vitest";

describe("pi-changelog-routes remote source", () => {
  let app: FastifyInstance;
  let tmpHomeRemote: string;
  let originalHomeRemote: string | undefined;
  let originalOfflineRemote: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  // SAMPLE_CHANGELOG_REMOTE simulates an upstream CHANGELOG that
  // contains a release entry NEWER than what the local install knows.
  const SAMPLE_CHANGELOG_REMOTE = `# Changelog

## [0.99.0] - 2026-12-01

### Breaking Changes

- only-on-remote breaking change

### Fixed

- only-on-remote fix

## [0.70.0] - 2026-04-23

### Fixed

- old fix
`;

  // SAMPLE_CHANGELOG_LOCAL simulates the locally-installed older copy.
  const SAMPLE_CHANGELOG_LOCAL = `# Changelog

## [0.70.0] - 2026-04-23

### Fixed

- old fix
`;

  function makePkg(home: string, pkg: string, files: Record<string, string>): string {
    const dir = path.join(home, ".pi-dashboard", "node_modules", pkg);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  beforeEach(async () => {
    _resetChangelogCache();
    tmpHomeRemote = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cl-remote-"));
    originalHomeRemote = process.env.HOME;
    process.env.HOME = tmpHomeRemote;
    // Remote path needs PI_OFFLINE OFF.
    originalOfflineRemote = process.env.PI_OFFLINE;
    delete process.env.PI_OFFLINE;
    originalFetch = globalThis.fetch;
    app = Fastify({ logger: false });
    registerPiChangelogRoutes(app, {
      bootstrapState: { get: () => ({ status: "ready" as const }) } as any,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (originalHomeRemote !== undefined) process.env.HOME = originalHomeRemote;
    if (originalOfflineRemote !== undefined) process.env.PI_OFFLINE = originalOfflineRemote;
    else delete process.env.PI_OFFLINE;
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpHomeRemote, { recursive: true, force: true });
  });

  it("prefers remote CHANGELOG over local when both are available", async () => {
    makePkg(tmpHomeRemote, "@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG_LOCAL,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.70.0",
        repository: { type: "git", url: "git+https://github.com/badlogic/pi-mono.git", directory: "packages/coding-agent" },
      }),
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"v1"' }),
      text: async () => SAMPLE_CHANGELOG_REMOTE,
    }) as any;

    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.70.0&to=0.99.0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Range (0.70.0, 0.99.0] — should include 0.99.0 from REMOTE,
    // which the local file does not contain.
    expect(body.releases.map((r: any) => r.version)).toEqual(["0.99.0"]);
    expect(body.hasBreaking).toBe(true);
    expect(body.releases[0].breaking[0].text).toBe("only-on-remote breaking change");
    // changelogUrl is the human URL (the /blob/main/ form), not raw.
    expect(body.changelogUrl).toBe(
      "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md",
    );
  });

  it("falls back to local CHANGELOG when remote fails", async () => {
    makePkg(tmpHomeRemote, "@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG_LOCAL,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.70.0",
        repository: { type: "git", url: "git+https://github.com/badlogic/pi-mono.git" },
      }),
    });
    // Remote returns 503 → fetchRemoteChangelog returns null → route falls
    // back to local.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => "",
    }) as any;

    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.69.0&to=0.70.0",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Range (0.69.0, 0.70.0] — local has only 0.70.0; remote returned 503.
    expect(body.releases.map((r: any) => r.version)).toEqual(["0.70.0"]);
  });

  it("PI_OFFLINE=1 skips remote and reads local directly", async () => {
    process.env.PI_OFFLINE = "1";
    makePkg(tmpHomeRemote, "@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG_LOCAL,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.70.0",
        repository: "https://github.com/badlogic/pi-mono.git",
      }),
    });
    let fetchCalled = false;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCalled = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => SAMPLE_CHANGELOG_REMOTE,
      });
    }) as any;

    const res = await app.inject({
      method: "GET",
      url: "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.69.0&to=0.99.0",
    });
    expect(res.statusCode).toBe(200);
    expect(fetchCalled).toBe(false);
    // 0.99.0 only exists in remote — with PI_OFFLINE we don't see it.
    const body = res.json();
    expect(body.releases.map((r: any) => r.version)).toEqual(["0.70.0"]);
  });

  it("second request within TTL serves cached remote without re-fetching", async () => {
    makePkg(tmpHomeRemote, "@mariozechner/pi-coding-agent", {
      "CHANGELOG.md": SAMPLE_CHANGELOG_LOCAL,
      "package.json": JSON.stringify({
        name: "@mariozechner/pi-coding-agent",
        version: "0.70.0",
        repository: "https://github.com/badlogic/pi-mono.git",
      }),
    });
    let fetchCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCalls++;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"v1"' }),
        text: async () => SAMPLE_CHANGELOG_REMOTE,
      });
    }) as any;

    const url =
      "/api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.70.0&to=0.99.0";
    await app.inject({ method: "GET", url });
    await app.inject({ method: "GET", url });
    expect(fetchCalls).toBe(1);
  });
});
