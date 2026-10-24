/**
 * The `blender` agent skill: frontmatter and the content the spec requires.
 *
 * See change: add-blender-wasm-mcp (test-plan E65; task 6.6).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const raw = fs.readFileSync(path.join(PKG_DIR, ".pi", "skills", "blender", "SKILL.md"), "utf8");
const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
const front = parts?.[1] ?? "";
const body = parts?.[2] ?? "";
const field = (name: string): string => new RegExp(`^${name}: (.+)$`, "m").exec(front)?.[1] ?? "";

describe("blender skill", () => {
  it("E65: frontmatter name is `blender` and matches the directory", () => {
    expect(parts, "SKILL.md must start with a frontmatter block").not.toBeNull();
    expect(field("name")).toBe("blender");
    expect(path.basename(path.join(PKG_DIR, ".pi", "skills", "blender"))).toBe(field("name"));
  });

  it("E65: the description names headless Blender, 3D modelling and GLB export, with quoted user phrasings", () => {
    const d = field("description");
    expect(d.length).toBeGreaterThan(60);
    expect(d).toMatch(/headless Blender/i);
    expect(d).toMatch(/3D modell?ing/i);
    expect(d).toMatch(/\bGLB\b/);
    expect(d).toMatch(/export/i);
    expect(d).toMatch(/"[^"]{6,}"/);
  });

  it("E65: package.json declares the skill and it is the only one", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8")) as { pi: { skills: string[] } };
    expect(pkg.pi.skills).toEqual([".pi/skills/blender"]);
  });

  it("E65: the body covers registration, ensure-first, build limits, sessionReset, multi-file imports, .gltf re-import, GLB-first and headless idioms", () => {
    expect(body).toContain("pi-blender mcp --register");
    expect(body).toMatch(/pi-blender ensure/);
    expect(body).toMatch(/Subsurf/);
    expect(body).toMatch(/OpenSubdiv/);
    expect(body).toMatch(/no rendering/i);
    expect(body).toMatch(/USD, Alembic or X3D/);
    expect(body).toMatch(/no network and no subprocess/i);
    expect(body).toMatch(/1\.2 GB/);
    expect(body).toMatch(/sessionReset/);
    expect(body).toMatch(/scene (was|is) (lost|gone)/i);
    expect(body).toMatch(/blender_python[\s\S]{0,200}inputs/);
    expect(body).toMatch(/\.gltf[\s\S]{0,200}blender_python|blender_python[\s\S]{0,200}\.gltf/);
    expect(body).toMatch(/GLB-first/i);
    expect(body).toContain("/in/");
    expect(body).toContain("/out/");
    expect(body).toContain("bpy.context.collection.objects.link");
    expect(body).toMatch(/Node 24/);
  });

  it("E65: every MCP tool is named", () => {
    for (const tool of ["blender_scene", "blender_python", "blender_import", "blender_export", "blender_reset"]) expect(body, tool).toContain(tool);
  });

  it("E65: every CLI command the skill shows exists in the CLI usage", async () => {
    const { USAGE } = await import("../bin/blender.js");
    const cmds = [...body.matchAll(/^pi-blender ([a-z]+)/gm)].map((m) => m[1]);
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of new Set(cmds)) expect(USAGE, c).toContain(c);
  });
});
