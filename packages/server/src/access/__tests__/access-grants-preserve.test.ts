/**
 * Grant-store write-back preserves rows this build does not admit, and the whole-file states
 * (harden-agent-tool-guards D7, task 4.4). Rows T.34, T.79–T.82, T.120–T.122
 * (test-plan #E34, #E80–#E83, #X10–#X12).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAccessGrants,
  GRANT_CAP_PER_SCOPE,
  GRANT_STORE_MAX_BYTES,
  grantedSubjects,
  listGrants,
  recordGrant,
  revokeGrant,
} from "../access-grants.js";

let root: string;
let storePath: string;
let warn: { mock: { calls: unknown[][] }; mockClear(): void; mockRestore(): void };
const row = (subject: string, grantedAt = 1, extra: Record<string, unknown> = {}) => ({ subject, scope: "project", grantedAt, origin: "s", ...extra });
const write = (grants: unknown[], version: unknown = 1) => {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ version, grants }, null, 2));
  __resetAccessGrants();
};
const read = () => JSON.parse(fs.readFileSync(storePath, "utf8")) as { version: number; grants: Array<Record<string, unknown>> };
const mkdir = (...s: string[]) => {
  const p = path.join(root, ...s);
  fs.mkdirSync(p, { recursive: true });
  return fs.realpathSync(p);
};
const home = () => os.homedir();
const logs = (re: RegExp) => warn.mock.calls.map((c) => String(c[0])).filter((l) => re.test(l));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grants-preserve-")));
  storePath = path.join(root, "store", "access-grants.json");
  process.env.PI_ACCESS_GRANTS_STORE = storePath;
  __resetAccessGrants();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("T.34 a grant for ~/.config written by an older build", () => {
  it("admits nothing, logs once, and survives a later recordGrant byte-for-byte", () => {
    const cfg = path.join(home(), ".config");
    write([row(cfg)]);
    expect(grantedSubjects()).toEqual([]);
    listGrants();
    grantedSubjects();
    expect(logs(/is forbidden by this build/)).toHaveLength(1);
    expect(logs(/is forbidden by this build/)[0]).toContain(JSON.stringify(cfg));
    const fresh = mkdir("w", "new");
    expect(recordGrant({ subject: fresh }).ok).toBe(true);
    const grants = read().grants;
    expect(grants.some((g) => g.subject === cfg)).toBe(true);
    expect(grants.some((g) => g.subject === fresh)).toBe(true);
  });
});

describe("T.79 write path: both writers keep the raw rows", () => {
  it("~/.aws, an unknown entry and /w/other survive record and revoke; revoke removes only /w/other", () => {
    const aws = path.join(home(), ".aws");
    const other = mkdir("other");
    const unknown = { kind: "x", note: "from a newer build" };
    write([row(aws), unknown, row(other)]);
    expect(grantedSubjects()).toEqual([other]);
    const fresh = mkdir("new");
    expect(recordGrant({ subject: fresh }).ok).toBe(true);
    let g = read().grants;
    expect(g).toContainEqual(row(aws));
    expect(g).toContainEqual(unknown);
    expect(grantedSubjects().sort()).toEqual([other, fresh].sort());
    expect(revokeGrant(other)).toBe(true);
    g = read().grants;
    expect(g).toContainEqual(row(aws));
    expect(g).toContainEqual(unknown);
    expect(g.some((x) => x.subject === other)).toBe(false);
    expect(g.some((x) => x.subject === fresh)).toBe(true);
    expect(grantedSubjects()).toEqual([fresh]);
  });

  it("load only leaves the file untouched; an unrelated grant is unaffected until revoked", () => {
    const other = mkdir("other");
    write([row(path.join(home(), ".aws")), row(other)]);
    const before = fs.readFileSync(storePath);
    expect(grantedSubjects()).toEqual([other]);
    expect(fs.readFileSync(storePath).equals(before)).toBe(true);
  });
});

describe("T.80 revoke of a rejected row", () => {
  it("returns false, leaves the file unchanged, one log line per subject", () => {
    const aws = path.join(home(), ".aws");
    write([row(aws)]);
    const before = fs.readFileSync(storePath);
    expect(revokeGrant(aws)).toBe(false);
    expect(revokeGrant(aws)).toBe(false);
    expect(fs.readFileSync(storePath).equals(before)).toBe(true);
    expect(logs(/is forbidden by this build/)).toHaveLength(1);
  });
});

describe("T.81 store ceiling and the cap over admitted rows", () => {
  const padTo = (grants: unknown[], bytes: number): string => {
    const base = JSON.stringify({ version: 1, grants });
    return base + " ".repeat(bytes - Buffer.byteLength(base));
  };
  it("a file of exactly GRANT_STORE_MAX_BYTES loads; one byte more is not loaded and not rewritable", () => {
    const a = mkdir("a");
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, padTo([row(a)], GRANT_STORE_MAX_BYTES));
    expect(fs.statSync(storePath).size).toBe(GRANT_STORE_MAX_BYTES);
    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([a]);

    fs.writeFileSync(storePath, padTo([row(a)], GRANT_STORE_MAX_BYTES + 1));
    const before = fs.readFileSync(storePath);
    const mtime = fs.statSync(storePath).mtimeMs;
    __resetAccessGrants();
    warn.mockClear();
    expect(grantedSubjects()).toEqual([]);
    expect(recordGrant({ subject: mkdir("b") })).toMatchObject({ ok: false });
    expect(fs.readFileSync(storePath).equals(before)).toBe(true);
    expect(fs.statSync(storePath).mtimeMs).toBe(mtime);
    expect(logs(/exceeds/).length).toBeGreaterThanOrEqual(1);
  });

  it("a 100 000-row file (~4 MB) is not loaded, retains no rows and is never rewritten", () => {
    write(Array.from({ length: 100_000 }, (_, i) => ({ kind: "x", i })));
    expect(fs.statSync(storePath).size).toBeGreaterThan(GRANT_STORE_MAX_BYTES);
    const before = fs.readFileSync(storePath);
    expect(recordGrant({ subject: mkdir("n") }).ok).toBe(false);
    expect(fs.readFileSync(storePath).equals(before)).toBe(true);
  });

  it("GRANT_CAP admitted + 50 rejected: all 250 rows survive a write; rejected rows cause no eviction", () => {
    const admitted = Array.from({ length: GRANT_CAP_PER_SCOPE }, (_, i) => row(`/seed/s${i}`, i + 1));
    const rejected = Array.from({ length: 50 }, (_, i) => row(path.join(home(), ".aws", `r${i}`), 1000 + i));
    write([...admitted, ...rejected]);
    expect(grantedSubjects()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(recordGrant({ subject: mkdir("n") }).ok).toBe(true);
    const g = read().grants;
    expect(g).toHaveLength(GRANT_CAP_PER_SCOPE + 50); // 200 admitted (oldest evicted for the new one) + 50 kept
    for (const r of rejected) expect(g).toContainEqual(r);
    expect(g.filter((x) => String(x.subject).startsWith("/seed/")).length).toBe(GRANT_CAP_PER_SCOPE - 1);
  });
});

describe("T.82 duplicate subject across scopes", () => {
  it("both rows persist; reload admits the project row only", () => {
    const dup = mkdir("dup");
    write([{ subject: dup, scope: "session", grantedAt: 1, origin: "s" }]);
    expect(recordGrant({ subject: dup }).ok).toBe(true);
    const g = read().grants;
    expect(g.filter((x) => x.subject === dup).map((x) => x.scope).sort()).toEqual(["project", "session"]);
    __resetAccessGrants();
    expect(listGrants().map((x) => x.scope)).toEqual(["project"]);
  });
});

describe("T.120 / T.121 whole-file states: invalid JSON and a newer version", () => {
  const asides = () => fs.readdirSync(path.dirname(storePath)).filter((f) => f.includes(".corrupt-"));
  it("invalid JSON: record moves it aside byte-for-byte and writes a fresh v1; revoke does neither", () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{not json");
    __resetAccessGrants();
    expect(revokeGrant(mkdir("x"))).toBe(false);
    expect(fs.readFileSync(storePath, "utf8")).toBe("{not json");
    expect(asides()).toEqual([]);
    const fresh = mkdir("w", "new");
    expect(recordGrant({ subject: fresh }).ok).toBe(true);
    expect(asides()).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(storePath), asides()[0]), "utf8")).toBe("{not json");
    expect(read()).toMatchObject({ version: 1 });
    expect(read().grants.map((g) => g.subject)).toEqual([fresh]);
    expect(logs(/moved aside/)).toHaveLength(1);
  });
  it("version 2 (a newer build): moved aside on record, untouched on revoke", () => {
    const old = JSON.stringify({ version: 2, grants: [row("/w/future")] });
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, old);
    __resetAccessGrants();
    expect(revokeGrant("/w/future")).toBe(false);
    expect(fs.readFileSync(storePath, "utf8")).toBe(old);
    const fresh = mkdir("w2", "new");
    expect(recordGrant({ subject: fresh }).ok).toBe(true);
    expect(fs.readFileSync(path.join(path.dirname(storePath), asides()[0]), "utf8")).toBe(old);
    expect(read().grants.map((g) => g.subject)).toEqual([fresh]);
  });
});

describe("T.122 a failing write never leaves a store missing the rejected rows", () => {
  it.skipIf(process.platform === "win32" || (process.getuid?.() ?? 1) === 0)("EACCES on the temp file: call fails, file unchanged", () => {
    const aws = row(path.join(home(), ".aws"));
    write([aws, row(mkdir("keep"))]);
    const before = fs.readFileSync(storePath);
    const dir = path.dirname(storePath);
    fs.chmodSync(dir, 0o555);
    try {
      expect(recordGrant({ subject: mkdir("w3", "new") }).ok).toBe(false);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(fs.readFileSync(storePath).equals(before)).toBe(true);
    expect(grantedSubjects()).toHaveLength(1); // the cache did not widen
  });
});
