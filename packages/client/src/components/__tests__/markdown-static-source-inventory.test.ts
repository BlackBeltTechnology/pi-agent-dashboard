/**
 * Static inventory: which `<MarkdownContent` call sites declare `staticSource`.
 * On-disk preview surfaces must (M1 completeness + markup repair); chat / thinking /
 * tool surfaces must NOT (streaming gate + no repair stay).
 * See change: add-md-adoc-markup-repair (test-plan F8).
 */
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, "../..");
const pkgs = path.resolve(clientSrc, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** file → whether any of its `<MarkdownContent …>` elements has `staticSource`. */
function callSites(): Map<string, boolean[]> {
  const sites = new Map<string, boolean[]>();
  for (const root of [clientSrc, ...fs.readdirSync(pkgs).map((d) => path.join(pkgs, d, "src"))]) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, "utf8");
      const re = /<MarkdownContent\b([\s\S]*?)(?:\/>|<\/MarkdownContent>)/g;
      for (const m of text.matchAll(re)) {
        const list = sites.get(file) ?? [];
        list.push(/\bstaticSource\b/.test(m[1]));
        sites.set(file, list);
      }
    }
  }
  return sites;
}

const ON_DISK = ["FilePreviewOverlay.tsx", "MarkdownViewer.tsx", "MarkdownPreview.tsx", "MarkdownPreviewView.tsx"];

describe("MarkdownContent staticSource inventory (F8)", () => {
  const sites = callSites();
  const byName = (name: string) => [...sites.entries()].filter(([f]) => path.basename(f) === name).flatMap(([, v]) => v);

  it("finds the call sites at all", () => {
    expect(sites.size).toBeGreaterThan(10);
  });

  it.each(ON_DISK)("%s passes staticSource", (name) => {
    const flags = byName(name);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every(Boolean)).toBe(true);
  });

  it("no other call site (chat, thinking, tool, flow, dialogs) passes staticSource", () => {
    const offenders = [...sites.entries()]
      .filter(([f]) => !ON_DISK.includes(path.basename(f)))
      .filter(([, flags]) => flags.some(Boolean))
      .map(([f]) => path.relative(pkgs, f));
    expect(offenders).toEqual([]);
  });
});
