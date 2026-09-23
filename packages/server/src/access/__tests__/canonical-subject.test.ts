import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalSubject,
  isSameSubject,
  isSubjectWithin,
  volumeCaseInsensitive,
} from "../canonical-subject.js";

/**
 * Volume-probed canonicalisation of access subjects (change: add-access-grant-dialog,
 * task 2b.3a; test-plan #E17, #E18, #E19, #X8).
 *
 * The cases the task names explicitly:
 *   - `~/.SSH` vs `~/.ssh` on a case-INsensitive volume must be ONE subject,
 *     and two distinct subjects on a case-SENSITIVE one.
 *   - `/repo-secrets` must NOT be treated as inside `/repo` (never a string
 *     prefix).
 *   - An unresolvable path must be refused, not compared unresolved.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-canon-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const mk = (...segs: string[]): string => {
  const p = path.join(dir, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

describe("case folding follows the volume, not the platform", () => {
  it("folds when the volume folds, preserves case when it does not", () => {
    const mixed = mk("MiXeD");
    const insensitive = canonicalSubject(mixed, { caseInsensitive: true });
    const sensitive = canonicalSubject(mixed, { caseInsensitive: false });
    expect(insensitive).not.toBeNull();
    expect(sensitive).not.toBeNull();
    // The two forms differ, and the folding one is exactly the folded form —
    // so `~/.SSH` and `~/.ssh` collapse to one subject only where the volume says so.
    expect(insensitive!.canonical).toBe(sensitive!.canonical.toLowerCase());
    expect(insensitive!.canonical).not.toBe(sensitive!.canonical);
    expect(insensitive!.caseInsensitive).toBe(true);
    expect(sensitive!.caseInsensitive).toBe(false);
  });

  it("collapses two case spellings to one subject on a folding volume", () => {
    const mixed = mk("MiXeD");
    const folded = canonicalSubject(mixed, { caseInsensitive: true });
    const flipped = canonicalSubject(mixed.toUpperCase(), { caseInsensitive: true });
    // Host-independent: either the volume resolves the flipped spelling — and
    // then both fold to ONE subject, which is the whole point — or the volume is
    // case-sensitive, the flipped path does not resolve, and it is REFUSED
    // rather than folded into a false match.
    if (flipped) {
      expect(folded!.canonical).toBe(flipped.canonical);
    } else {
      expect(isSameSubject(mixed, mixed.toUpperCase(), { caseInsensitive: true })).toBe(false);
    }
  });

  it("probes the volume and agrees with an empirical existence check", () => {
    const name = "MiXeD";
    const target = mk(name);
    // The probe's answer must equal "does the case-flipped sibling exist?" on
    // whatever volume this test actually runs on — no platform assumption.
    const flippedExists = fs.existsSync(path.join(dir, "MIXED"));
    expect(volumeCaseInsensitive(target)).toBe(flippedExists);
  });

  it("walks up to a flippable component instead of assuming", () => {
    // A name with no letters to flip tells us nothing about the volume, so the
    // probe must fall through to its parent rather than guess.
    const numeric = mk("12345");
    expect(volumeCaseInsensitive(numeric)).toBe(volumeCaseInsensitive(dir));
  });
});

describe("containment is component-wise, never a string prefix", () => {
  it("does not treat /repo-secrets as inside /repo", () => {
    const repo = mk("repo");
    const secrets = mk("repo-secrets");
    expect(isSubjectWithin(secrets, repo)).toBe(false);
  });

  it("treats a real descendant as inside", () => {
    const repo = mk("repo");
    const inner = mk("repo", "a", "b");
    expect(isSubjectWithin(inner, repo)).toBe(true);
  });

  it("treats the subject itself as inside", () => {
    const repo = mk("repo");
    expect(isSubjectWithin(repo, repo)).toBe(true);
  });

  it("resolves symlinks before comparing", () => {
    const real = mk("real");
    const link = path.join(dir, "link");
    fs.symlinkSync(real, link);
    expect(isSameSubject(link, real)).toBe(true);
    expect(isSubjectWithin(mk("real", "child"), link)).toBe(true);
  });
});

describe("an unresolvable subject is refused, never compared unresolved", () => {
  it("canonicalSubject returns null for a missing path", () => {
    expect(canonicalSubject(path.join(dir, "nope", "deeper"))).toBeNull();
  });

  it("canonicalSubject returns null for an empty string", () => {
    expect(canonicalSubject("")).toBeNull();
  });

  it("an unresolvable side never matches", () => {
    const repo = mk("repo");
    const missing = path.join(dir, "nope");
    expect(isSameSubject(missing, repo)).toBe(false);
    expect(isSubjectWithin(missing, repo)).toBe(false);
    // The fail-closed direction: containment is never inferred FROM an
    // unresolved string, on either side.
    expect(isSubjectWithin(repo, missing)).toBe(false);
  });
});

describe("Unicode normalisation", () => {
  it("canonicalises to NFC", () => {
    const accented = mk("caf\u00e9"); // NFC form
    const canon = canonicalSubject(accented);
    expect(canon).not.toBeNull();
    expect(canon!.canonical).toBe(canon!.canonical.normalize("NFC"));
    // A decomposed spelling of the same name is the same subject.
    const nfd = path.join(dir, "cafe\u0301");
    if (fs.existsSync(nfd)) {
      expect(isSameSubject(accented, nfd)).toBe(true);
    }
  });
});
