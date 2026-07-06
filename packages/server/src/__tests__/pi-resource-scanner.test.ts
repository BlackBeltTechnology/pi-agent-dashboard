import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, resolvePackages, scanGlobalResources, scanLocalResources, scanPiResources } from "../pi-resource-scanner.js";

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
    const result = await scanPiResources(tmpDir, { globalDir: path.join(tmpDir, "nonexistent-global") });
    expect(result.local.skills).toHaveLength(1);
    expect(result.local.prompts).toHaveLength(1);
    expect(result.global.skills).toEqual([]);
    expect(result.packages).toEqual([]);
  });
});

describe("scanPiResources activation state", () => {
  it("marks a resolver-disabled resource enabled:false and an unmatched one enabled:true", async () => {
    writeFile(".pi/skills/notes.md", "---\nname: notes\n---\nBody");
    writeFile(".pi/skills/keep.md", "---\nname: keep\n---\nBody");
    const notesPath = path.join(tmpDir, ".pi", "skills", "notes.md");

    // Fake resolver reports only `notes` (disabled). `keep` is unreported.
    const resolveActivation = async () => ({
      extensions: [],
      skills: [
        { path: notesPath, enabled: false, metadata: { source: "auto", scope: "project", origin: "top-level" as const } },
      ],
      prompts: [],
      themes: [],
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

  it("applies activation to both local and global scopes", async () => {
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-res-global-"));
    try {
      writeFile(".pi/skills/local-skill.md", "---\nname: local-skill\n---\nBody");
      fs.mkdirSync(path.join(globalDir, "skills"), { recursive: true });
      fs.writeFileSync(path.join(globalDir, "skills", "global-skill.md"), "---\nname: global-skill\n---\nBody");
      const globalSkillPath = path.join(globalDir, "skills", "global-skill.md");

      // Resolver disables the global skill; local defaults to enabled.
      const resolveActivation = async () => ({
        extensions: [],
        skills: [
          { path: globalSkillPath, enabled: false, metadata: { source: "auto", scope: "user", origin: "top-level" as const } },
        ],
        prompts: [],
        themes: [],
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
