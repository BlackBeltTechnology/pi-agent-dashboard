import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  parseModuleNotFoundError,
  isModuleNotFoundError,
  detectInstallLayout,
  suggestedReinstallCommand,
  buildRecoveryHtml,
  startRecoveryServer,
} from "../recovery-server.js";

describe("parseModuleNotFoundError", () => {
  it("extracts a bare-module name from ERR_MODULE_NOT_FOUND", () => {
    const e = Object.assign(new Error("Cannot find module 'fastify'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(parseModuleNotFoundError(e)).toBe("fastify");
  });

  it("extracts an absolute path from ERR_MODULE_NOT_FOUND", () => {
    const e = Object.assign(
      new Error("Cannot find module '/abs/path/foo.cjs' imported from /bar"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    expect(parseModuleNotFoundError(e)).toBe("/abs/path/foo.cjs");
  });

  it("handles 'Cannot find package' phrasing", () => {
    const e = Object.assign(new Error("Cannot find package 'toad-cache'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(parseModuleNotFoundError(e)).toBe("toad-cache");
  });

  it("handles legacy MODULE_NOT_FOUND", () => {
    const e = Object.assign(new Error("Cannot find module 'foo'"), {
      code: "MODULE_NOT_FOUND",
    });
    expect(parseModuleNotFoundError(e)).toBe("foo");
  });

  it("returns null for non-module errors", () => {
    expect(parseModuleNotFoundError(new Error("nope"))).toBeNull();
    expect(parseModuleNotFoundError(null)).toBeNull();
    expect(parseModuleNotFoundError(undefined)).toBeNull();
  });
});

describe("isModuleNotFoundError", () => {
  it("recognizes ERR_MODULE_NOT_FOUND", () => {
    const e = Object.assign(new Error("Cannot find module 'x'"), { code: "ERR_MODULE_NOT_FOUND" });
    expect(isModuleNotFoundError(e)).toBe(true);
  });

  it("recognizes phrase-only matches (no code)", () => {
    expect(isModuleNotFoundError(new Error("Cannot find module 'x'"))).toBe(true);
    expect(isModuleNotFoundError(new Error("Cannot find package 'x'"))).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isModuleNotFoundError(new Error("EADDRINUSE"))).toBe(false);
    expect(isModuleNotFoundError(null)).toBe(false);
  });
});

describe("detectInstallLayout", () => {
  it("detects npm-global layout", () => {
    expect(
      detectInstallLayout("/usr/local/lib/node_modules/@blackbelt-technology/pi-agent-dashboard/packages/server/src/cli.ts"),
    ).toBe("npm-global");
  });

  it("detects monorepo layout", () => {
    expect(detectInstallLayout("/Users/x/repo/packages/server/src/cli.ts")).toBe("monorepo");
  });

  it("returns unknown for unrecognized paths", () => {
    expect(detectInstallLayout("/tmp/foo.js")).toBe("unknown");
  });
});

describe("suggestedReinstallCommand", () => {
  it("returns npm -g for npm-global", () => {
    expect(suggestedReinstallCommand("npm-global")).toMatch(/npm install -g/);
  });
  it("returns repo-root install for monorepo", () => {
    expect(suggestedReinstallCommand("monorepo")).toMatch(/repo root/);
  });
});

describe("buildRecoveryHtml", () => {
  it("includes the missing-module identifier and error stack", () => {
    const html = buildRecoveryHtml({
      port: 8000,
      error: Object.assign(new Error("Cannot find module 'fastify'"), { stack: "STACK_TRACE_HERE" }),
      missingModule: "fastify",
      suggestedFix: "npm install -g foo",
    });
    expect(html).toContain("fastify");
    expect(html).toContain("STACK_TRACE_HERE");
    expect(html).toContain("npm install -g foo");
    expect(html).toContain("Recovery Mode");
  });

  it("escapes HTML in error messages to prevent XSS", () => {
    const html = buildRecoveryHtml({
      port: 8000,
      error: new Error("<script>alert('x')</script>"),
      missingModule: "<img onerror=1>",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("handles missing optional fields gracefully", () => {
    const html = buildRecoveryHtml({
      port: 8000,
      error: new Error("oops"),
    });
    expect(html).toContain("(unknown)");
  });
});

// Pick an ephemeral port (0 → OS assigns) and verify the live HTTP server.
async function withRecoveryServer<T>(
  fn: (port: number) => Promise<T>,
): Promise<T> {
  // Probe an open port via a throwaway server.
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, () => r()));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));

  // Capture & swallow noisy console.error during the test
  const origErr = console.error;
  console.error = () => {};

  // Start in the background — startRecoveryServer resolves once `listen`
  // succeeds (server keeps running on its own).
  await startRecoveryServer({
    port,
    error: new Error("Cannot find module 'fastify'"),
    missingModule: "fastify",
  });

  try {
    return await fn(port);
  } finally {
    console.error = origErr;
    // No clean shutdown API — the test will leak the server until vitest
    // tears the worker down. Acceptable for unit tests.
  }
}

async function fetchText(url: string): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: res.headers["content-type"] ?? "",
          }),
        );
      })
      .on("error", reject);
  });
}

describe("startRecoveryServer (integration)", () => {
  it("serves the recovery HTML at /", async () => {
    await withRecoveryServer(async (port) => {
      const res = await fetchText(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(res.contentType).toMatch(/text\/html/);
      expect(res.body).toContain("Recovery Mode");
      expect(res.body).toContain("fastify");
    });
  });

  it("returns recovery-mode JSON at /api/health", async () => {
    await withRecoveryServer(async (port) => {
      const res = await fetchText(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(false);
      expect(parsed.mode).toBe("recovery");
      expect(parsed.missingModule).toBe("fastify");
    });
  });

  it("falls through to recovery HTML for unknown routes", async () => {
    await withRecoveryServer(async (port) => {
      const res = await fetchText(`http://127.0.0.1:${port}/some/unknown/path`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("Recovery Mode");
    });
  });
});
