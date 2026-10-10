/**
 * Secret store, resolvers and delivery: generate on add, corrupt-store
 * refusal, stdin-only CLI entry, read-only keychain with no fallback, the
 * no-output invariant across every surface, and `exec` env injection.
 * See change: add-service-registry-core (test-plan E48–E54, X10).
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetQuarantineDedupForTests } from "../../auth/locked-json-file.js";
import { cmdService, localExecSecretsResolver } from "../cli-service.js";
import { servicesPaths } from "../paths.js";
import { KEYCHAIN_TIMEOUT_MS, resolveSecretRef, type SecretResolverDeps } from "../secrets-resolver.js";
import { SecretsStore } from "../secrets-store.js";
import { buildApp, FakeDriver, injectFetch, makeManager, ociDef, recordingRunner, tmpRoot, writeDefinitions } from "./helpers.js";

let root: string;
const apps: FastifyInstance[] = [];
beforeEach(() => {
  root = tmpRoot("svc-secrets-");
  _resetQuarantineDedupForTests();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const secretsFile = () => path.join(root, "services-secrets.json");
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function obsDef(): ServiceDefinition {
  return {
    id: "obs",
    mode: "external",
    endpoints: { ws: "ws://127.0.0.1:4455" },
    health: { kind: "ws-first-message", endpoint: "ws" },
    secrets: { password: {} },
    origin: "user",
  } as ServiceDefinition;
}

describe("E48 — generated secret on add", () => {
  it("stores <id>/password; the response says configured without the value", async () => {
    writeDefinitions(root, []);
    const { manager } = makeManager(root);
    const app = await buildApp(manager);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/services",
      payload: { definition: { ...ociDef({ id: "neo4j" }), origin: undefined, secrets: { password: { generate: { bytes: 32 } } } } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const stored = JSON.parse(fs.readFileSync(secretsFile(), "utf8")).secrets["neo4j/password"];
    expect(Buffer.from(stored, "base64url").length).toBe(32);
    expect(res.json().data.secrets).toEqual({ password: { configured: true } });
    expect(res.body).not.toContain(stored);
    expect(fs.statSync(secretsFile()).mode & 0o777).toBe(0o600);
  });
});

describe("E49 — a corrupt store refuses every write", () => {
  it("secret set refused; file byte-identical; status names the backup", async () => {
    writeDefinitions(root, [obsDef()]);
    fs.writeFileSync(secretsFile(), '{"version":1,"secrets":{"neo4j/password":"keep-me","obs/x":"y"');
    const before = sha(secretsFile());
    const { manager } = makeManager(root);
    const app = await buildApp(manager);
    apps.push(app);
    const res = await app.inject({ method: "PUT", url: "/api/services/obs/secrets/password", payload: { value: "new" } });
    expect(res.statusCode).toBe(409);
    expect(sha(secretsFile())).toBe(before);
    const list = (await app.inject({ method: "GET", url: "/api/services" })).json().data;
    expect(list.secretsCorrupt).toBe(true);
    expect(list.secretsBackupPath).toMatch(/services-secrets\.json\.corrupt-/);
    const p = await manager.ensure("obs");
    expect([p.state, p.reason]).toEqual(["unavailable", "secret-unavailable"]);
    expect(p.hint).toContain(".corrupt-");
  });
});

describe("audit — remove with a corrupt store refuses before any teardown", () => {
  it("409, the definition and run dir survive", async () => {
    writeDefinitions(root, [obsDef()]);
    const paths = servicesPaths(root);
    fs.mkdirSync(paths.runDir("obs"), { recursive: true });
    fs.writeFileSync(secretsFile(), "{ not json");
    const { manager } = makeManager(root);
    const app = await buildApp(manager);
    apps.push(app);
    const res = await app.inject({ method: "DELETE", url: "/api/services/obs" });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(fs.readFileSync(path.join(root, "services.json"), "utf8")).services.map((s: { id: string }) => s.id)).toEqual(["obs"]);
    expect(fs.existsSync(paths.runDir("obs"))).toBe(true);
  });
});

describe("store slot follows a store: ref on every path", () => {
  it("write, configured and ensure all use the ref's slot", async () => {
    writeDefinitions(root, [{ ...obsDef(), secrets: { password: { ref: "store:shared/obs_pw" } } }]);
    const { manager } = makeManager(root, { drivers: { external: new FakeDriver("external") } });
    await manager.setSecret("obs", "password", "v1");
    expect(new SecretsStore(secretsFile()).get("shared", "obs_pw")).toBe("v1");
    expect((await manager.list()).services[0].secrets).toEqual({ password: { configured: true } });
    expect((await manager.ensure("obs")).state).toBe("healthy");
  });
  it("a malformed store ref is secret-unavailable, not a lookup of a truncated key", async () => {
    const r = await resolveSecretRef("store:noslash", resolverDeps());
    expect(r).toMatchObject({ ok: false, reason: "secret-unavailable" });
  });
});

describe("E50 — CLI secret entry reads stdin, never argv", () => {
  it("stores the value; it appears in no argv and no URL", async () => {
    writeDefinitions(root, [obsDef()]);
    const { manager } = makeManager(root);
    const app = await buildApp(manager);
    apps.push(app);
    const value = `SVCTEST-${randomBytes(6).toString("hex")}`;
    const argv = ["secret", "set", "obs", "password", "--json"];
    const urls: string[] = [];
    const f = injectFetch(() => app);
    const code = await cmdService(argv, {
      port: 1,
      fetch: (async (u: string | URL | Request, i?: RequestInit) => {
        urls.push(String(u));
        return f(u, i);
      }) as typeof fetch,
      readStdin: async () => `${value}\n`,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(0);
    expect(new SecretsStore(secretsFile()).get("obs", "password")).toBe(value);
    expect(argv.join(" ")).not.toContain(value);
    for (const u of urls) expect(u).not.toContain(value);
  });
  it("refuses a value given on argv", async () => {
    const err: string[] = [];
    const code = await cmdService(["secret", "set", "obs", "password", "hunter2"], { port: 1, err: (s) => err.push(s), fetch: vi.fn() as never });
    expect(code).not.toBe(0);
    expect(err.join()).toMatch(/stdin/);
  });
});

function resolverDeps(over: Partial<SecretResolverDeps> = {}): SecretResolverDeps {
  return {
    store: new SecretsStore(secretsFile()),
    env: {},
    platform: "darwin",
    run: recordingRunner().run,
    resolveBinary: (n) => `/usr/bin/${n}`,
    ...over,
  };
}

describe("E51 — refs resolve from exactly one backend", () => {
  it("keychain darwin ok / timeout / linux no bus / win32; env set / unset; store missing", async () => {
    const store = new SecretsStore(secretsFile());
    await store.set("obs", "password", "from-store");
    const get = vi.spyOn(store, "get");
    const ok = recordingRunner(() => ({ stdout: "kc-value\n" }));
    const hang = recordingRunner(() => ({ code: null, timedOut: true }));
    const noBus = recordingRunner(() => ({ code: 1, stderr: "Cannot autolaunch D-Bus without X11 $DISPLAY" }));
    const kc = "keychain:pi-dashboard/obs";
    const results = [
      await resolveSecretRef(kc, resolverDeps({ store, run: ok.run })),
      await resolveSecretRef(kc, resolverDeps({ store, run: hang.run })),
      await resolveSecretRef(kc, resolverDeps({ store, run: noBus.run, platform: "linux" })),
      await resolveSecretRef(kc, resolverDeps({ store, platform: "win32" })),
      await resolveSecretRef("env:OBS_PW", resolverDeps({ store, env: { OBS_PW: "from-env" } })),
      await resolveSecretRef("env:OBS_PW", resolverDeps({ store, env: {} })),
      await resolveSecretRef("store:obs/missing", resolverDeps({ store })),
    ];
    expect(results.map((r) => (r.ok ? r.value : r.reason))).toEqual([
      "kc-value",
      "secret-unavailable",
      "secret-unavailable",
      "secret-unavailable",
      "from-env",
      "secret-unavailable",
      "secret-unavailable",
    ]);
    // store consulted only by the store: ref (never as a keychain fallback)
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("obs", "missing");
    for (const r of results) if (!r.ok) expect(r.hint).not.toContain("from-store");
  });

  it("ensure on a keychain ref that cannot resolve → secret-unavailable, store untouched", async () => {
    writeDefinitions(root, [{ ...obsDef(), secrets: { password: { ref: "keychain:pi-dashboard/obs" } } }]);
    await new SecretsStore(secretsFile()).set("obs", "password", "store-value");
    const { manager } = makeManager(root, { platform: "linux", run: recordingRunner(() => ({ code: 1 })).run });
    expect(await manager.ensure("obs")).toMatchObject({ state: "unavailable", reason: "secret-unavailable" });
    const win = makeManager(root, { platform: "win32" }).manager;
    expect(await win.ensure("obs")).toMatchObject({ state: "unavailable", reason: "secret-unavailable" });
  });
});

describe("E52 — the keychain is read-only", () => {
  it("argv is `security find-generic-password -s … -a … -w`; never add-generic-password", async () => {
    const runner = recordingRunner(() => ({ stdout: "v" }));
    await resolveSecretRef("keychain:svc-name/acct", resolverDeps({ run: runner.run }));
    expect(runner.calls).toEqual([{ file: "/usr/bin/security", args: ["find-generic-password", "-s", "svc-name", "-a", "acct", "-w"], env: undefined }]);
    const linux = recordingRunner(() => ({ stdout: "v" }));
    await resolveSecretRef("keychain:svc-name/acct", resolverDeps({ run: linux.run, platform: "linux" }));
    expect(linux.calls[0].args).toEqual(["lookup", "service", "svc-name", "account", "acct"]);
    const src = fs.readFileSync(new URL("../secrets-resolver.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/["']add-generic-password["']|["']store["'],\s*["']--label/);
  });
});

describe("X10 — a hanging `security` → secret-unavailable at 10 s, no fallback", () => {
  it("runs with the 10 s timeout and never consults the store", async () => {
    const store = new SecretsStore(secretsFile());
    await store.set("pi-dashboard", "obs", "should-not-be-used");
    const get = vi.spyOn(store, "get");
    const timeouts: Array<number | undefined> = [];
    const r = await resolveSecretRef(
      "keychain:pi-dashboard/obs",
      resolverDeps({
        store,
        run: async (_f, _a, o) => {
          timeouts.push(o?.timeoutMs);
          return { code: null, stdout: "", stderr: "", timedOut: true };
        },
      }),
    );
    expect(KEYCHAIN_TIMEOUT_MS).toBe(10_000);
    expect(timeouts).toEqual([10_000]);
    expect(r).toMatchObject({ ok: false, reason: "secret-unavailable" });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("E53 — no surface ever carries a secret value", () => {
  it("routes, CLI verbs and transition logs never contain the marker", async () => {
    const marker = `SVCTEST-${randomBytes(8).toString("hex")}`;
    writeDefinitions(root, [ociDef({ secrets: { password: { env: "PW_FILE" } } })]);
    const driver = new FakeDriver("oci:docker");
    const h = makeManager(root, { drivers: { "oci:docker": driver } });
    const app = await buildApp(h.manager);
    apps.push(app);
    const bodies: string[] = [];
    const call = async (method: string, url: string, payload?: unknown) => {
      const r = await app.inject({ method: method as "GET", url, ...(payload ? { payload: payload as object } : {}) });
      bodies.push(r.body);
      return r;
    };
    await call("PUT", "/api/services/docling/secrets/password", { value: marker });
    const ensured = (await call("POST", "/api/services/docling/ensure", {})).json().data;
    expect(driver.lastCtx?.secrets.password).toBe(marker); // delivered to the driver channel
    for (const [m, u, b] of [
      ["GET", "/api/services"],
      ["GET", "/api/services/docling"],
      ["GET", "/api/services/offers"],
      ["POST", "/api/services/docling/heartbeat", { leaseId: ensured.leaseId }],
      ["POST", "/api/services/docling/release", { leaseId: ensured.leaseId }],
      ["POST", "/api/services/docling/pin", {}],
      ["POST", "/api/services/docling/unpin", {}],
      ["POST", "/api/services/docling/stop", {}],
      ["POST", "/api/services/docling/start", {}],
      ["POST", "/api/services/docling/retry", {}],
      ["POST", "/api/services/docling/prefetch", {}],
    ] as Array<[string, string, unknown?]>) {
      await call(m, u, b);
    }
    const out: string[] = [];
    const deps = { port: 1, fetch: injectFetch(() => app), out: (s: string) => out.push(s), err: (s: string) => out.push(s), confirm: async () => true };
    for (const argv of [
      ["ensure", "docling"],
      ["ensure", "docling", "--json"],
      ["list"],
      ["status", "docling", "--json"],
      ["start", "docling"],
      ["stop", "docling", "--json"],
      ["pin", "docling"],
      ["unpin", "docling", "--json"],
      ["retry", "docling"],
      ["add", "--file", "/nonexistent.json", "--json"],
    ]) {
      await cmdService(argv, deps);
    }
    await call("DELETE", "/api/services/docling");
    const everything = [...bodies, ...out, ...h.logs].join("\n");
    expect(everything.length).toBeGreaterThan(1000);
    expect(everything.split(marker).length - 1).toBe(0);
  });
});

describe("E54 — exec injects SVC_<ID>_<NAME> into the child only", () => {
  it("the child sees it (hash match); argv and the parent env do not", async () => {
    const value = `SVCTEST-${randomBytes(8).toString("hex")}`;
    writeDefinitions(root, [obsDef()]);
    await new SecretsStore(secretsFile()).set("obs", "password", value);
    const driver = new FakeDriver("external");
    const { manager } = makeManager(root, { drivers: { external: driver } });
    const app = await buildApp(manager);
    apps.push(app);
    const outFile = path.join(root, "child.txt");
    const script = `require('fs').writeFileSync(${JSON.stringify(outFile)}, require('crypto').createHash('sha256').update(process.env.SVC_OBS_PASSWORD||'').digest('hex') + '\\n' + process.argv.join(' '))`;
    const argv = ["exec", "obs", "--", process.execPath, "-e", script];
    const code = await cmdService(argv, {
      port: 1,
      fetch: injectFetch(() => app),
      resolveExecSecrets: localExecSecretsResolver({ paths: servicesPaths(root), run: recordingRunner().run, resolveBinary: () => null }),
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(0);
    const [hash, childArgv] = fs.readFileSync(outFile, "utf8").split("\n");
    expect(hash).toBe(createHash("sha256").update(value).digest("hex"));
    expect(childArgv).not.toContain(value);
    expect(argv.join(" ")).not.toContain(value);
    expect(process.env.SVC_OBS_PASSWORD).toBeUndefined();
  });
});
