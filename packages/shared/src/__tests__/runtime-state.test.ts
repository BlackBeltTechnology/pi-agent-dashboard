/**
 * Runtime-overlay state files (request.json / state.json) + effective-source
 * derivation + local runtime identity.
 *
 * test-plan: E1, E2, E14, E19. See change: electron-runtime-overlay-updates (D2).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveEffectiveSource,
  deriveLocalIdentity,
  localRuntimeId,
  patchRuntimeState,
  type RuntimeRequest,
  type RuntimeState,
  readRuntimeRequest,
  readRuntimeState,
  ensureRuntimeRequest,
  selectRuntimeSource,
} from "../runtime-overlay/state.js";

const E = "0b6c1f3e-2d4a-4c5b-9e8f-1a2b3c4d5e6f";
const E2 = "7d9e0a1b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-state-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── E1: effective-source decision table ─────────────────────────────────────

describe("deriveEffectiveSource — decision table (E1)", () => {
  type Binding = "equal" | "seqDiffers" | "epochDiffers" | "absent";
  type Req = "valid" | "missing" | "corrupt" | "legacy";

  const requestFor = (kind: Req): RuntimeRequest | null => {
    switch (kind) {
      case "valid":
        return { source: "npm", sourceEpoch: E, sourceSeq: 3 };
      case "missing":
        return null;
      case "corrupt":
        // Parsed but semantically invalid (what a garbled writer could leave).
        // An UNPARSABLE file reads as null (== the "missing" row); see the
        // writer tests below for the file-level corrupt case.
        return { source: 42 as unknown as "npm", sourceEpoch: "not-a-uuid", sourceSeq: -1 };
      case "legacy":
        return { source: "github" };
    }
  };
  const bindingFor = (kind: Binding): RuntimeState["localBinding"] => {
    switch (kind) {
      case "equal":
        return { epoch: E, seq: 3 };
      case "seqDiffers":
        return { epoch: E, seq: 2 };
      case "epochDiffers":
        return { epoch: E2, seq: 3 };
      case "absent":
        return undefined;
    }
  };
  const baseline = (kind: Req): string =>
    kind === "valid" ? "npm" : kind === "legacy" ? "github" : "bundled";

  const rows: Array<[boolean, Binding, Req]> = [];
  for (const localSet of [true, false])
    for (const b of ["equal", "seqDiffers", "epochDiffers", "absent"] as const)
      for (const r of ["valid", "missing", "corrupt", "legacy"] as const) rows.push([localSet, b, r]);

  it.each(rows)("localPath=%s binding=%s request=%s", (localSet, b, r) => {
    const state: RuntimeState = {
      ...(localSet ? { localPath: "/r/co" } : {}),
      ...(bindingFor(b) ? { localBinding: bindingFor(b) } : {}),
    };
    const got = deriveEffectiveSource(requestFor(r), state);
    const isTheOneRow = localSet && b === "equal" && r === "valid";
    expect(got).toBe(isTheOneRow ? "local" : baseline(r));
  });

  it("returns local in exactly one of the 32 rows", () => {
    const locals = rows.filter(([l, b, r]) => {
      const state: RuntimeState = {
        ...(l ? { localPath: "/r/co" } : {}),
        ...(bindingFor(b) ? { localBinding: bindingFor(b) } : {}),
      };
      return deriveEffectiveSource(requestFor(r), state) === "local";
    });
    expect(locals).toHaveLength(1);
  });
});

// ── E2: seq boundary ────────────────────────────────────────────────────────

describe("deriveEffectiveSource — seq/epoch boundary (E2)", () => {
  const state: RuntimeState = { localPath: "/r/co", localBinding: { epoch: E, seq: 1 } };
  it.each([
    [0, E, "bundled"],
    [1, E, "local"],
    [2, E, "bundled"],
    [0, E2, "bundled"],
    [1, E2, "bundled"],
    [2, E2, "bundled"],
  ] as const)("request seq=%s epoch=%s → %s", (seq, epoch, expected) => {
    const req: RuntimeRequest = { source: "bundled", sourceEpoch: epoch, sourceSeq: seq };
    expect(deriveEffectiveSource(req, state)).toBe(expected);
  });

  it("a binding with seq 0 is invalid even when it equals the request", () => {
    const req: RuntimeRequest = { source: "npm", sourceEpoch: E, sourceSeq: 0 };
    expect(
      deriveEffectiveSource(req, { localPath: "/r/co", localBinding: { epoch: E, seq: 0 } }),
    ).toBe("npm");
  });
});

// ── Writers: epoch/seq lifecycle + unknown-key preservation (E19) ────────────

describe("request.json writer", () => {
  it("creates the file with a fresh uuid epoch and seq 1", () => {
    selectRuntimeSource(dir, { source: "npm", channel: "stable" });
    const req = readRuntimeRequest(dir);
    expect(req?.source).toBe("npm");
    expect(req?.sourceSeq).toBe(1);
    expect(req?.sourceEpoch).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("increments sourceSeq on every selection and keeps the epoch", () => {
    selectRuntimeSource(dir, { source: "npm" });
    const first = readRuntimeRequest(dir);
    selectRuntimeSource(dir, { source: "bundled" });
    const second = readRuntimeRequest(dir);
    expect(second?.sourceEpoch).toBe(first?.sourceEpoch);
    expect(second?.sourceSeq).toBe(2);
    expect(second?.source).toBe("bundled");
  });

  it("re-creates a corrupt file with a new epoch (cannot match an old binding)", () => {
    fs.writeFileSync(path.join(dir, "request.json"), "{not json");
    expect(readRuntimeRequest(dir)).toBeNull();
    selectRuntimeSource(dir, { source: "github" });
    const req = readRuntimeRequest(dir);
    expect(req?.sourceSeq).toBe(1);
    expect(req?.sourceEpoch).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives a legacy file (no epoch) a fresh epoch at seq 1", () => {
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify({ source: "npm" }));
    selectRuntimeSource(dir, { source: "npm" });
    const req = readRuntimeRequest(dir);
    expect(req?.sourceSeq).toBe(1);
    expect(req?.sourceEpoch).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("ensureRuntimeRequest", () => {
  it("creates a bundled request with a fresh binding when missing", () => {
    ensureRuntimeRequest(dir);
    expect(readRuntimeRequest(dir)).toMatchObject({ source: "bundled", sourceSeq: 1 });
  });

  it("leaves a valid request byte-identical (no seq bump — would turn local off)", () => {
    selectRuntimeSource(dir, { source: "npm" });
    selectRuntimeSource(dir, { source: "npm" });
    const before = fs.readFileSync(path.join(dir, "request.json"), "utf8");
    ensureRuntimeRequest(dir);
    expect(fs.readFileSync(path.join(dir, "request.json"), "utf8")).toBe(before);
  });

  it("repairs a legacy file (keeps its source, adds a fresh epoch)", () => {
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify({ source: "github", futureKey: 1 }));
    ensureRuntimeRequest(dir);
    expect(readRuntimeRequest(dir)).toMatchObject({ source: "github", sourceSeq: 1, futureKey: 1 });
  });
});

describe("unknown keys preserved (E19)", () => {
  const futureKey = { a: 1 };

  it("request.json writer preserves futureKey byte-equal", () => {
    fs.writeFileSync(
      path.join(dir, "request.json"),
      JSON.stringify({ source: "npm", sourceEpoch: E, sourceSeq: 1, futureKey }),
    );
    selectRuntimeSource(dir, { source: "github" });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "request.json"), "utf8"));
    expect(JSON.stringify(raw.futureKey)).toBe(JSON.stringify(futureKey));
    expect(raw.sourceSeq).toBe(2);
  });

  it("state.json writer preserves futureKey byte-equal", () => {
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ current: "0.9.0", futureKey }));
    patchRuntimeState(dir, { previous: "0.8.0" });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    expect(JSON.stringify(raw.futureKey)).toBe(JSON.stringify(futureKey));
    expect(raw.current).toBe("0.9.0");
    expect(raw.previous).toBe("0.8.0");
  });

  it("an updater returning only changed fields still preserves unknown keys and clears undefined", () => {
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ localPath: "/r/co", futureKey }));
    patchRuntimeState(dir, () => ({ current: "0.9.1", localPath: undefined }));
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    expect(JSON.stringify(raw.futureKey)).toBe(JSON.stringify(futureKey));
    expect(raw.current).toBe("0.9.1");
    expect("localPath" in raw).toBe(false);
  });

  it("state.json patch accepts an updater function", () => {
    patchRuntimeState(dir, (s) => ({ ...s, attempts: { "0.9.1": (s.attempts?.["0.9.1"] ?? 0) + 1 } }));
    patchRuntimeState(dir, (s) => ({ ...s, attempts: { "0.9.1": (s.attempts?.["0.9.1"] ?? 0) + 1 } }));
    expect(readRuntimeState(dir).attempts).toEqual({ "0.9.1": 2 });
  });

  it("missing / corrupt state.json reads as empty defaults", () => {
    expect(readRuntimeState(dir)).toEqual({});
    fs.writeFileSync(path.join(dir, "state.json"), "[]");
    expect(readRuntimeState(dir)).toEqual({});
    fs.writeFileSync(path.join(dir, "state.json"), "{oops");
    expect(readRuntimeState(dir)).toEqual({});
  });

  it("leaves no tmp files behind", () => {
    selectRuntimeSource(dir, { source: "npm" });
    patchRuntimeState(dir, { current: "0.9.0" });
    expect(fs.readdirSync(dir).sort()).toEqual(["request.json", "state.json"]);
  });
});

// ── E14: local identity key ─────────────────────────────────────────────────

describe("deriveLocalIdentity (E14)", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

  function makeRepo(): string {
    const repo = path.join(dir, "co");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(repo, "a.txt"), "1");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "A");
    return repo;
  }

  it("id is local:<realpath> across commits, dirty toggles and symlinks; snapshot tracks SHA/dirty", () => {
    const repo = makeRepo();
    const real = fs.realpathSync(repo);
    const link = path.join(dir, "link");
    fs.symlinkSync(repo, link);

    const a = deriveLocalIdentity(repo);
    expect(a.id).toBe(localRuntimeId(real));
    expect(a.id).toBe(`local:${real}`);
    expect(a.snapshot.gitSha).toBe(git(repo, "rev-parse", "HEAD"));
    expect(a.snapshot.dirty).toBe(false);

    fs.writeFileSync(path.join(repo, "a.txt"), "2");
    const dirty = deriveLocalIdentity(repo);
    expect(dirty.id).toBe(a.id);
    expect(dirty.snapshot.dirty).toBe(true);
    expect(dirty.snapshot.gitSha).toBe(a.snapshot.gitSha);

    git(repo, "commit", "-qam", "B");
    const b = deriveLocalIdentity(repo);
    expect(b.id).toBe(a.id);
    expect(b.snapshot.gitSha).not.toBe(a.snapshot.gitSha);
    expect(b.snapshot.dirty).toBe(false);

    const viaLink = deriveLocalIdentity(link);
    expect(viaLink.id).toBe(a.id);
    expect(viaLink.snapshot.gitSha).toBe(b.snapshot.gitSha);
  });

  it("a non-git folder still yields the realpath id with a null SHA", () => {
    const plain = path.join(dir, "plain");
    fs.mkdirSync(plain);
    const id = deriveLocalIdentity(plain);
    expect(id.id).toBe(`local:${fs.realpathSync(plain)}`);
    expect(id.snapshot.gitSha).toBeNull();
  });
});
