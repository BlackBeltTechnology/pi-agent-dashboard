import { describe, expect, it } from "vitest";
import { buildTree, subtreeMatches } from "../file-tree.js";

const cand = (relPath: string) => ({ path: `/repo/${relPath}`, relPath });

describe("buildTree", () => {
  it("nests flat relPaths into directory nodes", () => {
    const tree = buildTree([cand(".pi/agents/Explore.md"), cand(".pi/agents/react-expert.md")]);
    expect(tree.dirs).toHaveLength(1);
    const pi = tree.dirs[0];
    expect(pi.name).toBe(".pi");
    expect(pi.path).toBe(".pi");
    expect(pi.dirs).toHaveLength(1);
    const agents = pi.dirs[0];
    expect(agents.name).toBe("agents");
    expect(agents.path).toBe(".pi/agents");
    expect(agents.files.map((f) => f.name)).toEqual(["Explore.md", "react-expert.md"]);
  });

  it("keeps single-child directories separate (no merge)", () => {
    const tree = buildTree([cand(".pi/skills/autofix/SKILL.md")]);
    const skills = tree.dirs[0].dirs[0];
    expect(skills.name).toBe("skills");
    expect(skills.dirs).toHaveLength(1);
    const autofix = skills.dirs[0];
    expect(autofix.name).toBe("autofix");
    expect(autofix.files.map((f) => f.name)).toEqual(["SKILL.md"]);
  });

  it("sorts directories alphabetically", () => {
    const tree = buildTree([cand("zeta/a.md"), cand("alpha/a.md"), cand("mid/a.md")]);
    expect(tree.dirs.map((d) => d.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("exposes only the basename on leaf files", () => {
    const tree = buildTree([cand("docs/guides/README.md")]);
    const leaf = tree.dirs[0].dirs[0].files[0];
    expect(leaf.name).toBe("README.md");
    expect(leaf.candidate.relPath).toBe("docs/guides/README.md");
  });

  it("places root-level files on the root node", () => {
    const tree = buildTree([cand("AGENTS.md")]);
    expect(tree.dirs).toHaveLength(0);
    expect(tree.files.map((f) => f.name)).toEqual(["AGENTS.md"]);
  });
});

describe("subtreeMatches", () => {
  it("matches a descendant file's relPath", () => {
    const tree = buildTree([cand(".pi/agents/Explore.md")]);
    expect(subtreeMatches(tree.dirs[0], "explore")).toBe(true);
    expect(subtreeMatches(tree.dirs[0], "nomatch")).toBe(false);
  });

  it("matches a directory by its own name", () => {
    const tree = buildTree([cand(".pi/agents/Explore.md")]);
    expect(subtreeMatches(tree.dirs[0], "agents")).toBe(true);
  });
});
