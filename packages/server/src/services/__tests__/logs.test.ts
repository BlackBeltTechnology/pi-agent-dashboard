/**
 * Logs route + redaction, start record, restartRequired (add-services-settings-ui).
 * Test-plan: E1–E13, E14–E15 (record), X1–X5.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { afterEach, describe, expect, it } from "vitest";
import { AttachedDriver } from "../attached-driver.js";
import { buildApp, ociDef } from "./helpers.js";
import { cleanup, nativeDefOf, nativeHarness, ociHarness, seedStartRecord, writeOutput } from "./logs-helpers.js";

const roots: string[] = [];
afterEach(() => cleanup(roots));

/** Start the (only) native service so a real `start.json` + output.log exist. */
async function started(def: ServiceDefinition, secrets: Record<string, string> = {}) {
  const h = nativeHarness(def);
  roots.push(...h.roots);
  for (const [n, v] of Object.entries(secrets)) await h.manager.setSecret(def.id, n, v);
  const r = await h.manager.start(def.id);
  expect(r.state).toBe("healthy");
  return h;
}

const lines = (n: number, mk = (i: number) => `line ${i}`) => `${Array.from({ length: n }, (_, i) => mk(i + 1)).join("\n")}\n`;

describe("E1 — tail parsing", () => {
  it("accepts 1–2000, defaults to 200, refuses everything else with invalid-tail", async () => {
    const h = await started(nativeDefOf());
    fs.appendFileSync(h.paths.outputLog("docling"), lines(3000));
    const get = async (tail?: string) => h.manager.logs("docling", tail);
    for (const bad of ["0", "2001", "abc", "", "-1", "1.5", "100000"]) {
      await expect(get(bad)).rejects.toMatchObject({ status: 400, code: "invalid-tail" });
    }
    const one = await get("1");
    expect(one).toMatchObject({ available: true });
    expect((one as { lines: string[] }).lines).toEqual(["line 3000"]);
    expect((await get() as { lines: string[] }).lines).toHaveLength(200);
    expect((await get("2000") as { lines: string[] }).lines).toHaveLength(2000);
  });

  it("the route answers 400 invalid-tail", async () => {
    const h = await started(nativeDefOf());
    const app = await buildApp(h.manager);
    const res = await app.inject({ method: "GET", url: "/api/services/docling/logs?tail=100000", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid-tail" });
    await app.close();
  });
});

describe("E2 — 512 KiB whole-line cut", () => {
  it("drops whole lines from the start, keeps the last line", async () => {
    const h = await started(nativeDefOf());
    // 2000 × 400 B ≈ 800 KiB, under the 1 MiB output cap so nothing is truncated first.
    fs.appendFileSync(h.paths.outputLog("docling"), lines(2000, (i) => `${String(i).padStart(4, "0")} ${"x".repeat(394)}`));
    const r = (await h.manager.logs("docling", "2000")) as { lines: string[] };
    const bytes = r.lines.reduce((a, l) => a + Buffer.byteLength(l) + 1, 0);
    expect(bytes).toBeLessThanOrEqual(512 * 1024);
    expect(r.lines.length).toBeLessThan(2000);
    expect(r.lines.every((l) => l.length === 399)).toBe(true);
    expect(r.lines.at(-1)?.startsWith("2000 ")).toBe(true);
  });
});

describe("E3–E6 — redaction", () => {
  it("E3 replaces the value with a named marker", async () => {
    const h = await started(nativeDefOf("docling", { token: { env: "TOKEN" } }), { token: "s3cr3t-value" });
    fs.appendFileSync(h.paths.outputLog("docling"), "auth s3cr3t-value ok\n");
    expect(await h.manager.logs("docling")).toMatchObject({ available: true, lines: ["auth «secret:token» ok"] });
  });

  it("E4 longest value wins at each position", async () => {
    const h = await started(nativeDefOf("docling", { a: { env: "A" }, b: { env: "B" } }), { a: "pass1234", b: "pass1234xyz" });
    fs.appendFileSync(h.paths.outputLog("docling"), "pass1234xyz pass1234\n");
    expect(((await h.manager.logs("docling")) as { lines: string[] }).lines).toEqual(["«secret:b» «secret:a»"]);
  });

  it("E5 a written marker is never re-matched", async () => {
    const h = await started(nativeDefOf("docling", { a: { env: "A" }, b: { env: "B" } }), { a: "secret", b: "token-secret" });
    fs.appendFileSync(h.paths.outputLog("docling"), "token-secret\n");
    expect(((await h.manager.logs("docling")) as { lines: string[] }).lines).toEqual(["«secret:b»"]);
  });

  it("E6 a multi-line value at the window edge leaks neither half", async () => {
    const h = await started(nativeDefOf("docling", { key: { env: "K" } }), { key: "PEM-HALF-ONE\nPEM-HALF-TWO" });
    fs.appendFileSync(
      h.paths.outputLog("docling"),
      `${["a", "b", "c", "d", "PEM-HALF-ONE", "PEM-HALF-TWO", "e", "f", "g", "h"].join("\n")}\n`,
    );
    // last N=5 lines would start at PEM-HALF-TWO; the window M = 5+2-1 pulls ONE in.
    const r = (await h.manager.logs("docling", "5")) as { lines: string[] };
    const all = r.lines.join("\n");
    expect(all).not.toContain("PEM-HALF-ONE");
    expect(all).not.toContain("PEM-HALF-TWO");
    expect(all).toContain("«secret:key»");
  });
});

describe("E7–E8 — secrets that cannot be redacted fail closed", () => {
  it("E7 length 3 → secret-too-short naming it; length 4 → output", async () => {
    const h = await started(nativeDefOf("docling", { token: { env: "T" } }), { token: "abc" });
    fs.appendFileSync(h.paths.outputLog("docling"), "hello abc\n");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "secret-too-short", secret: "token" });
    const h2 = await started(nativeDefOf("docling", { token: { env: "T" } }), { token: "abcd" });
    fs.appendFileSync(h2.paths.outputLog("docling"), "hello abcd\n");
    expect(((await h2.manager.logs("docling")) as { lines: string[] }).lines).toEqual(["hello «secret:token»"]);
  });

  it("E8 unset is skipped, unreadable fails closed, first in declaration order is named", async () => {
    const run = (async (file: string) => (file.endsWith("security") ? { code: 44, stdout: "", stderr: "", timedOut: false } : { code: 0, stdout: "", stderr: "", timedOut: false })) as never;
    const def = nativeDefOf("docling", { kc: { env: "KC", ref: "keychain:svc/acct" }, tok: { env: "T" } });
    const h = nativeHarness(def, { run, platform: "darwin" });
    roots.push(...h.roots);
    // `kc` is unreadable (keychain exits non-zero); `tok` is store-backed and never set.
    seedStartRecord(h, "docling", "native");
    writeOutput(h, "docling", "some output\n");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "secret-unavailable", secret: "kc" });

    // (a) only an unset store secret → output returned
    const h2 = nativeHarness(nativeDefOf("docling", { tok: { env: "T" } }));
    roots.push(...h2.roots);
    seedStartRecord(h2, "docling", "native");
    writeOutput(h2, "docling", "visible\n");
    expect(await h2.manager.logs("docling")).toMatchObject({ available: true, lines: ["visible"] });
  });
});

