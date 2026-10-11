import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Case, type CaseSet, caseSetHash } from "../../cases.js";
import { casePath } from "../../commands/cases.js";
import { sha256, stableJson } from "../../util.js";
import type { TestEnv } from "./ctx.js";

export function mkCase(over: Partial<Case> & { id: string }): Case {
  const base = {
    type: "recurring_fault" as const,
    sessionId: "00000000-0000-4000-8000-00000000cafe",
    decisionTime: "2026-02-01T12:00:00.000Z",
    query: "kaboom failure",
    context: "ctx",
    goldSessions: [] as string[],
    ...over,
  };
  return { ...base, contentHash: sha256(`${base.query}|${base.context}|${[...base.goldSessions].sort().join(",")}`) } as Case;
}

export function writeCaseSet(env: TestEnv, cases: Case[], name = "baseline"): CaseSet {
  const set: CaseSet = {
    version: 1,
    caseSetHash: caseSetHash(cases),
    seed: 5,
    quotas: { recurring: 60, negatives: 30 },
    counts: { candidates: { recurring_fault: 0, user_flagged: 0, explicit_ref: 0, negative: 0 }, sampled: { recurring_fault: 0, user_flagged: 0, explicit_ref: 0, negative: 0 } },
    excludedSignatures: 0,
    inputFingerprint: { files: 0, sha256: "0" },
    cases,
  };
  const p = casePath(env.paths.casesDir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, stableJson(set));
  return set;
}

export const hermesDbPath = (env: TestEnv) => join(env.home, ".pi", "agent", "pi-hermes-memory", "sessions.db");
