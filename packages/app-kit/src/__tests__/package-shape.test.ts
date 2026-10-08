import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// E13/E14 — product-neutral, publishable package
// (change: extract-standalone-app-kit, design D1).

const PKG_DIR = join(__dirname, "..", "..");
const SRC = join(PKG_DIR, "src");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
const sources = walk(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, "utf8") }));
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("E13: no product coupling", () => {
  it("scans a non-empty source set", () => {
    expect(sources.length).toBeGreaterThan(4);
  });

  it("references no /api/plugins/ path and no dashboard web-client import", () => {
    const offenders = sources.filter(
      ({ text }) => text.includes("/api/plugins/") || text.includes("@blackbelt-technology/pi-dashboard-web") || text.includes("chat-embed"),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it("the framework-free entry imports neither react nor react-oidc-context", () => {
    const frameworkFree = sources.filter(({ file }) => !file.startsWith("react"));
    expect(frameworkFree.map((s) => s.file)).toContain("index.ts");
    const offenders = frameworkFree.flatMap(({ file, text }) =>
      importsOf(text)
        .filter((spec) => spec === "react" || spec.startsWith("react/") || spec.startsWith("react-oidc-context") || spec.includes("/react/"))
        .map((spec) => `${file} → ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("E14: publishable manifest", () => {
  const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as Record<string, unknown> & {
    publishConfig?: { access?: string };
    files?: string[];
    exports?: Record<string, unknown>;
    peerDependencies?: Record<string, string>;
  };

  it("is public with a license", () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig?.access).toBe("public");
    expect(typeof pkg.license).toBe("string");
  });

  it("excludes the DOX tree from the tarball", () => {
    expect(pkg.files).toContain("!**/AGENTS.md");
    expect(pkg.files).toContain("!**/*.AGENTS.md");
  });

  it("exports . and ./react, with react as a peer", () => {
    expect(Object.keys(pkg.exports ?? {}).sort()).toEqual([".", "./react"]);
    expect(pkg.peerDependencies?.react).toBeDefined();
  });
});
