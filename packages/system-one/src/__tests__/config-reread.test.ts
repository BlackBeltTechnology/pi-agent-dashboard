/**
 * Config re-read invariant. Task 3.20 (test-plan P2): 1,000 `predict` calls
 * with an unchanged config read the file once; touching its mtime triggers
 * exactly one more read. `node:fs` is wrapped (ESM namespaces cannot be
 * spied) and only reads of the config path are counted.
 * See change: add-system-one-registry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ path: "", count: 0 }));
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((p: any, ...rest: any[]) => {
      if (String(p) === reads.path) reads.count++;
      return (actual.readFileSync as any)(p, ...rest);
    }) as typeof actual.readFileSync,
  };
});

import { utimesSync } from "node:fs";
import { userConfigPath } from "../config.js";
import { predict } from "../predict.js";
import { chainConfig, freshState } from "./helpers/config.js";
import { type FakeBackend, startFakeBackend } from "./helpers/fake-backend.js";

let f: FakeBackend;
beforeAll(async () => {
  freshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f = await startFakeBackend();
  chainConfig({ f: f.url });
  reads.path = userConfigPath();
});
afterAll(async () => f.close());

describe("P2 config re-read (3.20)", () => {
  it("reads once for 1,000 calls; once more after the mtime changes", async () => {
    const ask = () => predict({ consumer: { id: "reread", failurePolicy: "fail-open" }, state: "s", questions: { q: { type: "noul", instructions: "i" } } });
    for (let i = 0; i < 1000; i++) await ask();
    expect(reads.count).toBe(1);
    const future = Date.now() / 1000 + 60;
    utimesSync(userConfigPath(), future, future);
    await ask();
    await ask();
    expect(reads.count).toBe(2);
  }, 60_000);
});
