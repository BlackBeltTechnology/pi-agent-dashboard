/**
 * A corrupt `providers.json` must never be silently rebuilt.
 *
 * The file holds `roles` / `rolePresets` / `activePreset` alongside `providers`
 * (role-manager.ts). Every write path previously parsed with a bare
 * `catch { /* start fresh *\/ }`, so one unparseable file plus one Add/Edit/
 * Delete left the operator's whole role configuration gone with no recoverable
 * bytes — the exact invariant D3 calls the highest-consequence one.
 *
 * This mirrors `auth.json`'s existing contract (change: fix-corrupt-auth-json-500):
 *   - READ tolerates corruption (the GET must not 5xx) and quarantines a
 *     byte-exact copy,
 *   - WRITE refuses, so the bad bytes survive for manual repair.
 *
 * See change: redesign-providers-settings-page (D3).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const PROVIDERS_PATH = join(PROVIDERS_DIR, "providers.json");

/** A truncated file: the realistic corruption shape. */
const CORRUPT_JSON = '{"providers": {"vllm": {"baseUrl": "https://a.example.com/v1", "apiKe';

let backup: string | null = null;
beforeEach(() => {
  try {
    backup = readFileSync(PROVIDERS_PATH, "utf-8");
  } catch {
    backup = null;
  }
  mkdirSync(PROVIDERS_DIR, { recursive: true });
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  // Drop any quarantined copies this test produced.
  for (const f of readdirSync(PROVIDERS_DIR)) {
    if (f.startsWith("providers.json.corrupt-")) rmSync(join(PROVIDERS_DIR, f), { force: true });
  }
});

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  registerProviderRoutes(app, { networkGuard: async () => {}, port });
  await app.ready();
  return app;
}

function writeCorrupt(): void {
  writeFileSync(PROVIDERS_PATH, CORRUPT_JSON);
}

function readBytes(): Buffer {
  return readFileSync(PROVIDERS_PATH);
}

function quarantinedCopies(): string[] {
  return readdirSync(PROVIDERS_DIR).filter((f) => f.startsWith("providers.json.corrupt-"));
}

describe("corrupt providers.json — write refusal + quarantine (D3)", () => {
  it("PATCH refuses with 409, leaves the bytes byte-identical, and quarantines a copy", async () => {
    writeCorrupt();
    const before = readBytes();
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
    });

    expect(res.statusCode).toBe(409);
    expect(readBytes().equals(before), "corrupt bytes must survive the refusal").toBe(true);
    const copies = quarantinedCopies();
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(PROVIDERS_DIR, copies[0]), "utf-8")).toBe(CORRUPT_JSON);
    await app.close();
  });

  it("DELETE refuses with 409 and does not rewrite the file", async () => {
    writeCorrupt();
    const before = readBytes();
    const app = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/vllm" });

    expect(res.statusCode).toBe(409);
    expect(readBytes().equals(before)).toBe(true);
    await app.close();
  });

  it("PUT refuses with 409 — the whole-map write must not 'start fresh' either", async () => {
    writeCorrupt();
    const before = readBytes();
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { vllm: { baseUrl: "https://b.example.com/v1", apiKey: "sk-new" } },
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(readBytes().equals(before)).toBe(true);
    await app.close();
  });

  it("GET still tolerates corruption: 200, empty provider map, no 5xx", async () => {
    writeCorrupt();
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/providers" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; providers: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.providers).toEqual({});
    await app.close();
  });

  it("treats a non-object JSON body (an array) as corrupt, not as an empty config", async () => {
    writeFileSync(PROVIDERS_PATH, '["not", "an", "object"]');
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
    });

    expect(res.statusCode).toBe(409);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe('["not", "an", "object"]');
    await app.close();
  });

  it("quarantines ONCE per distinct corrupt payload (a refused retry does not stack copies)", async () => {
    // A payload no other test in this file uses: the quarantine dedup set is
    // module-scoped (mirrors auth.json), so reusing CORRUPT_JSON here would hit
    // an earlier test's digest and legitimately write nothing.
    const unique = `{"providers": {"dedup": "${"x".repeat(200)}"`;
    writeFileSync(PROVIDERS_PATH, unique);
    const app = await buildApp();
    const patch = () =>
      app.inject({
        method: "PATCH",
        url: "/api/providers/vllm",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
      });

    expect((await patch()).statusCode).toBe(409);
    expect((await patch()).statusCode).toBe(409);
    const copies = quarantinedCopies();
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(PROVIDERS_DIR, copies[0]), "utf-8")).toBe(unique);
    await app.close();
  });

  it("a VALID file still writes normally (the guard is corruption-only)", async () => {
    writeFileSync(
      PROVIDERS_PATH,
      JSON.stringify({
        roles: { coding: { provider: "anthropic" } },
        rolePresets: { p: { coding: "anthropic" } },
        activePreset: "p",
        providers: {},
      }),
    );
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new", api: "openai-completions" }),
    });

    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8"));
    expect(stored.providers.vllm.apiKey).toBe("sk-new");
    // The invariant this whole guard exists to protect.
    expect(stored.roles).toEqual({ coding: { provider: "anthropic" } });
    expect(stored.rolePresets).toEqual({ p: { coding: "anthropic" } });
    expect(stored.activePreset).toBe("p");
    expect(quarantinedCopies()).toHaveLength(0);
    expect(existsSync(PROVIDERS_PATH)).toBe(true);
    await app.close();
  });
});

