/**
 * Tests for the KB source TOFU trust store: revoke support, the additive
 * displayable subject field, and read-only behaviour over legacy stores.
 * See change: add-access-grants-and-review (tasks 6.2–6.4).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "../config.js";
import {
  isTrusted,
  listTrustedSources,
  recordTrust,
  revokeTrust,
  sourceHash,
  sourceSubject,
} from "../trust.js";

/** The store path is env-overridable; these tests re-point it per test. */
function npmSpec(ref: string, extra: Partial<SourceConfig> = {}): SourceConfig {
  return { kind: "npm", ref, ...extra };
}

describe("kb trust — revoke (task 6.2)", () => {
  let trustFile: string;
  beforeEach(() => {
    trustFile = join(mkdtempSync(join(tmpdir(), "kb-trust-")), "kb-source-trust.json");
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterEach(() => {
    delete process.env.KB_SOURCE_TRUST_PATH;
    rmSync(trustFile, { force: true });
  });

  it("records then revokes — isTrusted is false", () => {
    const spec = npmSpec("npm:fake-pkg");
    expect(isTrusted(spec)).toBe(false);
    recordTrust(spec);
    expect(isTrusted(spec)).toBe(true);
    revokeTrust(spec);
    expect(isTrusted(spec)).toBe(false);
  });

  it("revoke is idempotent — a no-op revoke does not create the store", () => {
    revokeTrust(npmSpec("npm:nope"));
    expect(isTrusted(npmSpec("npm:nope"))).toBe(false);
    expect(existsSync(trustFile)).toBe(false);
  });

  it("revoking one source leaves its sibling trusted", () => {
    const a = npmSpec("npm:pkg-a");
    const b = npmSpec("npm:pkg-b");
    recordTrust(a);
    recordTrust(b);
    revokeTrust(a);
    expect(isTrusted(a)).toBe(false);
    expect(isTrusted(b)).toBe(true);
  });
});

describe("kb trust — displayable subject (task 6.3)", () => {
  let trustFile: string;
  beforeEach(() => {
    trustFile = join(mkdtempSync(join(tmpdir(), "kb-trust-")), "kb-source-trust.json");
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterEach(() => {
    delete process.env.KB_SOURCE_TRUST_PATH;
    rmSync(trustFile, { force: true });
  });

  it("a new entry records and exposes its subject", () => {
    const spec = npmSpec("npm:fake-pkg", { subdir: "docs" });
    recordTrust(spec);

    // Recorded alongside the hash, additively, in the raw store file.
    const raw = JSON.parse(readFileSync(trustFile, "utf8"));
    expect(raw[sourceHash(spec)]).toEqual({ subject: sourceSubject(spec) });

    // And exposed through the read accessor.
    expect(listTrustedSources()).toEqual([{ hash: sourceHash(spec), subject: sourceSubject(spec) }]);
  });

  it("a legacy hash-only entry reads without error, subject null", () => {
    const spec = npmSpec("npm:legacy-pkg");
    writeFileSync(trustFile, JSON.stringify({ [sourceHash(spec)]: true }, null, 2), "utf8");

    expect(isTrusted(spec)).toBe(true);
    expect(() => listTrustedSources()).not.toThrow();
    expect(listTrustedSources()).toEqual([{ hash: sourceHash(spec), subject: null }]);
  });

  it("a malformed entry value is neither trusted nor listed", () => {
    writeFileSync(trustFile, JSON.stringify({ deadbeef: false, cafebabe: [1, 2] }), "utf8");
    expect(listTrustedSources()).toEqual([]);
  });
});

describe("kb trust — reads never rewrite the store (task 6.4)", () => {
  let trustFile: string;
  beforeEach(() => {
    trustFile = join(mkdtempSync(join(tmpdir(), "kb-trust-")), "kb-source-trust.json");
    process.env.KB_SOURCE_TRUST_PATH = trustFile;
  });
  afterEach(() => {
    delete process.env.KB_SOURCE_TRUST_PATH;
    rmSync(trustFile, { force: true });
  });

  it("a legacy hash-only store is byte-identical after a read", () => {
    const legacy = JSON.stringify({ abc123: true }, null, 2);
    writeFileSync(trustFile, legacy, "utf8");

    expect(listTrustedSources()).toEqual([{ hash: "abc123", subject: null }]);
    expect(readFileSync(trustFile, "utf8")).toBe(legacy);
  });

  it("a subject-bearing store is byte-identical after a read", () => {
    const spec = npmSpec("npm:fake-pkg");
    recordTrust(spec);
    const before = readFileSync(trustFile, "utf8");

    isTrusted(spec);
    listTrustedSources();
    expect(readFileSync(trustFile, "utf8")).toBe(before);
  });
});
