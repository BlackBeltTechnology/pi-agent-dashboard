/**
 * Key sources and atomic key write. Tasks 2.6–2.7 (test-plan E17–E18).
 * See change: add-system-one-registry.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({ failRename: false }));
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: ((a: any, b: any) => {
      if (fsMock.failRename) throw Object.assign(new Error("EXDEV: rename failed"), { code: "EXDEV" });
      return actual.renameSync(a, b);
    }) as typeof actual.renameSync,
  };
});

import { userConfigPath } from "../config.js";
import { authPath, keyStatus, writeKey } from "../keys.js";
import { predict } from "../predict.js";
import { freshState } from "./helpers/config.js";
import { type FakeBackend, startFakeBackend } from "./helpers/fake-backend.js";

let f: FakeBackend;
beforeEach(async () => {
  freshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f = await startFakeBackend();
});
afterEach(async () => {
  fsMock.failRename = false;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.MY_KEY;
  vi.restoreAllMocks();
  await f.close();
});

function writeUser(backend: Record<string, unknown>): void {
  mkdirSync(dirname(userConfigPath()), { recursive: true });
  writeFileSync(
    userConfigPath(),
    JSON.stringify({ version: 1, backends: { b: { kind: "http", url: f.url, ...backend } }, presets: { p: { chain: ["b"] } }, activePreset: "p" }),
  );
}
async function bearer(): Promise<string | undefined> {
  const r = await predict({ consumer: { id: "c", failurePolicy: "fail-open" }, state: "s", questions: { q: { type: "noul", instructions: "i" } } });
  expect(r.ok).toBe(true);
  return f.requests.at(-1)?.headers.authorization as string | undefined;
}

describe("E17 key sources (2.6)", () => {
  const refs = {
    explicit: { model: "custom", keyRef: "MY_KEY" },
    catalog: { model: "jev-1.13.0" }, // inherits TYPESAFE_API_KEY
    none: { model: "custom" },
  } as const;
  for (const [refKind, backend] of Object.entries(refs))
    for (const env of [true, false])
      for (const file of [true, false]) {
        it(`keyRef=${refKind} env=${env} file=${file}`, async () => {
          const name = refKind === "explicit" ? "MY_KEY" : "TYPESAFE_API_KEY";
          if (env) process.env[name] = "ENVKEY";
          if (file) writeKey(name, "FILEKEY");
          writeUser(backend);
          const got = await bearer();
          if (refKind === "none") expect(got).toBeUndefined();
          else if (env) expect(got).toBe("Bearer ENVKEY");
          else if (file) expect(got).toBe("Bearer FILEKEY");
          else expect(got).toBeUndefined();
        });
      }

  it("creates auth.json with mode 0600 and reports status without the key", () => {
    writeKey("TYPESAFE_API_KEY", "ts_TESTKEY123");
    expect(statSync(authPath()).mode & 0o777).toBe(0o600);
    expect(keyStatus("TYPESAFE_API_KEY")).toEqual({ set: true, source: "file" });
    process.env.TYPESAFE_API_KEY = "x";
    expect(keyStatus("TYPESAFE_API_KEY")).toEqual({ set: true, source: "env" });
    expect(keyStatus("OTHER_KEY")).toEqual({ set: false, source: null });
  });

  it("rejects an invalid keyRef name", () => {
    expect(() => writeKey("bad-name", "x")).toThrow();
  });
});

describe("E18 atomic key write (2.7)", () => {
  it("keeps K1 intact and leaves no partial file when rename fails", () => {
    writeKey("TYPESAFE_API_KEY", "K1");
    const before = readFileSync(authPath(), "utf8");
    fsMock.failRename = true;
    expect(() => writeKey("TYPESAFE_API_KEY", "K2")).toThrow(/rename/);
    expect(readFileSync(authPath(), "utf8")).toBe(before);
    const dir = join(homedir(), ".pi", "agent", "system-one");
    expect(readdirSync(dir).filter((n) => n !== "auth.json" && n.startsWith("auth"))).toEqual([]);
    expect(existsSync(authPath())).toBe(true);
  });
});
