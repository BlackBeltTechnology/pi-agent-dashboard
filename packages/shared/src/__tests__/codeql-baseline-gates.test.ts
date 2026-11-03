/**
 * Contract: every committed `operator-authz` reason in `codeql-baseline.json`
 * names the gate that bounds its sink (spec "operator-authz reasons cite their
 * bounding gate", test-plan #E1–#E16, #E32).
 *
 * Forms (after any `github-dismissed (…): ` prefix, which GitHub never sees):
 *   operator-authz: gate: <symbol> <repo-path>:<line>; <basis>
 *   operator-authz: control-tier: <basis>      (only CONTROL_TIER_FILES)
 * The body is ≤ 236 chars, so `<body> — See change: <id>` fits GitHub's
 * 280-char dismissal comment with the gate first.
 *
 * The test reads only repo files: it checks symbol presence and line range,
 * not that the gate actually runs before the sink (that is review, M1).
 *
 * See change: fix-codeql-baseline-coverage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

const CHANGE_ID = "fix-codeql-baseline-coverage";
const MAX_BODY = 236;
const COMMENT_SUFFIX = ` — See change: ${CHANGE_ID}`;
const BANNED = ["can already spawn shell-capable", "behind the universal network guard"];
const CONTROL_TIER_FILES = new Set([
  "packages/server/src/git-worktree/git-operations.ts",
  "packages/server/src/spawn-process/process-manager.ts",
  "packages/server/src/spawn-process/spawn-preflight.ts",
]);
/** Sinks that are not request sinks at all: never `operator-authz`. */
const NOT_OPERATOR_AUTHZ = new Set([
  "packages/server/src/rpc-keeper/keeper-manager.ts",
  "packages/server/src/lib/path-containment.ts",
]);
const F1_FILE = "packages/automation-plugin/src/server/automation-writer.ts";

type Entry = { ruleId: string; file: string; lineHash: string; count: number; reason: string };
const entryKey = (e: Pick<Entry, "ruleId" | "file" | "lineHash">) => `${e.ruleId} ${e.file} ${e.lineHash}`;
const fileOf = (key: string) => key.split(" ")[1] ?? "";

/** Reason text after any `github-dismissed (…): ` prefix (what GitHub shows). */
function reasonBody(reason: string): string {
  return reason.replace(/^github-dismissed \([^)]*\): /, "");
}

/** GitHub dismissal comment derived from a baseline reason. */
function dismissalComment(reason: string): string {
  return reasonBody(reason) + COMMENT_SUFFIX;
}

/**
 * Validate one baseline reason. Returns a list of errors, each naming the
 * entry; empty = valid. Reasons that are not `operator-authz` are not
 * evaluated (beyond the not-request-reachable rule, which is about the class).
 */
function validateOperatorAuthzReason(key: string, reason: string, root: string): string[] {
  const body = reasonBody(reason);
  if (!body.startsWith("operator-authz:")) return [];
  const errs: string[] = [];
  const err = (m: string) => errs.push(`${key}: ${m}`);
  const file = fileOf(key);
  if (NOT_OPERATOR_AUTHZ.has(file)) err("not a request sink; must be false-positive:, not operator-authz");
  for (const b of BANNED) if (body.includes(b)) err(`canned universal-guard reason ("${b}")`);
  if (body.length > MAX_BODY) err(`reason is ${body.length} chars after the prefix (max ${MAX_BODY})`);
  const rest = body.slice("operator-authz:".length).trim();
  if (rest.startsWith("control-tier:")) {
    if (!rest.slice("control-tier:".length).trim()) err("control-tier: without a basis");
    if (!CONTROL_TIER_FILES.has(file)) err(`control-tier: form not allowed for ${file}`);
    return errs;
  }
  const m = /^gate: (\S+) (\S+):(\S+?)(?:;|$)/.exec(rest);
  if (!m) {
    err("must be `gate: <symbol> <repo-path>:<line>` or `control-tier: <basis>`");
    return errs;
  }
  const [, symbol, gatePath, lineRaw] = m;
  const abs = path.join(root, gatePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    err(`gate path ${gatePath} does not exist`);
    return errs;
  }
  const text = fs.readFileSync(abs, "utf8");
  if (!text.includes(symbol)) err(`gate symbol ${symbol} not found in ${gatePath}`);
  const line = /^\d+$/.test(lineRaw) ? Number(lineRaw) : Number.NaN;
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (!Number.isInteger(line) || line < 1 || line > lines) err(`gate line ${lineRaw} outside 1..${lines} of ${gatePath}`);
  return errs;
}

