/**
 * Live-server SSRF-guard validation. See change: improve-content-editor (§6).
 */
import { describe, expect, it } from "vitest";
import { isLoopbackUrl, liveServerPath, validateLiveTarget } from "../live-server.js";

describe("isLoopbackUrl — UX router classifier", () => {
  it("returns true for http(s) loopback URLs", () => {
    for (const href of [
      "http://localhost:5173/x",
      "http://127.0.0.1:80",
      "https://localhost/x",
      "http://[::1]:3000",
      "http://LOCALHOST:5173/",
    ]) {
      expect(isLoopbackUrl(href), href).toBe(true);
    }
  });

  it("returns false for spoofing vectors, non-http(s), and non-loopback", () => {
    for (const href of [
      "http://localhost@evil.com/",
      "http://evil.com/localhost",
      "http://0.0.0.0:3000",
      "ftp://localhost/",
      "javascript:alert(1)",
      "",
      "http://192.168.1.5/",
      "http://localhost.evil.com/",
      "http://localhost./", // trailing-dot host
      "http://[::ffff:127.0.0.1]/", // IPv4-mapped IPv6
      "http://127.0.0.1.evil.com/", // suffix trick
      "http://l\u041ecalhost/", // cyrillic-O unicode spoof → punycode
    ]) {
      expect(isLoopbackUrl(href), href).toBe(false);
    }
  });
});

describe("validateLiveTarget — SSRF boundary", () => {
  it("accepts loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "LOCALHOST", " 127.0.0.1 "]) {
      const r = validateLiveTarget({ host, port: 5173 });
      expect(r.ok, host).toBe(true);
    }
  });

  it("rejects cloud-metadata + remote + private hosts (SSRF)", () => {
    for (const host of ["169.254.169.254", "10.0.0.5", "192.168.1.2", "example.com", "0.0.0.0", "::"]) {
      const r = validateLiveTarget({ host, port: 80 });
      expect(r.ok, host).toBe(false);
    }
  });

  it("rejects out-of-range / non-integer ports", () => {
    for (const port of [0, -1, 65536, 3.5, Number.NaN]) {
      expect(validateLiveTarget({ host: "localhost", port }).ok).toBe(false);
    }
  });

  it("defaults the label to host:port when absent", () => {
    const r = validateLiveTarget({ host: "localhost", port: 5173 });
    expect(r.ok && r.label).toBe("localhost:5173");
  });

  it("rejects non-object input without throwing (hand-edited allowlist)", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      expect(validateLiveTarget(bad as unknown).ok, String(bad)).toBe(false);
    }
  });

  it("liveServerPath builds the proxied path", () => {
    expect(liveServerPath("abc")).toBe("/live/abc/");
  });
});

// ---------------------------------------------------------------------------
// Static-target helpers. See change: improve-canvas-html-and-url-ux.
// ---------------------------------------------------------------------------
import { isCredentialName, isStaticWebAsset, resolveStaticRoot, validateAddressPath } from "../live-server.js";

describe("resolveStaticRoot (E1)", () => {
  const markers = new Set(["/p/m/a", "/p"]);
  const has = (d: string) => markers.has(d);
  it("resolves per the capped-ancestor rule", () => {
    expect(resolveStaticRoot("/p", "/p/m/a/index.html", has)).toBe("/p/m/a");
    expect(resolveStaticRoot("/p", "/p/m/a/s/b.html", has)).toBe("/p/m/a");
    expect(resolveStaticRoot("/p", "/p/d/r/report.html", (d) => d === "/p/zzz")).toBe("/p/d/r");
    expect(resolveStaticRoot("/p", "/p/index.html", has)).toBe("/p");
    expect(resolveStaticRoot("/p", "/shared/out/x.html", () => true)).toBe("/shared/out");
  });
  it("never searches above cwd and has no whole-cwd fallback", () => {
    // A marker above cwd is ignored; no marker inside → file's own directory.
    expect(resolveStaticRoot("/p/q", "/p/q/d/x.html", (d) => d === "/p")).toBe("/p/q/d");
  });
  it("does not treat a sibling-prefix directory as inside cwd", () => {
    expect(resolveStaticRoot("/p", "/p2/x/y.html", () => true)).toBe("/p2/x");
  });
});

describe("validateAddressPath (E2)", () => {
  it("empty and slash map to the root", () => {
    expect(validateAddressPath("")).toEqual({ ok: true, path: "" });
    expect(validateAddressPath("/")).toEqual({ ok: true, path: "" });
  });
  it("accepts a trailing slash, keeps query and fragment, encodes segments", () => {
    expect(validateAddressPath("screens/")).toEqual({ ok: true, path: "screens/" });
    expect(validateAddressPath("x?y=1#z")).toEqual({ ok: true, path: "x?y=1#z" });
    expect(validateAddressPath("ä ö.html")).toEqual({ ok: true, path: "%C3%A4%20%C3%B6.html" });
  });
  it.each(["a//b", ".", "..", "a/../b", "a\\b", "a%00b", "%2e%2e/x", "a/%2e%2e/b", "a%2fb"])(
    "rejects %j",
    (p) => {
      expect(validateAddressPath(p).ok).toBe(false);
    },
  );
});

describe("credential-name matcher + web allowlist (E10)", () => {
  it.each([
    "server.pem", "id_rsa.pub", "auth.json", "service-account-prod.json",
    "api-token.json", "db-password.txt", "private-notes.json", "prod.tfstate.backup",
  ])("denies %s", (n) => expect(isCredentialName(n)).toBe(true));
  it.each(["style.css", "logo.svg"])("allows %s", (n) => expect(isCredentialName(n)).toBe(false));
  it("allowlist excludes maps and txt", () => {
    expect(isStaticWebAsset("a.css")).toBe(true);
    expect(isStaticWebAsset("a.JS")).toBe(true);
    expect(isStaticWebAsset("a.js.map")).toBe(false);
    expect(isStaticWebAsset("a.txt")).toBe(false);
    expect(isStaticWebAsset("noext")).toBe(false);
  });
});