describe("E9 — reason precedence", () => {
  it("external-mode service → external", async () => {
    const h = nativeHarness({ id: "ext", mode: "external", endpoints: { http: "http://127.0.0.1:9" }, health: { kind: "tcp", endpoint: "http" }, origin: "user" } as ServiceDefinition);
    roots.push(...h.roots);
    expect(await h.manager.logs("ext")).toEqual({ available: false, reason: "external" });
  });

  it("attached instance the dashboard did not start: file → lines, no file → external", async () => {
    const def = {
      id: "app",
      mode: "attached",
      endpoints: { http: "http://127.0.0.1:9" },
      process: { name: "app" },
      lifecycle: { start: { linux: ["app"] } },
      health: { kind: "tcp", endpoint: "http" },
      origin: "user",
    } as ServiceDefinition;
    const h = nativeHarness(def);
    roots.push(...h.roots);
    const attached = new AttachedDriver({ run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }), platform: "linux", findProcesses: async () => [99], output: h.output });
    const h2 = (await import("./helpers.js")).makeManager(h.roots[0], { drivers: { attached }, output: h.output });
    expect((await h2.manager.start("app")).state).toBe("healthy"); // adopted: startedBy external
    expect(await h2.manager.logs("app")).toEqual({ available: false, reason: "external" });
    seedStartRecord(h, "app", "attached");
    writeOutput(h, "app", "from an earlier dashboard start\n");
    expect(await h2.manager.logs("app")).toMatchObject({ available: true, lines: ["from an earlier dashboard start"] });
  });

  it("native with no output file, or no start.json → no-output", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "no-output" }); // no start.json
    seedStartRecord(h, "docling", "native");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "no-output" }); // no file
  });
});

