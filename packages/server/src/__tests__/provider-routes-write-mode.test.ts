/**
 * `providers.json` holds API keys, so it must never be published
 * world-readable.
 *
 * Both write paths use tmp+rename. `renameSync` replaces the DESTINATION with
 * the temporary file's inode, so the destination's old mode is NOT preserved —
 * the tmp file's mode becomes the live file's mode. Creating the tmp without an
 * explicit mode therefore hands the credential file whatever the process umask
 * allows (0644 under a permissive umask), which is readable by any other local
 * account able to traverse `~/.pi/agent`.
 *
 * This mirrors the contract `auth.json` already enforces
 * (provider-auth-storage.ts, change: fix-corrupt-auth-json-500), including its
 * non-obvious second half: `writeFileSync`'s `mode` applies only at CREATION,
 * so a tmp surviving a crashed earlier write would keep its old mode through
 * the rename. An explicit `chmodSync` closes that.
 *
 * See change: redesign-providers-settings-page.
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const PROVIDERS_PATH = join(PROVIDERS_DIR, "providers.json");

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
});

async function buildApp() {
  const app = Fastify({ logger: false });
  registerProviderRoutes(app, { networkGuard: async () => {}, port: 8000 });
  await app.ready();
  return app;
}

function mode(): number {
  return statSync(PROVIDERS_PATH).mode & 0o777;
}

describe("providers.json write mode — the file stores API keys", () => {
  it("PATCH leaves the file owner-only (0600), not group/world readable", async () => {
    writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers: {} }), { mode: 0o644 });
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://b.example.com/v1", apiKey: "sk-secret" }),
    });

    expect(res.statusCode).toBe(200);
    // The credential really is in there — otherwise the mode assertion is vacuous.
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toContain("sk-secret");
    expect(mode() & 0o077, `providers.json is ${mode().toString(8)}; group/world bits must be clear`).toBe(0);
    expect(mode()).toBe(0o600);
    await app.close();
  });

  it("PUT leaves the file owner-only (0600)", async () => {
    writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers: {} }), { mode: 0o644 });
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { vllm: { baseUrl: "https://b.example.com/v1", apiKey: "sk-secret" } },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toContain("sk-secret");
    expect(mode() & 0o077).toBe(0);
    expect(mode()).toBe(0o600);
    await app.close();
  });

  it("DELETE leaves the file owner-only (0600)", async () => {
    writeFileSync(
      PROVIDERS_PATH,
      JSON.stringify({ providers: { vllm: { baseUrl: "https://a.example.com/v1", apiKey: "sk-secret" } } }),
      { mode: 0o644 },
    );
    const app = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/vllm" });

    expect(res.statusCode).toBe(200);
    expect(mode() & 0o077).toBe(0);
    expect(mode()).toBe(0o600);
    await app.close();
  });
});
