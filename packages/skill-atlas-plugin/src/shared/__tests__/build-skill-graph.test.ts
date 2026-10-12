import { describe, expect, it } from "vitest";
import { buildSkillGraph } from "../build-skill-graph.js";
import type { SkillGraphInput, SkillLink } from "../types.js";

/** Terse fixture helper. */
function s(id: string, body = "", extra: Partial<SkillGraphInput> = {}): SkillGraphInput {
  return { id, description: `${id} desc`, filePath: `/g/${id}/SKILL.md`, origin: "global", body, ...extra };
}
const refs = (links: SkillLink[]) => links.filter((l) => l.type === "references").map((l) => `${l.source}>${l.target}`);
const ofType = (links: SkillLink[], t: SkillLink["type"]) => links.filter((l) => l.type === t);

describe("buildSkillGraph — determinism (test-plan #E1)", () => {
  it("same inputs in different order give identical output", () => {
    const inputs: SkillGraphInput[] = [];
    for (let i = 0; i < 20; i++) {
      const next = `skill-${String((i + 1) % 20).padStart(2, "0")}`;
      inputs.push(s(`skill-${String(i).padStart(2, "0")}`, `see ${next} and \`ctx_execute\``, { pkg: i < 4 ? "@x/pkg" : undefined }));
    }
    const a = buildSkillGraph(inputs);
    const b = buildSkillGraph([...inputs].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.skills.map((n) => n.id)).toEqual([...a.skills.map((n) => n.id)].sort());
    const keys = a.links.map((l) => `${l.source}\0${l.target}\0${l.type}`);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("duplicate ids (test-plan #E3)", () => {
  it("project beats package beats global", () => {
    const g = buildSkillGraph([
      s("review-code", "", { origin: "global", filePath: "/g/a/SKILL.md" }),
      s("review-code", "", { origin: "package", pkg: "@x/p", filePath: "/p/a/SKILL.md" }),
      s("review-code", "", { origin: "project", filePath: "/a/SKILL.md" }),
    ]);
    expect(g.skills).toHaveLength(1);
    expect(g.skills[0].origin).toBe("project");
  });
  it("same origin keeps the lexicographically first filePath", () => {
    const g = buildSkillGraph([
      s("dup-skill", "", { filePath: "/z/SKILL.md" }),
      s("dup-skill", "", { filePath: "/b/SKILL.md" }),
    ]);
    expect(g.skills[0].filePath).toBe("/b/SKILL.md");
  });
});

describe("references (test-plan #E4–#E9)", () => {
  const target = s("review-code");
  it("hyphenated boundary (#E4)", () => {
    const g = buildSkillGraph([
      target,
      s("aaaa-one", "use review-code-extra here"),
      s("aaaa-two", "run (review-code) now"),
      s("aaaa-three", "review-code first"),
      s("aaaa-four", "then review-code"),
    ]);
    expect(refs(g.links).sort()).toEqual(["aaaa-four>review-code", "aaaa-three>review-code", "aaaa-two>review-code"]);
  });
  it("hyphenated match is case-insensitive (#E5)", () => {
    const g = buildSkillGraph([s("doubt-driven-review"), s("plan-proposal", "see Doubt-Driven-Review")]);
    expect(refs(g.links)).toEqual(["plan-proposal>doubt-driven-review"]);
  });
  it("single-word ids need a skill-shaped mention (#E6)", () => {
    const g = buildSkillGraph([
      s("doctor"),
      s("browser"),
      s("bare-list", "commands: `doctor`, `archive`, `status`"),
      s("slash-form", "/skill:doctor please"),
      s("colon-form", "skill: doctor"),
      s("suffix-form", "use the browser skill"),
      s("upper-form", "Use The Browser Skill"),
    ]);
    expect(refs(g.links).sort()).toEqual([
      "colon-form>doctor",
      "slash-form>doctor",
      "suffix-form>browser",
      "upper-form>browser",
    ]);
  });
  it("ids shorter than 4 chars never match (#E7)", () => {
    const g = buildSkillGraph([s("kb"), s("abc"), s("abcd"), s("caller-x", "/skill:kb /skill:abc /skill:abcd")]);
    expect(refs(g.links)).toEqual(["caller-x>abcd"]);
  });
  it("unsafe ids are matched literally, never throw (#E8)", () => {
    const inputs = [s("Nano Banana Image Generation"), s("c++-tool"), s("caller-y", "uses c++-tool daily")];
    expect(() => buildSkillGraph(inputs)).not.toThrow();
    expect(refs(buildSkillGraph(inputs).links)).toEqual(["caller-y>c++-tool"]);
  });
  it("no self-links (#E9)", () => {
    expect(buildSkillGraph([s("plan-proposal", "plan-proposal does x")]).links).toEqual([]);
  });
  it("a skill mentioned three times gives one link", () => {
    const g = buildSkillGraph([s("ship-it"), s("caller-z", "ship-it ship-it ship-it")]);
    expect(refs(g.links)).toEqual(["caller-z>ship-it"]);
  });
});

describe("bundle (test-plan #E10, #E11)", () => {
  const pkgOf = (n: number, name: string) =>
    Array.from({ length: n }, (_, i) => s(`${name}-m${String(i).padStart(2, "0")}`, "", { origin: "package", pkg: name }));
  it.each([
    [1, 0],
    [2, 1],
    [14, 91],
    [15, 0],
  ])("package of %i skills → %i bundle links", (size, expected) => {
    expect(ofType(buildSkillGraph(pkgOf(size, "pkg")).links, "bundle")).toHaveLength(expected);
  });
  it("loose skills never bundle (#E11)", () => {
    const g = buildSkillGraph(Array.from({ length: 5 }, (_, i) => s(`loose-${i}-x`)));
    expect(ofType(g.links, "bundle")).toHaveLength(0);
  });
});

describe("shares-tool (test-plan #E12–#E14)", () => {
  const users = (n: number, token: string) => Array.from({ length: n }, (_, i) => s(`user-${i}-x`, `call ${token}`));
  it.each([
    [1, 0],
    [2, 1],
    [6, 15],
    [7, 0],
  ])("token used by %i skills → %i links (#E12)", (n, expected) => {
    expect(ofType(buildSkillGraph(users(n, "`ctx_execute`")).links, "shares-tool")).toHaveLength(expected);
  });
  it("only backticked snake_case counts; trailing () folded (#E13)", () => {
    const g = buildSkillGraph([
      s("aaaa-a", "`npm` `README.md` `Bash`"),
      s("aaaa-b", "`npm` `README.md` `Bash`"),
      s("aaaa-c", "`ctx_execute()`"),
      s("aaaa-d", "`ctx_execute`"),
    ]);
    const tool = ofType(g.links, "shares-tool");
    expect(tool.map((l) => `${l.source}-${l.target}`)).toEqual(["aaaa-c-aaaa-d"]);
  });
  it("several shared tokens give one link naming all (#E14)", () => {
    const g = buildSkillGraph([s("aaaa-a", "`ctx_search` and `ctx_execute`"), s("aaaa-b", "`ctx_execute`, `ctx_search`")]);
    const tool = ofType(g.links, "shares-tool");
    expect(tool).toHaveLength(1);
    expect(tool[0].why).toContain("ctx_execute");
    expect(tool[0].why).toContain("ctx_search");
    expect(tool[0].why.indexOf("ctx_execute")).toBeLessThan(tool[0].why.indexOf("ctx_search"));
  });
});

describe("canonical links (test-plan #E15)", () => {
  it("undirected links are min→max; mutual references stay two directed links", () => {
    const g = buildSkillGraph([
      s("zeta-skill", "alpha-skill", { origin: "package", pkg: "p" }),
      s("alpha-skill", "zeta-skill", { origin: "package", pkg: "p" }),
    ]);
    const bundle = ofType(g.links, "bundle");
    expect(bundle).toEqual([expect.objectContaining({ source: "alpha-skill", target: "zeta-skill" })]);
    expect(refs(g.links).sort()).toEqual(["alpha-skill>zeta-skill", "zeta-skill>alpha-skill"]);
  });
  it("degree counts every touching link", () => {
    const g = buildSkillGraph([s("aaaa-a", "aaaa-b"), s("aaaa-b"), s("aaaa-c", "aaaa-b")]);
    expect(g.skills.find((n) => n.id === "aaaa-b")?.degree).toBe(2);
  });
  it("output nodes carry no body", () => {
    const g = buildSkillGraph([s("aaaa-a", "BODY-ONLY-7f3a")]);
    expect(JSON.stringify(g)).not.toContain("BODY-ONLY-7f3a");
  });
});
