/**
 * Relay deny-list (change: add-browser-relay) — test-plan #E12 (denied verbs),
 * #E13 (navigate schemes), #E14 (allowedDomains decision table).
 */
import { describe, expect, it } from "vitest";
import {
  ALWAYS_DENIED_METHODS,
  deniedMethod,
  denyError,
  hostAllowed,
} from "../deny-list.js";

describe("always-denied verbs (E12)", () => {
  it("refuses each enumerated verb with -32000 and the policy message", () => {
    for (const method of [
      "Storage.getCookies",
      "Network.getAllCookies",
      "Network.getCookies",
      "Browser.setDownloadBehavior",
    ]) {
      expect(deniedMethod(method, {}, [])).toBe(method);
      expect(denyError(method)).toEqual({
        code: -32000,
        message: `Denied by dashboard relay policy: ${method}`,
      });
    }
    expect(ALWAYS_DENIED_METHODS).toHaveLength(4);
  });

  it("refuses them even when allowedDomains would admit everything", () => {
    expect(deniedMethod("Network.getAllCookies", { url: "https://github.com" }, [])).toBe(
      "Network.getAllCookies",
    );
  });

  it("leaves ordinary automation untouched", () => {
    for (const method of ["Runtime.evaluate", "DOM.getDocument", "Input.dispatchMouseEvent"]) {
      expect(deniedMethod(method, { expression: "1" }, [])).toBeNull();
    }
  });
});

describe("navigation schemes (E13)", () => {
  it("denies file/javascript/data/blob/vbscript on both URL-policy verbs", () => {
    const hostile = [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,x",
      "blob:https://a/b",
      "vbscript:msgbox(1)",
    ];
    for (const verb of ["Page.navigate", "Target.createTarget"]) {
      for (const url of hostile) {
        expect(deniedMethod(verb, { url }, []), `${verb} ${url}`).toBe(verb);
      }
    }
  });

  it("forwards an ordinary https URL verbatim (empty allowlist)", () => {
    expect(deniedMethod("Page.navigate", { url: "https://ok.test" }, [])).toBeNull();
  });

  it("fails closed on a missing or unparseable url", () => {
    expect(deniedMethod("Page.navigate", {}, [])).toBe("Page.navigate");
    expect(deniedMethod("Page.navigate", { url: "not a url" }, [])).toBe("Page.navigate");
    expect(deniedMethod("Target.createTarget", { url: 42 }, [])).toBe("Target.createTarget");
  });
});

describe("allowedDomains decision table (E14)", () => {
  const hosts = ["github.com", "api.github.com", "github.com.evil.io", "GITHUB.COM:443", "about:blank"];

  it('["github.com"] admits the exact host only', () => {
    const list = ["github.com"];
    expect(hostAllowed("github.com", list)).toBe(true);
    // GITHUB.COM:443 → URL.hostname lowercases + strips the port
    expect(hostAllowed(new URL("https://GITHUB.COM:443").hostname, list)).toBe(true);
    expect(hostAllowed("api.github.com", list)).toBe(false);
    expect(hostAllowed("github.com.evil.io", list)).toBe(false);
    expect(hostAllowed("", list)).toBe(false);
    expect(deniedMethod("Page.navigate", { url: "https://github.com" }, list)).toBeNull();
    expect(deniedMethod("Page.navigate", { url: "https://api.github.com" }, list)).toBe("Page.navigate");
    expect(deniedMethod("Page.navigate", { url: "https://example.com" }, list)).toBe("Page.navigate");
  });

  it('[".github.com"] admits the bare host and every subdomain, never a lookalike', () => {
    const list = [".github.com"];
    expect(hostAllowed("github.com", list)).toBe(true);
    expect(hostAllowed("api.github.com", list)).toBe(true);
    expect(hostAllowed("github.com.evil.io", list)).toBe(false);
    expect(hostAllowed("evilgithub.com", list)).toBe(false);
    expect(deniedMethod("Page.navigate", { url: "https://api.github.com/x" }, list)).toBeNull();
    expect(deniedMethod("Page.navigate", { url: "https://github.com.evil.io" }, list)).toBe(
      "Page.navigate",
    );
  });

  it("[] admits every host but keeps the scheme fence", () => {
    const list: string[] = [];
    for (const host of hosts) expect(hostAllowed(new URL(`https://${host === "about:blank" ? "x.test" : host}`).hostname, list)).toBe(true);
    expect(hostAllowed("", list)).toBe(true);
    expect(deniedMethod("Page.navigate", { url: "https://anything.test" }, list)).toBeNull();
    expect(deniedMethod("Page.navigate", { url: "file:///x" }, list)).toBe("Page.navigate");
  });

  it("ignores port and path when matching", () => {
    expect(hostAllowed(new URL("https://github.com:8443/deep/path").hostname, ["github.com"])).toBe(true);
  });

  it("is case-insensitive on the host and tolerant of a malformed entry", () => {
    expect(hostAllowed("github.com", ["GitHub.COM"])).toBe(true);
    expect(hostAllowed("github.com", ["", "  "])).toBe(false);
  });
});
