import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CertFiles } from "../../../cert-files.js";
import { CertManager } from "../../../cert-manager.js";
import { TlsCertStore } from "../../../cert-store.js";
import { AcmeCertSource } from "../acme-source.js";
import { redactSecrets } from "../credentials.js";
import { resolveAcmeE2eOverrides } from "../e2e-overrides.js";
import { normalizeAcmeEntry } from "../entry.js";
import { baseEntry, FakeClient, FakeDns, fastCrypto, KEY_AUTH, setConfiguredEntries, setupEnv, type TestEnv } from "./acme-source-helpers.js";

/**
 * Redaction of the DNS-provider token and the E2E override host guard.
 * See change: add-acme-dns01-certs (test-plan X7, X8; tasks 6.37, 6.38).
 */

vi.mock("../accounts.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../accounts.js")>();
  return { ...orig, loadOrCreateAccountKey: async () => ({ hash: "0".repeat(32), keyPem: "test-account-key" }) };
});

// A token with characters that need JSON escaping and percent-encoding of unreserved characters.
const TOKEN = 'cf-tok"en\\back.slash_0123~456789';

/** Percent-encode every byte except ASCII letters/digits: `-` → `%2D`, `.` → `%2E`, `_` → `%5F`, `~` → `%7E`. */
const fullEncode = (s: string): string => [...Buffer.from(s)].map((b) => (/[A-Za-z0-9]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("");

const FORMS: Array<[string, string]> = [
  ["raw", TOKEN],
  ["%2D upper-case escapes", fullEncode(TOKEN)],
  ["%2d lower-case escapes", fullEncode(TOKEN).toLowerCase()],
  ["double-encoded", encodeURIComponent(fullEncode(TOKEN))],
  ["encodeURIComponent", encodeURIComponent(TOKEN)],
  ["JSON-escaped", JSON.stringify(TOKEN).slice(1, -1)],
  ["base64", Buffer.from(TOKEN).toString("base64")],
  ["base64url", Buffer.from(TOKEN).toString("base64url")],
];

describe("X7 redaction (6.37)", () => {
  it.each(FORMS)("X7: redactSecrets removes the %s form", (_name, form) => {
    expect(redactSecrets(`provider said: ${form} (end)`, [TOKEN])).toBe("provider said: [redacted] (end)");
  });

  describe("end to end", () => {
    let env: TestEnv;
    let mgr: CertManager;
    const managerLog = { info: vi.fn(), warn: vi.fn() };
    const captured: string[] = [];
    const savedDebug = process.env.DEBUG;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      env = setupEnv();
      fastCrypto("dash.example.com");
      captured.length = 0;
      managerLog.info.mockClear();
      managerLog.warn.mockClear();
      for (const m of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void captured.push(a.map(String).join(" ")));
      }
      vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        captured.push(String(chunk));
        return true;
      }) as never);
      process.env.DEBUG = "acme-client";
      env.creds.set("home", "cloudflareToken", TOKEN);
      mgr = new CertManager({ files: new CertFiles(path.join(env.root, "certs")), store: new TlsCertStore(), log: managerLog });
    });
    afterEach(() => {
      mgr.suspend();
      if (savedDebug === undefined) delete process.env.DEBUG;
      else process.env.DEBUG = savedDebug;
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
      env.cleanup();
    });

    it("X7: the token never reaches logs, lastError or status, in any encoding; no request body is logged", async () => {
      const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith("/user/tokens/verify")) return json(200, { success: true, result: { status: "active" } });
          if ((init?.method ?? "GET") === "POST") {
            // a hostile/echoing provider: the token comes back in every encoding, plus the auth header
            return json(500, {
              success: false,
              errors: [...FORMS.map(([name, form]) => ({ message: `echo[${name}] ${form}` })), { message: `Authorization: Bearer ${TOKEN}` }],
            });
          }
          return json(200, { success: true, result: {} });
        }),
      );
      const entry = baseEntry({ solver: { type: "cloudflare", zoneId: "a".repeat(32) } });
      const client = new FakeClient();
      const source = new AcmeCertSource({ id: "home", entry: normalizeAcmeEntry(entry), clientFactory: () => client, dns: new FakeDns() });
      setConfiguredEntries(env, [entry]);
      await mgr.reconcile([source]);
      await mgr.settle();

      const status = JSON.stringify(mgr.status());
      const readiness = JSON.stringify(await source.readiness({ force: true }));
      const row = mgr.status().certs[0];
      expect(row.lastError).toMatch(/HTTP 500/);
      expect(row.lastError).toContain("[redacted]");

      const everything = [status, readiness, ...env.logLines, ...managerLog.info.mock.calls.flat(), ...managerLog.warn.mock.calls.flat(), ...captured].join("\n");
      expect(everything).toContain("obtain failed"); // the failure was logged, so the scan is not vacuous
      for (const [name, form] of FORMS) expect(everything, `form leaked: ${name}`).not.toContain(form);
      // no request body (the TXT record content / challenge value) in any log line
      expect(everything).not.toContain(KEY_AUTH);
      expect(everything).not.toMatch(/"content"\s*:/);
    });
  });
});

