/**
 * `stripRemoteCredentials`: userinfo never survives; shape is kept raw.
 * See change: harden-bridge-inbound-and-discovery (D18; test-plan BE17/BE18/BX6 helper level).
 */
import { describe, expect, it } from "vitest";
import { stripRemoteCredentials } from "../remote-credentials.js";

const SECRETS = ["pass", "p%40ss", "ss", "tok", "secret", "user"];

describe("stripRemoteCredentials", () => {
  const cases: Array<[string, string | undefined]> = [
    ["https://user@github.com/o/r", "https://github.com/o/r"],
    ["https://user:pass@github.com/o/r", "https://github.com/o/r"],
    ["https://user:p%40ss@github.com/o/r", "https://github.com/o/r"],
    ["https://user:p@ss@github.com/o/r", "https://github.com/o/r"],
    ["https://tok@github.com:8443/o/r", "https://github.com:8443/o/r"],
    ["https://user:pass@[::1]:8443/o/r", "https://[::1]:8443/o/r"],
    ["http://user:pass@host/o/r.git", "http://host/o/r.git"],
    ["ssh://git:secret@github.com/o/r", "ssh://git@github.com/o/r"],
    ["ssh://git@github.com/o/r", "ssh://git@github.com/o/r"],
    ["git@github.com:o/r.git", "git@github.com:o/r.git"],
    ["https://github.com/o/r", "https://github.com/o/r"],
    ["ssh://:secret@github.com/o/r", "ssh://github.com/o/r"],
    // userinfo present, no usable host → nothing is sent / built
    ["https://user:pass@", undefined],
    ["https://user:pass@/o/r", undefined],
    ["ssh://:secret@", undefined],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${String(expected)}`, () => {
      const out = stripRemoteCredentials(input);
      expect(out).toBe(expected);
      if (out !== undefined && input.includes("@") && out !== input) {
        for (const s of ["pass", "p%40ss", "tok", "secret"]) expect(out).not.toContain(s);
      }
    });
  }

  it("is idempotent and never produces the normalised host/path shape", () => {
    for (const [input] of cases) {
      const once = stripRemoteCredentials(input);
      if (once === undefined) continue;
      expect(stripRemoteCredentials(once)).toBe(once);
    }
    expect(stripRemoteCredentials("https://u:p@github.com/o/r")).toMatch(/^https:\/\//);
  });

  it("input without userinfo is returned byte-identical, including odd text", () => {
    for (const s of ["not a url", "", "git@:o/r", "/local/path", "file:///repo", "https://github.com/o/r?x=1#f"]) {
      expect(stripRemoteCredentials(s)).toBe(s);
    }
  });

  it("never leaves a secret in any case that returns a string", () => {
    for (const [input] of cases) {
      const out = stripRemoteCredentials(input);
      if (!out || !input.includes("://")) continue;
      for (const s of SECRETS.filter((x) => !["user", "ss"].includes(x))) {
        if (input.includes(s)) expect(out, `${input}`).not.toContain(s);
      }
    }
  });
});

// Audit follow-ups: tokens on non-http schemes and inside odd authorities.
describe("stripRemoteCredentials hardening", () => {
  it("non-ssh schemes lose ALL userinfo (the user part is the token); the ssh family keeps the user", () => {
    expect(stripRemoteCredentials("git+https://TOKEN@host/o/r")).toBe("git+https://host/o/r");
    expect(stripRemoteCredentials("ftps://TOKEN@host/o/r")).toBe("ftps://host/o/r");
    expect(stripRemoteCredentials("git://u:TOKEN@host/o/r")).toBe("git://host/o/r");
    expect(stripRemoteCredentials("git+ssh://git:secret@host/o/r")).toBe("git+ssh://git@host/o/r");
    expect(stripRemoteCredentials("SSH://git:secret@host/o/r")).toBe("SSH://git@host/o/r");
  });

  it("fails closed when a `#` or `?` in the password hides the `@`", () => {
    expect(stripRemoteCredentials("https://u:p#x@host/o/r")).toBeUndefined();
    expect(stripRemoteCredentials("https://u:p?x@host/o/r")).toBeUndefined();
    expect(stripRemoteCredentials("https://host/o/r?next=a@b")).toBe("https://host/o/r?next=a@b"); // `@` only after the first `/`
  });
});

describe("remoteForWire", () => {
  it("drops credentials AND a query/fragment from URL forms; leaves scp and plain URLs alone", async () => {
    const { remoteForWire } = await import("../remote-credentials.js");
    expect(remoteForWire("https://u:p@github.com/o/r?access_token=SECRET#f")).toBe("https://github.com/o/r");
    expect(remoteForWire("https://github.com/o/r?token=SECRET")).toBe("https://github.com/o/r");
    expect(remoteForWire("https://github.com/o/r")).toBe("https://github.com/o/r");
    expect(remoteForWire("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
    expect(remoteForWire("https://user:pass@")).toBeUndefined();
  });
});
