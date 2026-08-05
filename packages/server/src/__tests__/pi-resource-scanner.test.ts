import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, resolvePackages, scanGlobalResources, scanLocalResources, scanPiResources } from "../pi/pi-resource-scanner.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-res-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string) {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

/** One `ResolvedResource` as pi's `PackageManager.resolve()` would return it. */
function resolvedEntry(
  filePath: string,
  meta: { enabled?: boolean; scope?: string; origin?: "package" | "top-level"; source?: string } = {},
) {
  return {
    path: filePath,
    enabled: meta.enabled ?? true,
    metadata: {
      source: meta.source ?? "auto",
      scope: meta.scope ?? "project",
      origin: meta.origin ?? ("top-level" as const),
    },
  };
}

/** A `ResolvedPaths` with every unlisted array empty. */
function resolvedPaths(parts: {
  extensions?: ReturnType<typeof resolvedEntry>[];
  skills?: ReturnType<typeof resolvedEntry>[];
  prompts?: ReturnType<typeof resolvedEntry>[];
  themes?: ReturnType<typeof resolvedEntry>[];
}) {
  return {
    extensions: parts.extensions ?? [],
    skills: parts.skills ?? [],
    prompts: parts.prompts ?? [],
    themes: parts.themes ?? [],
  };
}

describe("parseFrontmatter", () => {
  it("parses name and description from YAML frontmatter", () => {
    const content = `---
name: code-review
description: Comprehensive code review guidance.
license: MIT
---

# Code Review

Instructions here.`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("code-review");
    expect(result.description).toBe("Comprehensive code review guidance.");
  });

  it("handles multi-line description with >", () => {
    const content = `---
name: my-skill
description: >
  Line one
  line two.
---

Body`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("my-skill");
    expect(result.description).toContain("Line one");
  });

  it("returns empty object for no frontmatter", () => {
    const result = parseFrontmatter("# Just a heading\n\nSome content.");
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it("parses model and a list tools summary from agent frontmatter", () => {
    const content = `---
name: react-expert
description: React work.
model: sonnet
tools: [edit, read]
---
Body`;
    const result = parseFrontmatter(content);
    expect(result.model).toBe("sonnet");
    expect(result.tools).toBe("edit,read");
  });

  it("parses a scalar tools value", () => {
    const result = parseFrontmatter("---\nname: a\nmodel: '@fast'\ntools: all\n---\nBody");
    expect(result.model).toBe("'@fast'");
    expect(result.tools).toBe("all");
  });

  it("omits model and tools when absent", () => {
    const result = parseFrontmatter("---\nname: a\ndescription: d\n---\nBody");
    expect(result.model).toBeUndefined();
    expect(result.tools).toBeUndefined();
  });

  it("extracts first non-empty line as description fallback", () => {
    const result = parseFrontmatter("# My Prompt\n\nDo something useful.", true);
    expect(result.description).toBe("# My Prompt");
  });
});

describe("scanLocalResources", () => {
  it("discovers skills from SKILL.md directories", () => {
    writeFile(".pi/skills/code-review/SKILL.md", `---
name: code-review
description: Review code.
---
Instructions`);
    const result = scanLocalResources(tmpDir);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("code-review");
    expect(result.skills[0].description).toBe("Review code.");
    expect(result.skills[0].type).toBe("skill");
  });

  it("discovers skills from root .md files", () => {
    writeFile(".pi/skills/quick-review.md", `---
name: quick-review
description: Quick review.
---
Body`);
    const result = scanLocalResources(tmpDir);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("quick-review");
  });

  it("discovers extensions from .ts files", () => {
    writeFile(".pi/extensions/my-ext.ts", "export default function() {}");
    const result = scanLocalResources(tmpDir);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].name).toBe("my-ext");
    expect(result.extensions[0].type).toBe("extension");
  });

  it("discovers extensions from subdirectory index.ts", () => {
    writeFile(".pi/extensions/my-ext/index.ts", "export default function() {}");
    const result = scanLocalResources(tmpDir);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].name).toBe("my-ext");
  });

  it("discovers prompts from .md files", () => {
    writeFile(".pi/prompts/review.md", `---
description: Review staged changes
---
Review the staged changes.`);
    const result = scanLocalResources(tmpDir);
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe("review");
    expect(result.prompts[0].description).toBe("Review staged changes");
    expect(result.prompts[0].type).toBe("prompt");
  });

  it("discovers agents from agents/*.md with model and tools", () => {
    writeFile(".pi/agents/Explore.md", "---\nname: Explore\ndescription: Read-only search.\nmodel: '@fast'\ntools: read-only\n---\nBody");
    writeFile(".pi/agents/react-expert.md", "---\nname: react-expert\ndescription: React work.\nmodel: sonnet\ntools: [edit, read]\n---\nBody");
    const result = scanLocalResources(tmpDir);
    expect(result.agents).toHaveLength(2);
    const names = result.agents.map((a) => a.name).sort();
    expect(names).toEqual(["Explore", "react-expert"]);
    expect(result.agents.every((a) => a.type === "agent")).toBe(true);
    const react = result.agents.find((a) => a.name === "react-expert");
    expect(react?.model).toBe("sonnet");
    expect(react?.tools).toBe("edit,read");
  });

  it("omits model and tools on an agent that lacks them", () => {
    writeFile(".pi/agents/plain.md", "---\nname: plain\ndescription: No meta.\n---\nBody");
    const result = scanLocalResources(tmpDir);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].model).toBeUndefined();
    expect(result.agents[0].tools).toBeUndefined();
    expect(result.agents[0].description).toBe("No meta.");
  });

  it("returns empty arrays when .pi/ does not exist", () => {
    const result = scanLocalResources(path.join(tmpDir, "nonexistent"));
    expect(result.extensions).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.prompts).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it("yields an empty agents array when agents/ is missing but .pi/ exists", () => {
    writeFile(".pi/skills/s.md", "---\nname: s\n---\nBody");
    const result = scanLocalResources(tmpDir);
    expect(result.agents).toEqual([]);
  });
});

