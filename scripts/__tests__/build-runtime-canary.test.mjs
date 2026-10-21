/**
 * Builds the runtime canary + its failure variants with the SDK preset and checks the artifact shape
 * (tasks 7.4, 8.1; tests 8.129 artifact half / test-plan #E95, plus the manifest/layout contract).
 * Browser behaviour (F8–F18, X11–X13, P3) is Playwright's job; this proves the OUTPUT is what those specs load.
 * See change: decouple-plugins-from-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { beforeAll, describe, expect, it } from "vitest";
import { buildRuntimeCanary, CANARY_ROOT } from "../build-runtime-canary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jiti = createJiti(import.meta.url, { interopDefault: true });
const importMap = await jiti.import(path.join(repoRoot, "packages/shared/src/dashboard-plugin/host-import-map.ts"));
const SPECIFIERS = [...importMap.HOST_IMPORT_MAP_SPECIFIERS];

const read = (p) => fs.readFileSync(p, "utf8");
const bareImports = (js) =>
  new Set([...js.matchAll(/from\s*["']([^"'./][^"']*)["']|import\s*["']([^"'./][^"']*)["']/g)].map((m) => m[1] ?? m[2]));
const manifestOf = (dir) => JSON.parse(read(path.join(dir, "package.json")));

/** @type {Record<string,string>} */
let built;
beforeAll(async () => {
  built = await buildRuntimeCanary();
}, 240_000);

describe("runtime canary — base build", () => {
  it("emits the entry module, both lazy chunks and the stylesheet where the manifest says", () => {
    const pkg = manifestOf(CANARY_ROOT);
    const m = pkg["pi-dashboard-plugin"];
    expect(m.fixture).toBe(true);
    expect(pkg.keywords).toContain("pi-dashboard-plugin");
    for (const rel of [m.clientBundle, m.clientStyles, ...m.claims.filter((c) => c.module).map((c) => c.module)]) {
      expect(fs.existsSync(path.join(CANARY_ROOT, rel)), rel).toBe(true);
    }
    expect(fs.existsSync(path.join(built.base, "index.js"))).toBe(true);
  });

  it("manifest validates; the asset root is dedicated (server entry outside it)", async () => {
    const { validateManifest } = await jiti.import(path.join(repoRoot, "packages/dashboard-plugin-runtime/src/manifest-validator.ts"));
    const { evaluateClientLayout } = await jiti.import(path.join(repoRoot, "packages/dashboard-plugin-runtime/src/server/client-layout.ts"));
    const m = manifestOf(CANARY_ROOT)["pi-dashboard-plugin"];
    expect(() => validateManifest(m)).not.toThrow();
    const layout = evaluateClientLayout({ packageDir: CANARY_ROOT, clientBundle: m.clientBundle, clientStyles: m.clientStyles, server: m.server });
    expect(layout.clientLayoutError).toBeUndefined();
  });

  it("claims cover the required slots: settings shouldRender, S6 route, folder entry, lazy module, i18n catalog", () => {
    const m = manifestOf(CANARY_ROOT)["pi-dashboard-plugin"];
    expect(m.claims.find((c) => c.slot === "settings-section" && c.shouldRender)).toBeTruthy();
    expect(m.claims.find((c) => c.slot === "shell-overlay-route")).toMatchObject({ path: "/s6/*?", depth: 1, presentation: "content", module: expect.any(String) });
    expect(m.claims.some((c) => c.slot === "sidebar-folder-section")).toBe(true);
    expect(m.i18nCatalog).toBe("catalog");
    const entry = read(path.join(built.base, "index.js"));
    expect(entry).toMatch(/export\s*\{[^}]*\bcatalog\b/);
    for (const name of ["canaryShouldRender", "CanarySettings", "CanaryFolderEntry"]) expect(entry).toContain(name);
    // Lazy claims stay OUT of the entry.
    for (const name of ["S6Route", "CanaryLazyPanel", "EmbeddedApp"]) expect(entry).not.toContain(name);
  });

  it("every bare import is an import-map specifier; React is not bundled; no markdown parser", () => {
    for (const f of ["index.js", "s6-route.js", "lazy-panel.js"]) {
      const js = read(path.join(built.base, f));
      for (const spec of bareImports(js)) expect(SPECIFIERS, `${f} imports ${spec}`).toContain(spec);
      expect(js, f).not.toMatch(/react\.transitional\.element|__vitePreload/);
      expect(js, f).not.toMatch(/micromark|remark|\bmarked\b/);
    }
    expect(bareImports(read(path.join(built.base, "s6-route.js")))).toEqual(
      new Set(["react", "react/jsx-runtime", "@blackbelt-technology/dashboard-plugin-runtime/embedded-app", "@blackbelt-technology/pi-dashboard-app-kit/react", "wouter"]),
    );
  });

  it("stylesheet is utilities-only: utilities present, no preflight reset, no :root theme", () => {
    const css = read(path.join(built.base, "client.css"));
    expect(css).toMatch(/\.grid\b/);
    expect(css).toContain("var(--bg-surface)");
    expect(css).not.toMatch(/box-sizing:\s*border-box|line-height:\s*1\.5|-webkit-text-size-adjust|\bhtml\b\s*,|:host|:root|--font-sans|--color-/);
  });

  it("the S6 claim is ~6 plugin LOC", () => {
    const src = read(path.join(CANARY_ROOT, "src/client/S6Route.tsx")).split("\n").filter((l) => l.trim() && !l.startsWith("import"));
    expect(src.length).toBeLessThanOrEqual(6);
  });
});

describe("runtime canary — failure variants", () => {
  it("missing-export imports a name the host runtime shim does not export", () => {
    const js = read(path.join(built["missing-export"], "index.js"));
    expect(js).toMatch(/import\s*\{\s*createSlotRegistry\b[^}]*\}\s*from\s*"@blackbelt-technology\/dashboard-plugin-runtime"/);
    const surface = JSON.parse(read(path.join(repoRoot, "packages/dashboard-plugin-runtime/host-api-surface.json")));
    expect(surface.publicExports).not.toContain("createSlotRegistry");
  });

  it("bundled-react carries its own React (and imports none from the host)", () => {
    const js = read(path.join(built["bundled-react"], "index.js"));
    expect(js).toContain("react.transitional.element");
    expect([...bareImports(js)].filter((s) => s.startsWith("react"))).toEqual([]);
  });

  it("throws-in-render is a clean build whose claim throws", () => {
    expect(read(path.join(built["throws-in-render"], "index.js"))).toContain("render failure (expected)");
  });

  it("bundled-app-kit carries its own app-kit context (no host app-kit import)", () => {
    const js = read(path.join(built["bundled-app-kit"], "index.js"));
    expect(js).toContain("useAppHost: no AppHostProvider above this component");
    expect(bareImports(js).has("@blackbelt-technology/pi-dashboard-app-kit/react")).toBe(false);
  });

  it("each variant manifest is a fixture with its own id and a dedicated client dir", () => {
    for (const name of ["missing-export", "bundled-react", "throws-in-render", "bundled-app-kit"]) {
      const m = manifestOf(path.join(CANARY_ROOT, "variants", name))["pi-dashboard-plugin"];
      expect(m.fixture).toBe(true);
      expect(m.id).toBe(`runtime-canary-${name}`);
      expect(m.clientBundle).toBe("./dist/client/index.js");
      expect(m.server).toBeUndefined();
    }
  });
});