describe("X8 E2E override host guard (6.38)", () => {
  const CF = "https://api.cloudflare.com/client/v4";
  const run = (vars: Record<string, string>) => {
    const log = { warn: vi.fn() };
    const out = resolveAcmeE2eOverrides(vars as NodeJS.ProcessEnv, log);
    return { out, log };
  };

  it.each(["http://evil.example", "http://nas", "http://cf-shim.test@evil.example", "http://cf-shim.test.evil.example", "http://localhost.evil.example", "http://[::1]:8080", "ftp://cf-shim.test", "not a url"])(
    "X8: PI_E2E_CLOUDFLARE_API=%s is refused with a log line",
    (url) => {
      const { out, log } = run({ PI_E2E_SEED: "1", PI_E2E_CLOUDFLARE_API: url });
      expect(out.cloudflareApiBase).toBe(CF);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(String(log.warn.mock.calls[0][0])).toMatch(/PI_E2E_CLOUDFLARE_API refused/);
    },
  );

  it.each(["http://cf-shim.test", "http://cf-shim.test:8081/v4/", "http://localhost:9000", "https://api.cf.test"])("X8: %s is accepted", (url) => {
    const { out, log } = run({ PI_E2E_SEED: "1", PI_E2E_CLOUDFLARE_API: url });
    expect(out.cloudflareApiBase).toBe(url.replace(/\/+$/, ""));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("X8: without PI_E2E_SEED=1 both overrides are ignored, silently", () => {
    for (const seed of [undefined, "0", "true", ""]) {
      const { out, log } = run({ ...(seed === undefined ? {} : { PI_E2E_SEED: seed }), PI_E2E_CLOUDFLARE_API: "http://cf-shim.test", PI_E2E_DNS_AUTHORITATIVE: "challtestsrv.test:8053" });
      expect(out).toEqual({ cloudflareApiBase: CF });
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it("X8: PI_E2E_DNS_AUTHORITATIVE needs host:port with localhost or a .test host", () => {
    expect(run({ PI_E2E_SEED: "1", PI_E2E_DNS_AUTHORITATIVE: "challtestsrv.test:8053" }).out.authoritativeOverride).toEqual({ host: "challtestsrv.test", port: 8053 });
    expect(run({ PI_E2E_SEED: "1", PI_E2E_DNS_AUTHORITATIVE: "localhost:53" }).out.authoritativeOverride).toEqual({ host: "localhost", port: 53 });
    for (const bad of ["evil.example:53", "nas:53", "challtestsrv.test", "challtestsrv.test:0", "challtestsrv.test:70000", "10.0.0.5:53"]) {
      const { out, log } = run({ PI_E2E_SEED: "1", PI_E2E_DNS_AUTHORITATIVE: bad });
      expect(out.authoritativeOverride, bad).toBeUndefined();
      expect(log.warn, bad).toHaveBeenCalledTimes(1);
    }
  });

  describe("through publish", () => {
    let env: TestEnv;
    beforeEach(() => {
      env = setupEnv();
      env.creds.set("home", "cloudflareToken", "cf-token-0123456789abcdef");
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      env.cleanup();
    });

    async function publishHost(vars: Record<string, string>): Promise<string[]> {
      Object.assign(env.env, vars);
      const hosts: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          hosts.push(new URL(String(input)).host);
          return new Response(JSON.stringify({ success: true, result: { id: "r1" } }), { status: 200 });
        }),
      );
      const entry = normalizeAcmeEntry(baseEntry({ solver: { type: "cloudflare", zoneId: "a".repeat(32) } }));
      const source = new AcmeCertSource({ id: "home", entry, clientFactory: () => new FakeClient(), dns: new FakeDns() });
      await source.obtain("dash.example.com", () => undefined);
      return hosts;
    }

    it("X8: http://evil.example and http://nas → the request goes to api.cloudflare.com, with a log line", async () => {
      for (const evil of ["http://evil.example", "http://nas"]) {
        env.logLines.length = 0;
        expect(await publishHost({ PI_E2E_SEED: "1", PI_E2E_CLOUDFLARE_API: evil })).toEqual(["api.cloudflare.com", "api.cloudflare.com"]);
        expect(env.logLines.join("\n")).toMatch(/PI_E2E_CLOUDFLARE_API refused/);
      }
    });

    it("X8: http://cf-shim.test is used; without the seed it is ignored", async () => {
      expect(await publishHost({ PI_E2E_SEED: "1", PI_E2E_CLOUDFLARE_API: "http://cf-shim.test" })).toEqual(["cf-shim.test", "cf-shim.test"]);
      delete env.env.PI_E2E_SEED;
      expect(await publishHost({ PI_E2E_CLOUDFLARE_API: "http://cf-shim.test" })).toEqual(["api.cloudflare.com", "api.cloudflare.com"]);
    });
  });
});
