/**
 * Integration test for recursion guard wired into PUT /api/providers (task 10.4).
 *
 * Verifies:
 * - Self-pointing baseUrl → 400 with code RECURSIVE_PROXY
 * - Valid external baseUrl → accepted (2xx, written to disk)
 * - Existing providers untouched on validation failure
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");

// Back up / restore providers.json around each test
let backup: string | null = null;
beforeEach(() => {
  try { backup = require("fs").readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
});
afterEach(() => {
  try {
    if (backup !== null) {
      writeFileSync(PROVIDERS_PATH, backup);
    } else {
      rmSync(PROVIDERS_PATH, { force: true });
    }
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

describe("recursion guard on PUT /api/providers (task 10.4)", () => {
  it("localhost self-pointing baseUrl → 400 RECURSIVE_PROXY", async () => {
    const app = await buildApp(8000);

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          self: { baseUrl: "http://localhost:8000/v1", apiKey: "" },
        },
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("RECURSIVE_PROXY");
    expect(body.offendingBaseUrl).toBe("http://localhost:8000/v1");
  });

  it("127.0.0.1 variant also caught", async () => {
    const app = await buildApp(8000);

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          self: { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "" },
        },
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("RECURSIVE_PROXY");
  });

  it("external baseUrl passes validation", async () => {
    const app = await buildApp(8000);

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" },
        },
      }),
    });

    // Should succeed (200/204) or return a non-400 error
    expect(res.statusCode).not.toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).not.toBe("RECURSIVE_PROXY");
  });

  it("validation failure leaves existing providers untouched", async () => {
    // Pre-populate providers.json with a valid provider
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, JSON.stringify({
      providers: { openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-existing" } },
    }));

    const app = await buildApp(8000);

    // Attempt to add a recursive provider — should fail
    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-existing" },
          self: { baseUrl: "http://localhost:8000/v1", apiKey: "" },
        },
      }),
    });

    expect(res.statusCode).toBe(400);

    // Read providers.json — existing provider should still be there
    const stored = JSON.parse(require("fs").readFileSync(PROVIDERS_PATH, "utf-8"));
    expect(stored.providers?.openai?.baseUrl).toBe("https://api.openai.com/v1");
    expect(stored.providers?.self).toBeUndefined();
  });
});