describe("scanGlobalResources", () => {
  it("discovers resources from a global-like directory", () => {
    const globalDir = path.join(tmpDir, "global-pi");
    fs.mkdirSync(path.join(globalDir, "skills", "my-skill"), { recursive: true });
    fs.writeFileSync(path.join(globalDir, "skills", "my-skill", "SKILL.md"), `---
name: my-skill
description: A global skill.
---
Body`);
    fs.mkdirSync(path.join(globalDir, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(globalDir, "extensions", "g-ext.ts"), "export default function() {}");
    fs.mkdirSync(path.join(globalDir, "prompts"), { recursive: true });
    fs.writeFileSync(path.join(globalDir, "prompts", "g-prompt.md"), "Do things.");

    fs.mkdirSync(path.join(globalDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(globalDir, "agents", "doc-writer.md"), "---\nname: doc-writer\ndescription: Docs.\nmodel: haiku\n---\nBody");

    const result = scanGlobalResources(globalDir);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("my-skill");
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].name).toBe("g-ext");
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].name).toBe("g-prompt");
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("doc-writer");
    expect(result.agents[0].type).toBe("agent");
    expect(result.agents[0].model).toBe("haiku");
  });

  it("returns empty when directory does not exist", () => {
    const result = scanGlobalResources("/nonexistent/path");
    expect(result.extensions).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.prompts).toEqual([]);
  });
});

describe("resolvePackages", () => {
  it("resolves a local path package with pi manifest", () => {
    const pkgDir = path.join(tmpDir, "my-pkg");
    fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "src", "bridge.ts"), "export default function() {}");
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "my-pkg",
        description: "A test package",
        pi: { extensions: ["./src/bridge.ts"] },
      }),
    );

    const result = resolvePackages([pkgDir], path.join(tmpDir, "settings-dir"));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-pkg");
    expect(result[0].description).toBe("A test package");
    expect(result[0].resources.extensions).toHaveLength(1);
    expect(result[0].resources.extensions[0].name).toBe("bridge");
  });

  it("resolves package with conventional directories (no pi manifest)", () => {
    const pkgDir = path.join(tmpDir, "conv-pkg");
    fs.mkdirSync(path.join(pkgDir, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "extensions", "ext.ts"), "export default function() {}");
    fs.mkdirSync(path.join(pkgDir, "skills", "my-skill"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "skills", "my-skill", "SKILL.md"), `---
name: my-skill
description: Skill from package.
---
Body`);
    fs.mkdirSync(path.join(pkgDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "agents", "pkg-agent.md"), "---\nname: pkg-agent\nmodel: sonnet\n---\nBody");
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "conv-pkg", description: "Conventional" }),
    );

    const result = resolvePackages([pkgDir], path.join(tmpDir, "settings-dir"));
    expect(result).toHaveLength(1);
    expect(result[0].resources.extensions).toHaveLength(1);
    expect(result[0].resources.skills).toHaveLength(1);
    expect(result[0].resources.agents).toHaveLength(1);
    expect(result[0].resources.agents[0].name).toBe("pkg-agent");
    expect(result[0].source).toBe(pkgDir);
  });

  it("resolves package agents declared in the pi manifest", () => {
    const pkgDir = path.join(tmpDir, "manifest-pkg");
    fs.mkdirSync(path.join(pkgDir, "my-agents"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "my-agents", "a.md"), "---\nname: a\nmodel: haiku\n---\nBody");
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "manifest-pkg", pi: { agents: ["./my-agents"] } }),
    );
    const result = resolvePackages([pkgDir], path.join(tmpDir, "settings-dir"));
    expect(result[0].resources.agents).toHaveLength(1);
    expect(result[0].resources.agents[0].name).toBe("a");
  });

  it("skips missing packages silently", () => {
    const result = resolvePackages(["/nonexistent/package"], tmpDir);
    expect(result).toEqual([]);
  });

  it("resolves relative path packages from settings dir", () => {
    const settingsDir = path.join(tmpDir, "project", ".pi");
    const pkgDir = path.join(tmpDir, "sibling-pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "sibling", description: "Sibling package" }),
    );

    const result = resolvePackages(["../../sibling-pkg"], settingsDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("sibling");
  });
});

