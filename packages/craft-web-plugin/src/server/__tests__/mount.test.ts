/**
 * E16 / E17 — the `/apps/craft-wordcraft/` mount through the REAL `registerPlugin` + `mountApp`:
 * a static GET never provisions (503, no outbound request) and the CSP is computed per request from the
 * forwarded-aware public origin. Also the validator registration with the live enable switch (E3).
 * See change: edit-office-in-pane-with-craft-web (D3, tasks 4.2, 4.4).
 */
import fs from "node:fs";
import path from "node:path";
import { clearAppMountRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAFT_APP_PROFILES } from "../../shared/app-profiles.js";
import { buildCsp, publicOrigin } from "../csp.js";
import registerPlugin, { VALIDATOR_MODULE } from "../index.js";
import { cleanupTmp, type FakeHost, makeHost, writeTrunkBuild } from "./helpers.js";

afterEach(async () => {
  vi.unstubAllGlobals();
  cleanupTmp();
  clearAppMountRegistry();
});

async function boot(o: Parameters<typeof makeHost>[0] = {}): Promise<FakeHost> {
  const host = makeHost(o);
  await registerPlugin(host.ctx);
  await host.fastify.ready();
  return host;
}

/** A prepared tree behind `current` (what `provisionWeb` leaves). */
function prepare(host: FakeHost): void {
  const root = path.join(host.dataDir, "wordcraft-web");
  writeTrunkBuild(path.join(root, "0.8.0-s1"));
  fs.symlinkSync("0.8.0-s1", path.join(root, "current"));
}

const directive = (csp: string, name: string): string => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("craft-web mount (E16, E17)", () => {
  it("E16: an anonymous GET of an unprepared build answers 503 and makes no outbound request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const host = await boot();
    const res = await host.fastify.inject({ method: "GET", url: "/apps/craft-wordcraft/index.html" });
    expect(res.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    await host.fastify.close();
  });

  it("E17: the CSP names the per-request public origin and the mount base only", async () => {
    const host = await boot();
    prepare(host);
    const seen: string[] = [];
    for (const forwarded of ["a.example", "b.example"]) {
      const res = await host.fastify.inject({
        method: "GET",
        url: "/apps/craft-wordcraft/",
        headers: { "x-forwarded-host": forwarded, "x-forwarded-proto": "https", host: "127.0.0.1:8000" },
      });
      expect(res.statusCode).toBe(200);
      const csp = String(res.headers["content-security-policy"]);
      const base = `https://${forwarded}/apps/craft-wordcraft/`;
      expect(directive(csp, "script-src")).toBe(`script-src ${base} 'wasm-unsafe-eval'`);
      expect(directive(csp, "connect-src")).toBe(`connect-src ${base} blob:`);
      expect(csp).not.toContain("sha256-");
      for (const d of ["script-src", "connect-src", "default-src", "style-src", "img-src", "font-src", "worker-src"]) {
        expect(directive(csp, d)).not.toContain("'self'");
      }
      expect(directive(csp, "default-src")).toBe("default-src 'none'");
      expect(directive(csp, "form-action")).toBe("form-action 'none'");
      expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      seen.push(csp);
    }
    expect(seen[0]).not.toBe(seen[1]);
    await host.fastify.close();
  });

  it("falls back to the Host header and http without forwarding headers", async () => {
    const host = await boot();
    prepare(host);
    const res = await host.fastify.inject({ method: "GET", url: "/apps/craft-wordcraft/", headers: { host: "localhost:8000" } });
    expect(directive(String(res.headers["content-security-policy"]), "script-src")).toBe(
      "script-src http://localhost:8000/apps/craft-wordcraft/ 'wasm-unsafe-eval'",
    );
    await host.fastify.close();
  });

  it("serves a .wasm with application/wasm and prefers a gzip sibling", async () => {
    const host = await boot();
    prepare(host);
    const dir = path.join(host.dataDir, "wordcraft-web", "0.8.0-s1");
    fs.writeFileSync(path.join(dir, "wordcraft-1a2b3c_bg.wasm.gz"), Buffer.from([0x1f, 0x8b, 8, 0]));
    const res = await host.fastify.inject({
      method: "GET",
      url: "/apps/craft-wordcraft/wordcraft-1a2b3c_bg.wasm",
      headers: { "accept-encoding": "gzip", host: "localhost:8000" },
    });
    expect(res.headers["content-type"]).toBe("application/wasm");
    expect(res.headers["content-encoding"]).toBe("gzip");
    await host.fastify.close();
  });
});