/** F1 (#1104): an unfixed finding keeps `accepted-risk:` citing its issue. */
function validateF1Reason(key: string, reason: string): string[] {
  const body = reasonBody(reason);
  if (/^accepted-risk: .*#\d+/.test(body)) return [];
  return [`${key}: must be accepted-risk: citing the tracking issue as #<digits>`];
}

const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, "codeql-baseline.json"), "utf8")) as {
  entries: Entry[];
};

/** The change folder moves to the archive on ship; find the evidence either way. */
function evidencePath(name: string): string {
  const active = path.join(repoRoot, "openspec", "changes", CHANGE_ID, "evidence", name);
  if (fs.existsSync(active)) return active;
  const archive = path.join(repoRoot, "openspec", "changes", "archive");
  const dir = fs.readdirSync(archive).find((d) => d.endsWith(`-${CHANGE_ID}`));
  if (!dir) throw new Error(`evidence ${name} not found for ${CHANGE_ID}`);
  return path.join(archive, dir, "evidence", name);
}

const R = "js/path-injection";
const key = (file: string) => `${R} ${file} 0000000000000000:1`;
const BROWSE = "packages/server/src/routes/browse.ts";
const FPR = "packages/server/src/routes/folder-project-routes.ts";
const PREFLIGHT = "packages/server/src/spawn-process/spawn-preflight.ts";
const CANNED =
  "operator-authz: Operator API behind the universal network guard (createNetworkGuardHook); an admitted caller can already spawn shell-capable sessions.";
const okGate = `operator-authz: gate: admitCwd ${FPR}:65; known folders only`;
const v = (file: string, reason: string, root = repoRoot) => validateOperatorAuthzReason(key(file), reason, root);
/** Pad a body to exactly n chars (keeps a valid gate prefix). */
const padTo = (body: string, n: number) => body + "x".repeat(n - body.length);

describe("operator-authz reasons cite their bounding gate — real baseline", () => {
  it("#E1 operator-authz keys equal the dismissal table's operator-authz rows, all valid", () => {
    const table = JSON.parse(fs.readFileSync(evidencePath("dismissal-comments.json"), "utf8")) as Record<
      string,
      { entryKey: string; reasonText: string }
    >;
    const expected = new Set(
      Object.values(table)
        .filter((r) => r.reasonText.startsWith("operator-authz:"))
        .map((r) => r.entryKey),
    );
    const actual = baseline.entries.filter((e) => reasonBody(e.reason).startsWith("operator-authz:"));
    expect(new Set(actual.map(entryKey))).toEqual(expected);
    const errs = actual.flatMap((e) => validateOperatorAuthzReason(entryKey(e), e.reason, repoRoot));
    expect(errs).toEqual([]);
  });

  it("#E3 no reason of any class carries the canned sentence", () => {
    const offenders = baseline.entries.filter((e) => BANNED.some((b) => e.reason.includes(b))).map(entryKey);
    expect(offenders).toEqual([]);
  });

  it("#E14 keeper-manager and path-containment carry false-positive:, never operator-authz", () => {
    for (const f of NOT_OPERATOR_AUTHZ) {
      const bodies = baseline.entries.filter((e) => e.file === f).map((e) => reasonBody(e.reason));
      expect(bodies.some((b) => b.startsWith("false-positive: ")), f).toBe(true);
      expect(bodies.filter((b) => b.startsWith("operator-authz:")), f).toEqual([]);
    }
  });

  it("#E32 automation-writer entries are accepted-risk citing #1104 (vacuous without the anchor)", () => {
    const es = baseline.entries.filter((e) => e.file === F1_FILE);
    for (const e of es) {
      expect(validateF1Reason(entryKey(e), e.reason)).toEqual([]);
      expect(e.reason).toContain("#1104");
      expect(reasonBody(e.reason)).not.toMatch(/^false-positive:/);
    }
  });
});