describe("scanPiResources (integration)", () => {
  it("combines local, global, and returns a full result", async () => {
    writeFile(".pi/skills/local-skill/SKILL.md", `---
name: local-skill
description: A local skill.
---
Body`);
    writeFile(".pi/prompts/my-prompt.md", "Do something.");

    // We pass a custom globalDir to avoid depending on ~/.pi/agent
    const result = await scanPiResources(tmpDir, {
      globalDir: path.join(tmpDir, "nonexistent-global"),
      resolveActivation: async () =>
        resolvedPaths({
          skills: [resolvedEntry(path.join(tmpDir, ".pi", "skills", "local-skill", "SKILL.md"))],
          prompts: [resolvedEntry(path.join(tmpDir, ".pi", "prompts", "my-prompt.md"))],
        }),
    });
    expect(result.local.skills).toHaveLength(1);
    expect(result.local.prompts).toHaveLength(1);
    expect(result.global.skills).toEqual([]);
    expect(result.packages).toEqual([]);
  });
});

describe("scanPiResources activation state", () => {
  it("marks a resolver-disabled resource enabled:false and an enabled one enabled:true", async () => {
    writeFile(".pi/skills/notes.md", "---\nname: notes\ndescription: Notes.\n---\nBody");
    writeFile(".pi/skills/keep.md", "---\nname: keep\ndescription: Keep.\n---\nBody");
    const skillsDir = path.join(tmpDir, ".pi", "skills");

    const resolveActivation = async () =>
      resolvedPaths({
        skills: [
          resolvedEntry(path.join(skillsDir, "notes.md"), { enabled: false }),
          resolvedEntry(path.join(skillsDir, "keep.md")),
        ],
      });

    const result = await scanPiResources(tmpDir, {
      globalDir: path.join(tmpDir, "nonexistent-global"),
      resolveActivation,
    });
    const notes = result.local.skills.find((s) => s.name === "notes");
    const keep = result.local.skills.find((s) => s.name === "keep");
    expect(notes?.enabled).toBe(false);
    expect(keep?.enabled).toBe(true);
  });

  it("routes resolver scopes into the local and global buckets", async () => {
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-res-global-"));
    try {
      writeFile(".pi/skills/local-skill.md", "---\nname: local-skill\ndescription: Local.\n---\nBody");
      fs.mkdirSync(path.join(globalDir, "skills"), { recursive: true });
      fs.writeFileSync(path.join(globalDir, "skills", "global-skill.md"), "---\nname: global-skill\ndescription: Global.\n---\nBody");

      const resolveActivation = async () =>
        resolvedPaths({
          skills: [
            resolvedEntry(path.join(tmpDir, ".pi", "skills", "local-skill.md"), { scope: "project" }),
            resolvedEntry(path.join(globalDir, "skills", "global-skill.md"), { scope: "user", enabled: false }),
          ],
        });

      const result = await scanPiResources(tmpDir, { globalDir, resolveActivation });
      const localSkill = result.local.skills.find((s) => s.name === "local-skill");
      const globalSkill = result.global.skills.find((s) => s.name === "global-skill");
      expect(localSkill?.enabled).toBe(true);
      expect(globalSkill?.enabled).toBe(false);
    } finally {
      fs.rmSync(globalDir, { recursive: true, force: true });
    }
  });
});

// ── Resolver-sourced discovery ──────────────────────────────────────
// See change: fix-skill-discovery-parity (test-plan E1–E10, X1, X2, X9, P2).

