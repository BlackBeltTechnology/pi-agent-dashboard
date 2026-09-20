/**
 * `GET /api/providers` — `$NAME` apiKey resolution annotation (`apiKeyResolved`).
 *
 * A custom endpoint's apiKey may be a `$NAME` reference that the SERVER resolves
 * against its own environment. A browser cannot evaluate that, so the redacted
 * payload carries the resolution state; without it a resolved `$NAME` endpoint
 * is indistinguishable from a dead one and the connected list hides a usable
 * endpoint (and withholds it from the Add picker, which offers unconfigured
 * entries only). See change: redesign-providers-settings-page (D1, E8).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const SET_VAR = "OS_REDESIGN_SET_REF";
const UNSET_VAR = "OS_REDESIGN_UNSET_REF";

let backup: string | null = null;
beforeEach(() => {
  try {
    backup = readFileSync(PROVIDERS_PATH, "utf-8");
  } catch {
    backup = null;
  }
  process.env[SET_VAR] = "sk-resolved";
  delete process.env[UNSET_VAR];
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  delete process.env[SET_VAR];
  delete process.env[UNSET_VAR];
});

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard, port });
  await app.ready();
  return app;
}

function seed(providers: Record<string, unknown>): void {
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers }));
}

async function readRedacted(): Promise<Record<string, any>> {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/api/providers" });
  const body = res.json() as { providers: Record<string, any> };
  await app.close();
  return body.providers;
}

describe("GET /api/providers — $NAME apiKey resolution annotation", () => {
  it("annotates a SET `$NAME` reference as resolved and passes the ref through verbatim", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: `$${SET_VAR}`, api: "openai-completions" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe(`$${SET_VAR}`);
    expect(providers.proxy.apiKeyResolved).toBe(true);
  });

  it("annotates an UNSET `$NAME` reference as unresolved", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: `$${UNSET_VAR}` } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe(`$${UNSET_VAR}`);
    expect(providers.proxy.apiKeyResolved).toBe(false);
  });

  it("annotates an empty variadic `$` reference as unresolved, not as resolved-by-default", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "$" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKeyResolved).toBe(false);
  });

  it("omits the annotation for a literal key (which is redacted, not resolvable)", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "sk-literal" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe("***");
    expect(providers.proxy.apiKeyResolved).toBeUndefined();
  });

  it("omits the annotation for an empty key", async () => {
    seed({ proxy: { baseUrl: "https://a.example.com/v1", apiKey: "" } });
    const providers = await readRedacted();
    expect(providers.proxy.apiKey).toBe("");
    expect(providers.proxy.apiKeyResolved).toBeUndefined();
  });
});