describe("E10 — stale flag", () => {
  it("a failed service keeps its output, stale:true; healthy → stale:false", async () => {
    const h = nativeHarness(nativeDefOf());
    roots.push(...h.roots);
    h.probeOk.value = false;
    h.alive.value = false;
    expect((await h.manager.start("docling")).state).toBe("failed");
    fs.appendFileSync(h.paths.outputLog("docling"), "boom 1\nboom 2\n");
    expect(await h.manager.logs("docling")).toEqual({ available: true, driver: "native", lines: ["boom 1", "boom 2"], stale: true });
    const ok = await started(nativeDefOf());
    fs.appendFileSync(ok.paths.outputLog("docling"), "fine\n");
    expect(await ok.manager.logs("docling")).toMatchObject({ available: true, stale: false });
  });
});

describe("E11–E13, X1–X2 — OCI logs", () => {
  const container = (id: string, owner = "iid-1") => ({
    Id: id,
    Config: { Labels: { "pi.service": "docling", "pi.owner": owner } },
    State: { Running: true },
  });
  const fixture = (extra: { logs?: (a: string[]) => Partial<import("../command-runner.js").RunResult>; list?: unknown[] } = {}) =>
    ociHarness(ociDef(), (args) => {
      if (args[0] === "ps") return { stdout: (extra.list ?? [container("c1")]).map((c) => (c as { Id: string }).Id).join("\n") };
      if (args[0] === "inspect") return { stdout: JSON.stringify(extra.list ?? [container("c1")]) };
      if (args[0] === "logs") return extra.logs?.(args) ?? { stdout: "", stderr: "" };
      return undefined;
    });

  it("E11 merges stdout and stderr by timestamp, stdout first on a tie, prefix stripped", async () => {
    const h = fixture({
      logs: () => ({
        stdout: "2026-10-15T10:00:01.000000000Z out-1\n2026-10-15T10:00:03.000000000Z out-3\n",
        stderr: "2026-10-15T10:00:01.000000000Z err-1\n2026-10-15T10:00:02.500000000Z err-2\n",
      }),
    });
    roots.push(...h.roots);
    seedStartRecord(h, "docling", "oci:docker");
    expect(await h.manager.logs("docling")).toMatchObject({ available: true, lines: ["out-1", "err-1", "err-2", "out-3"] });
  });

  it("E12 argv = logs --timestamps --since <T> --tail M <id>, M = N + longest secret lines − 1", async () => {
    const def = ociDef({ secrets: { key: { env: "K" } } } as never);
    const h = ociHarness(def, (args) => {
      if (args[0] === "ps") return { stdout: "c1" };
      if (args[0] === "inspect") return { stdout: JSON.stringify([container("c1")]) };
      return undefined;
    });
    roots.push(...h.roots);
    await h.manager.setSecret("docling", "key", "line-a\nline-b\nline-c");
    // the digest of the value at start
    seedStartRecord(h, "docling", "oci:docker", { key: "line-a\nline-b\nline-c" }, { startedAt: "2026-10-15T10:00:00.000Z" });
    await h.manager.logs("docling", "10");
    const logs = h.runner.calls.find((c) => c.args[0] === "logs");
    expect(logs?.args).toEqual(["logs", "--timestamps", "--since", "2026-10-15T10:00:00.000Z", "--tail", "12", "c1"]);
  });

  it("E13 two owned containers → duplicate-instances, no lines", async () => {
    const h = fixture({ list: [container("c1"), container("c2")] });
    roots.push(...h.roots);
    seedStartRecord(h, "docling", "oci:docker");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "duplicate-instances" });
  });

  it("X1 a runner timeout is runtime-error with no partial lines", async () => {
    const h = fixture({ logs: () => ({ timedOut: true, code: null, stdout: "2026-10-15T10:00:01Z partial\n" }) });
    roots.push(...h.roots);
    seedStartRecord(h, "docling", "oci:docker");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "runtime-error" });
  });

  it("X2 a runner-capped output is runtime-error with no lines", async () => {
    const h = fixture({ logs: () => ({ truncated: true, stdout: "2026-10-15T10:00:01Z head\n" }) });
    roots.push(...h.roots);
    seedStartRecord(h, "docling", "oci:docker");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "runtime-error" });
  });
});