describe("scanPiResources sources skills, prompts and themes from the resolver", () => {
  const noGlobal = () => path.join(tmpDir, "nonexistent-global");

  it("returns one resource per resolved entry and never walks the filesystem for them (E1, P2)", async () => {
    // On disk: a decoy the walk WOULD find but the resolver does not report.
    writeFile(".pi/skills/decoy/SKILL.md", "---\nname: decoy\ndescription: Should not appear.\n---\nBody");
    writeFile(".pi/skills/a/SKILL.md", "---\nname: a\ndescription: A.\n---\nBody");
    writeFile(".pi/skills/b/SKILL.md", "---\nname: b\ndescription: B.\n---\nBody");
    writeFile(".pi/skills/c/SKILL.md", "---\nname: c\ndescription: C.\n---\nBody");
    writeFile(".pi/prompts/p.md", "Prompt body.");
    writeFile(".pi/themes/t.json", "{}");

    let calls = 0;
    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () => {
        calls += 1;
        return resolvedPaths({
          skills: ["a", "b", "c"].map((n) => resolvedEntry(path.join(tmpDir, ".pi", "skills", n, "SKILL.md"))),
          prompts: [resolvedEntry(path.join(tmpDir, ".pi", "prompts", "p.md"))],
          themes: [resolvedEntry(path.join(tmpDir, ".pi", "themes", "t.json"))],
        });
      },
    });

    expect(result.local.skills.map((s) => s.name).sort()).toEqual(["a", "b", "c"]);
    expect(result.local.prompts).toHaveLength(1);
    expect(result.local.themes).toHaveLength(1);
    // The walk found `decoy`; the resolver did not report it, so it is absent.
    expect(result.local.skills.some((s) => s.name === "decoy")).toBe(false);
    // P2: exactly one resolve() per scan.
    expect(calls).toBe(1);
  });

  it("maps scope and origin onto per-resource attributes (E2, E3)", async () => {
    for (const n of ["proj", "usr", "tmp"]) {
      writeFile(`skills/${n}/SKILL.md`, `---\nname: ${n}\ndescription: ${n}.\n---\nBody`);
    }
    const at = (n: string) => path.join(tmpDir, "skills", n, "SKILL.md");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({
          skills: [
            resolvedEntry(at("proj"), { scope: "project" }),
            resolvedEntry(at("usr"), { scope: "user" }),
            resolvedEntry(at("tmp"), { scope: "temporary" }),
          ],
        }),
    });

    expect(result.local.skills.map((s) => s.name).sort()).toEqual(["proj", "tmp"]);
    expect(result.global.skills.map((s) => s.name)).toEqual(["usr"]);
  });

  it("reports a package-origin entry whose source matches no package row, labelled raw (E4)", async () => {
    writeFile("skills/orphan/SKILL.md", "---\nname: orphan\ndescription: Orphan.\n---\nBody");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({
          skills: [
            resolvedEntry(path.join(tmpDir, "skills", "orphan", "SKILL.md"), {
              origin: "package",
              source: "npm:foo@1.2.3",
            }),
          ],
        }),
    });

    const orphan = result.local.skills.find((s) => s.name === "orphan");
    expect(orphan).toBeDefined();
    expect(orphan?.packageSource).toBe("npm:foo@1.2.3");
  });

  it("does not synthesise an entry for a manifest-excluded package resource (E5)", async () => {
    const pkgDir = path.join(tmpDir, "pkg");
    fs.mkdirSync(path.join(pkgDir, "skills", "kept"), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, "skills", "excluded"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "skills", "kept", "SKILL.md"), "---\nname: kept\ndescription: Kept.\n---\nBody");
    fs.writeFileSync(path.join(pkgDir, "skills", "excluded", "SKILL.md"), "---\nname: excluded\ndescription: Excluded.\n---\nBody");
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "pkg" }));
    writeFile(".pi/settings.json", JSON.stringify({ packages: [pkgDir] }));

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      // The resolver applied the manifest: only `kept` comes back.
      resolveActivation: async () =>
        resolvedPaths({
          skills: [
            resolvedEntry(path.join(pkgDir, "skills", "kept", "SKILL.md"), { origin: "package", source: pkgDir }),
          ],
        }),
    });

    const all = [...result.local.skills, ...result.global.skills, ...result.packages.flatMap((p) => p.resources.skills)];
    expect(all.map((s) => s.name)).toEqual(["kept"]);
    expect(all.some((s) => s.name === "excluded")).toBe(false);
  });

  it("applies pi's load gate: no non-empty description means no skill (E6, E7, E8)", async () => {
    writeFile("skills/empty/SKILL.md", '---\nname: empty\ndescription: ""\n---\nBody');
    writeFile("skills/blank/SKILL.md", '---\nname: blank\ndescription: "   "\n---\nBody');
    writeFile("skills/tiny/SKILL.md", "---\nname: tiny\ndescription: x\n---\nBody");
    const at = (n: string) => path.join(tmpDir, "skills", n, "SKILL.md");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({ skills: [at("empty"), at("blank"), at("tiny")].map((p) => resolvedEntry(p)) }),
    });

    expect(result.local.skills.map((s) => s.name)).toEqual(["tiny"]);
  });

  it("omits a resolved path with no frontmatter at all, and completes (E9)", async () => {
    writeFile(".pi/skills/AGENTS.md", "# Skills tree\n\nA doc, not a skill.\n");
    writeFile("skills/real/SKILL.md", "---\nname: real\ndescription: Real.\n---\nBody");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({
          skills: [
            resolvedEntry(path.join(tmpDir, ".pi", "skills", "AGENTS.md")),
            resolvedEntry(path.join(tmpDir, "skills", "real", "SKILL.md")),
          ],
        }),
    });

    expect(result.local.skills.map((s) => s.name)).toEqual(["real"]);
  });

  it("falls the skill name back to the containing directory basename (E10)", async () => {
    writeFile("skills/foo-bar/SKILL.md", "---\ndescription: Named by its directory.\n---\nBody");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({ skills: [resolvedEntry(path.join(tmpDir, "skills", "foo-bar", "SKILL.md"))] }),
    });

    expect(result.local.skills.map((s) => s.name)).toEqual(["foo-bar"]);
  });

  it("keeps prompt first-non-empty-line description fallback for resolver-sourced prompts (X9)", async () => {
    writeFile("prompts/plain.md", "\n\nFirst real line.\nSecond line.\n");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({ prompts: [resolvedEntry(path.join(tmpDir, "prompts", "plain.md"))] }),
    });

    expect(result.local.prompts[0]?.description).toBe("First real line.");
  });

  it("reports resolver themes (1.4)", async () => {
    writeFile("themes/midnight.json", "{}");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () =>
        resolvedPaths({ themes: [resolvedEntry(path.join(tmpDir, "themes", "midnight.json"), { scope: "user" })] }),
    });

    expect(result.global.themes.map((t) => t.name)).toEqual(["midnight"]);
    expect(result.global.themes[0]?.type).toBe("theme");
  });

  it("keeps agents and extensions scanner-discovered after the rewire (1.6a)", async () => {
    writeFile(".pi/agents/Explore.md", "---\nname: Explore\ndescription: Read-only search.\nmodel: sonnet\n---\nBody");
    writeFile(".pi/extensions/my-ext.ts", "export default function () {}");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () => resolvedPaths({}),
    });

    expect(result.local.agents.map((a) => a.name)).toEqual(["Explore"]);
    expect(result.local.extensions.map((e) => e.name)).toEqual(["my-ext"]);
  });
});

