/**
 * Consumer listing from the self-registration files
 * (`~/.pi/agent/system-one/consumers/*.json`), re-read on every request. The
 * built-in `system-one:selftest` consumer is always listed with its bundled
 * fixtures. A consumer whose fixtures are missing/unreadable gets Test
 * disabled with a reason. See change: add-system-one-registry.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsumerDeclaration, CONSUMER_ID, consumersDir, isObj, safeParse } from "@blackbelt-technology/pi-system-one";

export const SELFTEST_ID = "system-one:selftest";
export const SELFTEST_FIXTURES = fileURLToPath(new URL("./fixtures/selftest.json", import.meta.url));

export const SELFTEST: ConsumerDeclaration = {
  id: SELFTEST_ID,
  label: "System-1 self-test",
  failurePolicy: "fail-closed",
  fixtures: SELFTEST_FIXTURES,
};

export interface Fixture {
  state: string;
  questions: Record<string, any>;
  expected: Record<string, unknown>;
}

export type FixtureLoad = { ok: true; cases: Fixture[] } | { ok: false; reason: string };

export function loadFixtures(path: string | undefined): FixtureLoad {
  if (!path) return { ok: false, reason: "no-fixtures" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: "fixtures-missing" };
  }
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return { ok: false, reason: "fixtures-invalid" };
    const cases = v.filter(
      (c): c is Fixture => isObj(c) && typeof c.state === "string" && isObj(c.questions) && isObj(c.expected),
    );
    return cases.length ? { ok: true, cases } : { ok: false, reason: "fixtures-invalid" };
  } catch {
    return { ok: false, reason: "fixtures-invalid" };
  }
}

export interface ConsumerRow extends ConsumerDeclaration {
  lastSeen: string | null;
  test: { enabled: boolean; cases: number; reason?: string };
}

function row(d: ConsumerDeclaration, lastSeen: string | null): ConsumerRow {
  const fx = loadFixtures(d.fixtures);
  return {
    ...d,
    lastSeen,
    test: fx.ok ? { enabled: true, cases: fx.cases.length } : { enabled: false, cases: 0, reason: fx.reason },
  };
}

export function listConsumers(dir = consumersDir()): ConsumerRow[] {
  const out = new Map<string, ConsumerRow>();
  out.set(SELFTEST_ID, row(SELFTEST, null));
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    names = [];
  }
  for (const n of names) {
    try {
      const v = safeParse(readFileSync(join(dir, n), "utf8"), () => {});
      if (!isObj(v) || typeof v.id !== "string" || !CONSUMER_ID.test(v.id) || v.id === SELFTEST_ID) continue;
      const policy = v.failurePolicy;
      if (policy !== "fail-open" && policy !== "fail-closed" && policy !== "deterministic") continue;
      const decl: ConsumerDeclaration = {
        id: v.id,
        failurePolicy: policy,
        ...(typeof v.label === "string" ? { label: v.label } : {}),
        ...(isObj(v.requires) ? { requires: { ...v.requires } } : {}),
        ...(typeof v.fixtures === "string" ? { fixtures: v.fixtures } : {}),
      };
      out.set(v.id, row(decl, typeof v.lastSeen === "string" ? v.lastSeen : null));
    } catch {
      // invalid file → skipped
    }
  }
  return [...out.values()];
}