/**
 * The TOP-LEVEL object check above does not cover the `providers` VALUE.
 * `readProvidersFileDataChecked()` accepted any `providers` and the routes then
 * did `fileData.providers ?? {}`, so:
 *
 *   - `"providers": []`      — an array takes the named property, but
 *     `JSON.stringify` serialises an array POSITIONALLY and drops it. PATCH
 *     answered 200 while persisting nothing: an acknowledged write silently
 *     lost. This is the failure mode that makes this a data-integrity bug
 *     rather than a validation nit.
 *   - `"providers": "str"`   — assigning a property on a string primitive
 *     throws in strict mode, so the route 500s instead of refusing cleanly.
 *
 * Both are corruption in exactly the sense the file already defines, so they
 * take the SAME path: READ tolerates, WRITE refuses 409, bytes survive.
 */
describe("corrupt providers.json — a non-object `providers` value (D3)", () => {
  it("PATCH refuses an ARRAY `providers` instead of reporting a write it did not persist", async () => {
    const payload = '{"roles": {"coding": {"provider": "anthropic"}}, "providers": ["arr-patch"]}';
    writeFileSync(PROVIDERS_PATH, payload);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
    });

    expect(res.statusCode).toBe(409);
    // The decisive assertion: the old code returned 200 here and wrote a file
    // in which `vllm` did not exist.
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(payload);
    await app.close();
  });

  it("PATCH refuses a STRING `providers` with 409 rather than throwing a 500", async () => {
    const payload = '{"providers": "str-patch"}';
    writeFileSync(PROVIDERS_PATH, payload);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
    });

    expect(res.statusCode).toBe(409);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(payload);
    await app.close();
  });

  it("DELETE refuses a non-object `providers`", async () => {
    const payload = '{"providers": ["arr-delete"]}';
    writeFileSync(PROVIDERS_PATH, payload);
    const app = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/vllm" });

    expect(res.statusCode).toBe(409);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(payload);
    await app.close();
  });

  it("PUT refuses a non-object `providers` — it must not silently discard sibling keys", async () => {
    const payload = '{"activePreset": "p", "providers": ["arr-put"]}';
    writeFileSync(PROVIDERS_PATH, payload);
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { vllm: { baseUrl: "https://b.example.com/v1", apiKey: "sk-new" } },
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(payload);
    await app.close();
  });

  it("GET still tolerates it: 200 with an empty map, never a 5xx", async () => {
    writeFileSync(PROVIDERS_PATH, '{"providers": ["arr-get"]}');
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/providers" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; providers: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.providers).toEqual({});
    await app.close();
  });

  it("`providers: null` keeps its established meaning — absent, NOT corrupt", async () => {
    // `?? {}` already treated null as "no providers yet"; tightening the check
    // must not turn a benign shape into a refusal.
    writeFileSync(PROVIDERS_PATH, '{"roles": {"coding": {"provider": "anthropic"}}, "providers": null}');
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-new" }),
    });

    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8"));
    expect(stored.providers.vllm.apiKey).toBe("sk-new");
    expect(stored.roles).toEqual({ coding: { provider: "anthropic" } });
    await app.close();
  });
});