describe("scanPiResources degraded fallback", () => {
  const noGlobal = () => path.join(tmpDir, "nonexistent-global");

  it("falls back to the walk and marks degraded when the resolver returns null (2.4)", async () => {
    writeFile(".pi/skills/walked/SKILL.md", "---\nname: walked\ndescription: Found by the walk.\n---\nBody");

    const result = await scanPiResources(tmpDir, { globalDir: noGlobal(), resolveActivation: async () => null });

    expect(result.degraded).toBe(true);
    expect(result.local.skills.map((s) => s.name)).toEqual(["walked"]);
  });

  it("marks degraded when the resolver throws, without the exception escaping (X1)", async () => {
    writeFile(".pi/skills/walked/SKILL.md", "---\nname: walked\ndescription: Found by the walk.\n---\nBody");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () => {
        throw new Error("pi is unavailable");
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.local.skills.map((s) => s.name)).toEqual(["walked"]);
  });

  it("marks degraded when a successful-but-empty resolve is contradicted by the walk (X2)", async () => {
    writeFile(".pi/skills/walked/SKILL.md", "---\nname: walked\ndescription: Found by the walk.\n---\nBody");

    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () => resolvedPaths({}),
    });

    expect(result.degraded).toBe(true);
    expect(result.local.skills.map((s) => s.name)).toEqual(["walked"]);
  });

  it("does not mark degraded when an empty resolve is uncontradicted", async () => {
    const result = await scanPiResources(tmpDir, {
      globalDir: noGlobal(),
      resolveActivation: async () => resolvedPaths({}),
    });

    expect(result.degraded).toBeUndefined();
    expect(result.local.skills).toEqual([]);
  });
});
