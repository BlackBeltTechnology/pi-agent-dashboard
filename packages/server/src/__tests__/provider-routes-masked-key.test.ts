/**
 * PUT /api/providers masked-sentinel guard.
 *
 * The masked sentinel `***` means "keep the existing key" — valid ONLY when the
 * named provider already exists in providers.json. When the provider is absent,
 * the merge MUST NOT persist the literal string `***` as the apiKey (which would
 * corrupt the credential). See change: fix-custom-provider-save-and-auth.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");

let backup: string | null = null;
beforeEach(() => {
  try { backup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
});

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard, port });
  await app.ready();
  return app;
}

function readStored(): Record<string, any> {
  return JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8")).providers ?? {};
}

describe("PUT /api/providers masked-sentinel guard", () => {
  it("masked key WITHOUT existing entry is not persisted as '***'", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    const app = await buildApp();

    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { proxy: { baseUrl: "https://api.example.com/v1", apiKey: "***" } },
      }),
    });

    // Either rejected, or stored without the sentinel — never persisted as "***".
    let stored: Record<string, any> = {};
    try { stored = readStored(); } catch { /* file may not exist on reject */ }
    expect(stored.proxy?.apiKey).not.toBe("***");

    await app.close();
  });

  it("masked key WITH existing entry preserves the real key", async () => {
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, JSON.stringify({
      providers: { proxy: { baseUrl: "https://old.example.com/v1", apiKey: "sk-real" } },
    }));
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { proxy: { baseUrl: "https://new.example.com/v1", apiKey: "***" } },
      }),
    });

    expect(res.statusCode).not.toBe(400);
    const stored = readStored();
    expect(stored.proxy.apiKey).toBe("sk-real");
    expect(stored.proxy.baseUrl).toBe("https://new.example.com/v1");

    await app.close();
  });

  it("rejects a blank / whitespace-only provider name with 400 and persists nothing", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { "   ": { baseUrl: "https://api.example.com/v1", apiKey: "sk-real" } },
      }),
    });

    expect(res.statusCode).toBe(400);
    let stored: Record<string, any> = {};
    try { stored = readStored(); } catch { /* file not written on reject */ }
    expect(Object.keys(stored)).toHaveLength(0);

    await app.close();
  });
});
