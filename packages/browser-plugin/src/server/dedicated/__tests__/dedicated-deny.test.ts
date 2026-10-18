/**
 * Dedicated deny set, pure parts (test-plan #E10 classification, #E11 scrubbing,
 * #E7 predicates). See change: add-dedicated-agent-browser (D5).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIFIED_DOMAINS,
  checkOpenUrl,
  classifyMethod,
  DEDICATED_DENIED_METHODS,
  dedicatedDenied,
  isWebUiUrl,
  METHOD_CLASSIFICATION,
  navigationUrlAllowed,
  scrubCookies,
} from "../dedicated-deny.js";

function protocolCommandMethods(): string[] {
  const pkg = createRequire(import.meta.url).resolve("playwright-core/package.json");
  const file = path.join(path.dirname(pkg), "types", "protocol.d.ts");
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("export interface CommandParameters {");
  expect(start, "CommandParameters not found in protocol.d.ts").toBeGreaterThan(-1);
  const end = text.indexOf("\n  export interface", start + 10);
  const block = text.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/^\s+"([A-Za-z]+\.[A-Za-z0-9]+)":/gm)].map((m) => m[1]);
}

describe("#E10 classification table", () => {
  const methods = protocolCommandMethods();
  const scoped = methods.filter((m) => CLASSIFIED_DOMAINS.includes(m.split(".")[0]));

  it("reads a plausible protocol (sanity)", () => {
    expect(methods.length).toBeGreaterThan(500);
    expect(scoped.length).toBeGreaterThan(60);
    expect(scoped).toContain("Target.createTarget");
  });

  it("classifies every Browser./Target./Storage./Tethering./SystemInfo./Extensions. command", () => {
    const unclassified = scoped.filter((m) => !(m in METHOD_CLASSIFICATION));
    expect(unclassified, `classify these in METHOD_CLASSIFICATION: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("lists no method that is absent from the protocol (typo guard)", () => {
    const known = new Set(methods);
    expect(Object.keys(METHOD_CLASSIFICATION).filter((m) => !known.has(m))).toEqual([]);
  });

  it("denies an unknown synthetic method of a classified domain", () => {
    expect(classifyMethod("Target.fooBar")).toBe("denied");
    expect(classifyMethod("Storage.futureMethod")).toBe("denied");
    expect(dedicatedDenied("Target.fooBar", {}, undefined)).toBe("Target.fooBar");
  });

  it("never classifies a spec-denied method as allowed", () => {
    for (const m of DEDICATED_DENIED_METHODS) {
      expect(["denied", "unscoped"], m).toContain(classifyMethod(m));
    }
    const mustDeny = scoped.filter((x) => x.startsWith("Extensions.") || x.startsWith("Tethering.") || x.startsWith("Storage.clearData"));
    expect(mustDeny.length).toBeGreaterThan(8);
    for (const m of mustDeny) expect(classifyMethod(m), m).toBe("denied");
  });

  it("leaves other domains to the generic rules", () => {
    expect(classifyMethod("Runtime.evaluate")).toBe("unscoped");
    expect(dedicatedDenied("Runtime.evaluate", {}, "S1")).toBeNull();
  });
});

describe("URL predicates", () => {
  it("navigationUrlAllowed: https, http, exactly about:blank", () => {
    for (const u of ["https://a.test", "http://a.test/x?y=1", "about:blank"]) expect(navigationUrlAllowed(u), u).toBe(true);
    for (const u of ["about:settings", "about:blank#x", "ABOUT:BLANK2", "chrome://settings", "file:///x", "javascript:1", "data:text/html,x", "blob:https://a/b", "", "   ", "https", undefined, 3]) {
      expect(navigationUrlAllowed(u), String(u)).toBe(false);
    }
  });

  it("isWebUiUrl covers the four privileged schemes", () => {
    for (const u of ["chrome://password-manager", "chrome-untrusted://x", "devtools://devtools/bundled/x.html", "chrome-extension://abc/p.html", "CHROME://settings"]) {
      expect(isWebUiUrl(u), u).toBe(true);
    }
    for (const u of ["https://chrome.test/", "about:blank", "", undefined, "not a url"]) expect(isWebUiUrl(u), String(u)).toBe(false);
  });

  it("checkOpenUrl: https only, effective domains apply", () => {
    expect(checkOpenUrl("https://accounts.google.com/", [])).toEqual({ ok: true });
    for (const u of ["http://a.test/", "javascript:alert(1)", "chrome://settings", "about:blank", "x", 5]) {
      expect(checkOpenUrl(u, []).ok, String(u)).toBe(false);
    }
    expect(checkOpenUrl("https://example.com/", ["github.com"]).ok).toBe(false);
    expect(checkOpenUrl("https://api.github.com/", [".github.com"]).ok).toBe(true);
  });
});

describe("scrubCookies", () => {
  it("is a no-op on null/primitive payloads and keeps unrelated fields", () => {
    expect(() => scrubCookies(null)).not.toThrow();
    const p = { a: 1, headers: { Accept: "x" } };
    scrubCookies(p);
    expect(p).toEqual({ a: 1, headers: { Accept: "x" } });
  });

  it("removes cookie headers case-insensitively and empties cookie arrays", () => {
    const p = {
      headers: { COOKIE: "a=b", "set-cookie": "c=d", Cookie2: "x", "Set-Cookie2": "y", Keep: "1" },
      associatedCookies: [{ cookie: { value: "s" } }],
      cookies: [1],
      exemptedCookies: [2],
    };
    scrubCookies(p);
    expect(p).toEqual({ headers: { Keep: "1" }, associatedCookies: [], cookies: [], exemptedCookies: [] });
  });

  it("scrubs raw header text lines", () => {
    const p = {
      headersText: "HTTP/1.1 200 OK\r\nSet-Cookie: s=1\r\ncookie: x=1\r\nX-A: b\r\n\r\n",
      requestHeadersText: "GET / HTTP/1.1\r\nCookie: z=1\r\nHost: h\r\n\r\n",
    };
    scrubCookies(p);
    expect(p.headersText).not.toMatch(/cookie/i);
    expect(p.headersText).toContain("X-A: b");
    expect(p.requestHeadersText).not.toMatch(/cookie/i);
    expect(p.requestHeadersText).toContain("Host: h");
  });
});
