import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  parseModuleNotFoundError,
  isModuleNotFoundError,
  detectInstallLayout,
  detectPackageManager,
  suggestedReinstallCommand,
  buildRecoveryHtml,
  startRecoveryServer,
} from "../lifecycle/recovery-server.js";

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

  // A pnpm-only repo (nodeLinker: hoisted) MUST NOT be `npm install`ed — npm
  // drifts the tree (nested wrong-version deps) and breaks pi at startup.
  // See change: recovery-server-respect-package-manager.
  it("suggests pnpm for a monorepo whose root declares pnpm", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rec-pnpm-"));
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const cli = path.join(root, "packages", "server", "src", "cli.ts");
    // NB: "pnpm install" contains "npm install" — assert on the prefix, not absence.
    expect(suggestedReinstallCommand("monorepo", cli).startsWith("pnpm install")).toBe(true);
  });

  it("still suggests npm for a monorepo without pnpm markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rec-npm-"));
    const cli = path.join(root, "packages", "server", "src", "cli.ts");
    expect(suggestedReinstallCommand("monorepo", cli).startsWith("npm install")).toBe(true);
  });
});

describe("detectPackageManager", () => {
  it("detects pnpm from pnpm-workspace.yaml", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ws-"));
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
    expect(detectPackageManager(root)).toBe("pnpm");
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lock-"));
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    expect(detectPackageManager(root)).toBe("pnpm");
  });

  it("falls back to npm when no pnpm markers exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-none-"));
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    expect(detectPackageManager(root)).toBe("npm");
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

// Bind port:0 (OS assigns atomically — no probe/rebind TOCTOU under parallel
// forks) and use the resolved bound port to talk to the live HTTP server.
async function withRecoveryServer<T>(
  fn: (port: number) => Promise<T>,
): Promise<T> {
  // Capture & swallow noisy console.error during the test
  const origErr = console.error;
  console.error = () => {};

  // startRecoveryServer resolves once `listen` succeeds, returning the bound
  // port (server keeps running on its own).
  const port = await startRecoveryServer({
    port: 0,
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
