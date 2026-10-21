/**
 * Static scan: `<ShellHeadlessSlot/>` is mounted exactly once in App.tsx, inside
 * the shared `apiProvider` body (hence inside `PluginContextProvider` and on
 * every return branch) — test-plan #E7. See change: fix-empty-status-subcard.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

/**
 * @structural-pin mount-site contract: App.tsx must mount ShellHeadlessSlot exactly once inside the apiProvider body (every layout branch); a rendered App test cannot enumerate all three return branches
 */
describe("ShellHeadlessSlot mount in App.tsx (#E7)", () => {
  it("has exactly one JSX mount", () => {
    expect(src.match(/<ShellHeadlessSlot\b/g)).toHaveLength(1);
  });

  it("is located inside the apiProvider body, within PluginContextProvider", () => {
    const start = src.indexOf("const apiProvider");
    const end = src.indexOf("</ApiContext.Provider>", start);
    const mount = src.indexOf("<ShellHeadlessSlot");
    expect(start).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(start);
    expect(mount).toBeLessThan(end);
    const open = src.indexOf("<PluginContextProvider", start);
    const close = src.indexOf("</PluginContextProvider>", start);
    expect(mount).toBeGreaterThan(open);
    expect(mount).toBeLessThan(close);
  });

  it("is imported from the plugin runtime", () => {
    expect(src).toMatch(/ShellHeadlessSlot[^;]*from "@blackbelt-technology\/dashboard-plugin-runtime\/host"/s);
  });
});