describe("E14–E15 — start record and restartRequired", () => {
  it("E14 start.json is 0600, holds startedAt + a keyed digest, and survives adoption", async () => {
    const h = await started(nativeDefOf("docling", { a: { env: "A" } }), { a: "value-one" });
    const file = h.paths.startRecord("docling");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(h.paths.digestKey).mode & 0o777).toBe(0o600);
    const rec = JSON.parse(fs.readFileSync(file, "utf8")) as { startedAt: string; secretsDigest: string; output?: { ino: number } };
    expect(rec.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const { createHash } = await import("node:crypto");
    expect(rec.secretsDigest).not.toBe(createHash("sha256").update("a=value-one").digest("hex"));
    expect(rec.secretsDigest).not.toBe(createHash("sha256").update("a=value-one\0").digest("hex"));
    expect(rec.output?.ino).toBe(h.output.identity("docling")?.ino);
  });

  it("E15 saving a secret while it runs → restartRequired, across a restart; cleared by the next start", async () => {
    const h = await started(nativeDefOf("docling", { token: { env: "T" } }), { token: "value-one" });
    expect((await h.manager.status("docling")).restartRequired).toBeUndefined();
    await h.manager.setSecret("docling", "token", "value-two");
    expect((await h.manager.status("docling")).restartRequired).toBe(true);
    // new manager over the same root: adoption reads start.json back
    const { NativeDriver } = await import("../native-driver.js");
    const { makeManager } = await import("./helpers.js");
    const { servicesPaths } = await import("../paths.js");
    const native = new NativeDriver({
      run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
      resolveBinary: (n) => `/usr/bin/${n}`,
      paths: servicesPaths(h.roots[0]),
      platform: "linux",
      isAlive: () => alive,
      killProcessGroup: (async () => {
        alive = false;
        return { ok: true, forced: false };
      }) as never,
      spawn: (() => Object.assign(new EventEmitter(), { pid: 4322, unref: () => {} })) as never,
      allocatePort: async () => 47_001,
    });
    let alive = true;
    // adopt() needs a verifiable pid; drive adoption through a stub instead
    let adopted = false;
    native.adopt = async () => {
      if (adopted) return { kind: "none" };
      adopted = true;
      return { kind: "running", instance: { driver: "native", startedBy: "dashboard", pid: 4321, endpoints: { http: "http://127.0.0.1:47000" } } };
    };
    const h2 = makeManager(h.roots[0], { drivers: { native } });
    await h2.manager.boot();
    expect((await h2.manager.list()).services[0].restartRequired).toBe(true);
    await h2.manager.stop("docling");
    alive = true;
    await h2.manager.start("docling");
    expect((await h2.manager.status("docling")).restartRequired).not.toBe(true);
  });
});

describe("X3–X5 — fail-closed and authority", () => {
  it("X3 a changed env: value withholds the output until restart", async () => {
    const h = nativeHarness(nativeDefOf("docling", { token: { env: "T", ref: "env:SVC_TEST_TOKEN" } }));
    roots.push(...h.roots);
    const env = ((h.manager as unknown as { deps: { env?: NodeJS.ProcessEnv } }).deps);
    env.env = { SVC_TEST_TOKEN: "first-value" };
    await h.manager.start("docling");
    fs.appendFileSync(h.paths.outputLog("docling"), "hello first-value\n");
    expect(((await h.manager.logs("docling")) as { lines: string[] }).lines).toEqual(["hello «secret:token»"]);
    env.env = { SVC_TEST_TOKEN: "second-value" };
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "secrets-changed" });
    await h.manager.stop("docling");
    h.alive.value = true;
    await h.manager.start("docling");
    expect(await h.manager.logs("docling")).toMatchObject({ available: true });
  });

  it("X4 a rotated value does not survive the restart in the output", async () => {
    const h = await started(nativeDefOf("docling", { token: { env: "T" } }), { token: "old-value-1" });
    fs.appendFileSync(h.paths.outputLog("docling"), "token=old-value-1\n");
    await h.manager.setSecret("docling", "token", "new-value-2");
    expect(await h.manager.logs("docling")).toEqual({ available: false, reason: "secrets-changed" });
    await h.manager.stop("docling");
    h.alive.value = true;
    await h.manager.start("docling");
    const r = (await h.manager.logs("docling")) as { lines: string[] };
    expect(r.lines.join("\n")).not.toContain("old-value-1");
  });
});