describe("validateOperatorAuthzReason — fixtures", () => {
  it("#E2 canned reason rejected, naming entry and phrase", () => {
    const errs = v(BROWSE, CANNED);
    expect(errs.join("\n")).toContain(key(BROWSE));
    expect(errs.join("\n")).toContain("can already spawn shell-capable");
  });

  it("#E4 existing gate accepted", () => {
    expect(v(FPR, okGate)).toEqual([]);
  });

  it("#E5 gate symbol absent fails naming entry and symbol", () => {
    const errs = v(FPR, `operator-authz: gate: noSuchSymbol ${FPR}:65`).join("\n");
    expect(errs).toContain(key(FPR));
    expect(errs).toContain("noSuchSymbol");
  });

  it("#E6 gate path nonexistent fails naming entry and path", () => {
    const p = "packages/server/src/routes/does-not-exist.ts";
    const errs = v(FPR, `operator-authz: gate: admitCwd ${p}:1`).join("\n");
    expect(errs).toContain(key(FPR));
    expect(errs).toContain(p);
  });

  it("#E7 gate line boundary: 1 and N pass, 0 and N+1 fail", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gates-"));
    fs.writeFileSync(path.join(root, "g.ts"), "a\nb\nmyGate\n");
    const r = (line: number) => v(BROWSE, `operator-authz: gate: myGate g.ts:${line}; x`, root);
    expect(r(1)).toEqual([]);
    expect(r(3)).toEqual([]);
    expect(r(0)).not.toEqual([]);
    expect(r(4)).not.toEqual([]);
  });

  it("#E8 body length boundary: 235 and 236 pass, 237 fails", () => {
    expect(v(FPR, padTo(okGate, 235))).toEqual([]);
    expect(v(FPR, padTo(okGate, 236))).toEqual([]);
    const errs = v(FPR, padTo(okGate, 237)).join("\n");
    expect(errs).toContain(key(FPR));
  });

  it("#E9 length excludes the github-dismissed prefix", () => {
    const reason = `github-dismissed (#57, won't fix): ${padTo(okGate, 236)}`;
    expect(reason.length).toBeGreaterThan(236);
    expect(v(FPR, reason)).toEqual([]);
  });

  it("#E10 mirrored entry keeps the gate first in the derived comment", () => {
    const reason = `github-dismissed (#57, won't fix): operator-authz: gate: isWithinBrowseRoots packages/server/src/routes/file-routes.ts:621; remote callers confined`;
    expect(v(BROWSE, reason)).toEqual([]);
    const comment = dismissalComment(reason);
    expect(comment).toMatch(/^operator-authz: gate: /);
    expect(comment.length).toBeLessThanOrEqual(280);
    expect(dismissalComment(padTo(okGate, MAX_BODY)).length).toBeLessThanOrEqual(280);
  });

  it("#E11 control-tier form on an allowlisted file passes", () => {
    expect(
      v(
        PREFLIGHT,
        "operator-authz: control-tier: POST /api/session/spawn; probe targets a directory the caller may already start a shell in",
      ),
    ).toEqual([]);
  });

  it("#E12 control-tier form on any other file fails naming entry", () => {
    expect(v(BROWSE, "operator-authz: control-tier: whatever").join("\n")).toContain(key(BROWSE));
  });

  it("#E13 decision table form × file class", () => {
    expect([...CONTROL_TIER_FILES].sort()).toEqual([
      "packages/server/src/git-worktree/git-operations.ts",
      "packages/server/src/spawn-process/process-manager.ts",
      "packages/server/src/spawn-process/spawn-preflight.ts",
    ]);
    expect(v(BROWSE, okGate)).toEqual([]); // gate + observe file
    expect(v(PREFLIGHT, okGate)).toEqual([]); // gate + allowlisted (gate real)
    expect(v(PREFLIGHT, "operator-authz: control-tier: spawn")).toEqual([]); // ctrl + allowlisted
    expect(v(BROWSE, "operator-authz: control-tier: spawn")).not.toEqual([]); // ctrl + other
  });

  it("#E14 keeper-manager / path-containment as operator-authz fail", () => {
    for (const f of NOT_OPERATOR_AUTHZ) expect(v(f, okGate).join("\n")).toContain(key(f));
  });

  it("#E15 malformed shapes fail; non-operator-authz reasons are not evaluated", () => {
    for (const bad of [
      "operator-authz:",
      "operator-authz: gate:",
      `operator-authz: gate: admitCwd ${FPR}`,
      `operator-authz: gate: admitCwd ${FPR}:abc`,
    ]) {
      expect(v(FPR, bad).join("\n"), bad).toContain(key(FPR));
    }
    expect(v(FPR, "accepted-risk: something unrelated")).toEqual([]);
  });

  it("#E16 bare entry is validated under the same rules", () => {
    expect(
      v(
        "packages/server/src/routes/file-routes.ts",
        "operator-authz: gate: resolveScopedMdPath packages/server/src/routes/file-routes.ts:243; markdown only",
      ),
    ).toEqual([]);
  });

  it("#E32 F1 reason class × issue ref", () => {
    const k = key(F1_FILE);
    expect(validateF1Reason(k, "accepted-risk: writeAutomation reachable; tracked in #1104")).toEqual([]);
    for (const bad of [
      "false-positive: isValidAutomationName",
      "accepted-risk: tracked in #<n>",
      "accepted-risk: tracked elsewhere",
    ]) {
      expect(validateF1Reason(k, bad).join("\n"), bad).toContain(k);
    }
  });
});