describe("craft-web validator registration (E3)", () => {
  it("registers the dispatcher once per EDIT claim (claim id), whose enabled() follows the app's live config", async () => {
    const host = await boot();
    const regs = host.registerFileValidator.mock.calls.map((c) => c[0] as { claimId: string; module: string });
    const editClaims = CRAFT_APP_PROFILES.flatMap((p) => p.claims.filter((c) => c.mode === "edit").map((c) => c.id));
    expect(regs.map((r) => r.claimId).sort()).toEqual([...editClaims].sort());
    for (const r of regs) expect(r.module).toBe(VALIDATOR_MODULE);
    const reg = host.registerFileValidator.mock.calls[0][0] as { claimId: string; module: string; enabled: () => boolean };
    expect(reg.claimId).toBe("wordcraft");
    expect(reg.module).toBe(VALIDATOR_MODULE);
    expect(reg.enabled()).toBe(true);
    host.config.apps = { wordcraft: { enabled: false } };
    expect(reg.enabled()).toBe(false);
    host.config.apps = { wordcraft: { enabled: true } };
    expect(reg.enabled()).toBe(true);
    await host.fastify.close();
  });

  it("the validator module path exists in the package", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../../..", VALIDATOR_MODULE))).toBe(true);
  });
});

describe("csp helpers", () => {
  it("publicOrigin takes the first forwarded token, validates the host, and defaults to http", () => {
    expect(publicOrigin({ "x-forwarded-host": "t.example, proxy", "x-forwarded-proto": "https, http", host: "h" })).toBe("https://t.example");
    expect(publicOrigin({ host: "localhost:8000" })).toBe("http://localhost:8000");
    expect(publicOrigin({ host: "[::1]:8000" })).toBe("http://[::1]:8000");
    expect(publicOrigin({ host: "h.example", "x-forwarded-proto": "javascript" })).toBe("http://h.example");
  });

  it("publicOrigin refuses a host that could break out of a header value", () => {
    expect(() => publicOrigin({ host: "a.example; script-src *" })).toThrow();
    expect(() => publicOrigin({ host: "a.example/evil" })).toThrow();
    expect(() => publicOrigin({})).toThrow();
  });

  it("buildCsp has the exact D3 directive set", () => {
    expect(buildCsp("https://x.example", "wordcraft")).toBe(
      [
        "default-src 'none'",
        "script-src https://x.example/apps/craft-wordcraft/ 'wasm-unsafe-eval'",
        "style-src 'unsafe-inline'",
        "img-src blob: data:",
        "font-src blob: data:",
        "worker-src blob:",
        "connect-src https://x.example/apps/craft-wordcraft/ blob:",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
    );
  });
});

describe("PhotoCraft split-wasm assets (extend-craft-web-to-all-apps)", () => {
  it("passes the profile's extraAssetTypes to serveApp for PhotoCraft only", async () => {
    const host = await boot();
    const calls = host.serveApp.mock.calls.map((c) => c[0] as { appId: string; extraTypes?: Record<string, string> });
    expect(calls.find((c) => c.appId === "craft-photocraft")?.extraTypes).toEqual({ ".txt": "text/plain; charset=utf-8", ".part-aa": "application/octet-stream" });
    expect(calls.find((c) => c.appId === "craft-wordcraft")?.extraTypes).toBeUndefined();
    await host.fastify.close();
  });
});
