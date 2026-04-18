import { describe, it, expect } from "vitest";
import { buildJitiRegisterUrl, resolveJitiImport } from "../resolve-jiti.js";

describe("buildJitiRegisterUrl", () => {
  // Pure function: given a jiti package.json path, return the file:// URL of
  // its register hook. The URL contract is the critical invariant — Node's
  // --import on Windows rejects raw drive-letter paths (parses "C:" as a
  // URL scheme). See change: fix-windows-server-parity.

  it("returns a file:// URL", () => {
    const url = buildJitiRegisterUrl("/usr/lib/node_modules/@mariozechner/jiti/package.json");
    expect(url.startsWith("file://")).toBe(true);
  });

  it("URL is parseable by new URL() without throwing", () => {
    const url = buildJitiRegisterUrl("/usr/lib/node_modules/@mariozechner/jiti/package.json");
    expect(() => new URL(url)).not.toThrow();
  });

  it("points at lib/jiti-register.mjs under the package dir", () => {
    const url = buildJitiRegisterUrl("/usr/lib/node_modules/@mariozechner/jiti/package.json");
    expect(url.endsWith("/lib/jiti-register.mjs")).toBe(true);
  });

  it("handles Windows drive-letter paths (regression for ERR_UNSUPPORTED_ESM_URL_SCHEME)", () => {
    // This is the exact shape that crashed pre-fix: a raw path with a
    // drive letter was passed to `node --import` and Node parsed "B:" as
    // a URL scheme. A file:// URL sidesteps the parser entirely.
    const url = buildJitiRegisterUrl("B:\\Dev\\Nodejs\\global\\node_modules\\@mariozechner\\jiti\\package.json");
    expect(url.startsWith("file:///")).toBe(true);
    expect(() => new URL(url)).not.toThrow();
    expect(new URL(url).protocol).toBe("file:");
    // The drive letter survives as part of the pathname, not as a protocol
    expect(url.toLowerCase()).toContain("/b:/");
    expect(url.endsWith("/lib/jiti-register.mjs")).toBe(true);
  });

});

describe("resolveJitiImport", () => {
  // Integration-lite: in vitest context (not inside pi's jiti loader),
  // process.argv[1] points at the test runner, not pi — so peer-dep
  // resolution fails and the function throws a helpful error. The
  // URL-contract behavior is covered by buildJitiRegisterUrl above.

  it("throws with clear error when pi-coding-agent is not resolvable", () => {
    expect(() => resolveJitiImport()).toThrow("Cannot find pi's TypeScript loader");
  });

  it("error message mentions pi-coding-agent", () => {
    expect(() => resolveJitiImport()).toThrow("pi-coding-agent");
  });
});
