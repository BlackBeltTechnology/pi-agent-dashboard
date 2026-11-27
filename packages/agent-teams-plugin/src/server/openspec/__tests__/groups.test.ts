/**
 * `groups.json` resolution and membership (tasks 3.2; tests 7.13 #E9, 7.14 #E10, 7.15 #E11, 7.16 #E12):
 * id first (case-sensitive) then case-insensitive name, persisted order then name, archived members skipped,
 * and a stable typed code for every malformed file.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupMembership, loadGroups, resolveGroup } from "../groups.js";
import { tmp } from "./env.js";

function repoWith(groups: unknown, dirs: string[] = []): string {
  const repo = tmp("at-os-grp-");
  fs.mkdirSync(path.join(repo, "openspec", "groups"), { recursive: true });
  if (groups !== undefined) fs.writeFileSync(path.join(repo, "openspec", "groups", "groups.json"), typeof groups === "string" ? groups : JSON.stringify(groups));
  for (const d of dirs) fs.mkdirSync(path.join(repo, "openspec", "changes", d), { recursive: true });
  return repo;
}

const file = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ schemaVersion: 1, groups: [{ id: "g", name: "G", order: 0 }], assignments: {}, ...over });

describe("membership and order (7.13 #E9)", () => {
  it("persisted changeOrder first, the rest by name in code-point order; archived skipped; other group and unassigned absent", () => {
    const repo = repoWith(
      file({
        groups: [{ id: "g", name: "G" }, { id: "h", name: "H" }],
        assignments: { c: "g", stale: "g", a: "g", b: "g", e: "h", "a-b": "g", a1: "g", "a-2": "g" },
        changeOrder: { g: ["c", "stale", "a"], h: ["e"] },
      }),
      ["c", "a", "b", "e", "d", "a-b", "a1", "a-2"],
    );
    const doc = loadGroups(repo);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const m = groupMembership(repo, doc.doc, doc.doc.groups[0] as never);
    expect(m.included).toEqual(["c", "a", "a-2", "a-b", "a1", "b"]);
    expect(m.skipped).toEqual([{ change: "stale", reason: "no_active_directory" }]);
    expect(m.included).not.toContain("e");
    expect(m.included).not.toContain("d");
  });

  it("without changeOrder the order is by name; an unlisted assigned member follows the listed ones", () => {
    const repo = repoWith(file({ assignments: { z: "g", y: "g", x: "g" } }), ["x", "y", "z"]);
    const doc = loadGroups(repo);
    if (!doc.ok) throw new Error("load");
    expect(groupMembership(repo, doc.doc, doc.doc.groups[0] as never).included).toEqual(["x", "y", "z"]);
  });

  it("a changeOrder entry that is not assigned to the group is ignored; an invalid or symlinked change name is skipped", () => {
    const repo = repoWith(file({ assignments: { a: "g", "../evil": "g", linked: "g" }, changeOrder: { g: ["ghost", "a"] } }), ["a"]);
    fs.symlinkSync(path.join(repo, "openspec", "changes", "a"), path.join(repo, "openspec", "changes", "linked"));
    const doc = loadGroups(repo);
    if (!doc.ok) throw new Error("load");
    const m = groupMembership(repo, doc.doc, doc.doc.groups[0] as never);
    expect(m.included).toEqual(["a"]);
    expect(m.skipped.map((s) => s.change).sort()).toEqual(["../evil", "linked"]);
  });
});

describe("goal resolution: id vs name (7.14 #E10)", () => {
  const repo = repoWith({
    schemaVersion: 1,
    groups: [
      { id: "x", name: "Alpha" },
      { id: "y", name: "X" },
      { id: "c", name: "Foo" },
      { id: "d", name: "foo" },
    ],
    assignments: {},
  });
  const doc = loadGroups(repo);
  const resolve = (goal: string) => (doc.ok ? resolveGroup(doc.doc, goal) : undefined);

  it("`x` → A by id first, even though B's name matches case-insensitively", () => expect(resolve("x")).toMatchObject({ ok: true, group: { id: "x" } }));
  it("`X` → B: the id match is case-sensitive, so it falls to the case-insensitive name", () => expect(resolve("X")).toMatchObject({ ok: true, group: { id: "y" } }));
  it("`alpha` → A by case-insensitive name", () => expect(resolve("alpha")).toMatchObject({ ok: true, group: { id: "x" } }));
  it("`foo` is ambiguous (names Foo and foo), as is `FOO`", () => {
    expect(resolve("foo")).toMatchObject({ ok: false, code: "group_ambiguous" });
    expect(resolve("FOO")).toMatchObject({ ok: false, code: "group_ambiguous" });
  });
  it("an unknown goal is group_unknown", () => expect(resolve("nope")).toMatchObject({ ok: false, code: "group_unknown" }));
  it("a name with spaces resolves", () => {
    const r = repoWith(file({ groups: [{ id: "agent-teams", name: "Agent Teams" }] }));
    const d = loadGroups(r);
    if (!d.ok) throw new Error("load");
    expect(resolveGroup(d.doc, "agent teams")).toMatchObject({ ok: true, group: { id: "agent-teams" } });
  });
});

describe("empty and single groups (7.15 #E11)", () => {
  it("0 included changes: the membership is empty (the preflight answers group_empty)", () => {
    const repo = repoWith(file({ assignments: { gone: "g" } }), []);
    const doc = loadGroups(repo);
    if (!doc.ok) throw new Error("load");
    const m = groupMembership(repo, doc.doc, doc.doc.groups[0] as never);
    expect(m.included).toEqual([]);
    expect(m.skipped).toEqual([{ change: "gone", reason: "no_active_directory" }]);
  });
  it("1 included change", () => {
    const repo = repoWith(file({ assignments: { one: "g" } }), ["one"]);
    const doc = loadGroups(repo);
    if (!doc.ok) throw new Error("load");
    expect(groupMembership(repo, doc.doc, doc.doc.groups[0] as never).included).toEqual(["one"]);
  });
});

describe("malformed groups.json (7.16 #E12)", () => {
  const cases: Array<[string, unknown, string]> = [
    ["invalid JSON", "{not json", "groups_invalid"],
    ["empty object", {}, "groups_invalid"],
    ["groups not an array", file({ groups: {} }), "groups_invalid"],
    ["group without id", file({ groups: [{ name: "G" }] }), "groups_invalid"],
    ["group with an empty id", file({ groups: [{ id: "", name: "G" }] }), "groups_invalid"],
    ["group with a non-string name", file({ groups: [{ id: "g", name: 3 }] }), "groups_invalid"],
    ["duplicate ids", file({ groups: [{ id: "g", name: "A" }, { id: "g", name: "B" }] }), "groups_invalid"],
    ["schemaVersion 2", file({ schemaVersion: 2 }), "groups_invalid"],
    ["schemaVersion missing", { groups: [], assignments: {} }, "groups_invalid"],
    ["schemaVersion as a string", file({ schemaVersion: "1" }), "groups_invalid"],
    ["changeOrder value not an array", file({ changeOrder: { g: "a" } }), "groups_invalid"],
    ["changeOrder entry not a string", file({ changeOrder: { g: [1] } }), "groups_invalid"],
    ["assignments not an object", file({ assignments: [] }), "groups_invalid"],
    ["assignment value not a string", file({ assignments: { a: 3 } }), "groups_invalid"],
    ["a JSON array", [], "groups_invalid"],
    ["null", "null", "groups_invalid"],
    ["BOM", `\uFEFF${JSON.stringify(file())}`, "groups_invalid"],
    ["empty file", "", "groups_invalid"],
  ];
  it.each(cases)("%s → %s", (_n, content, code) => {
    const repo = repoWith(content);
    expect(loadGroups(repo)).toMatchObject({ ok: false, code });
  });

  it("a missing file is group_unknown", () => {
    const repo = repoWith(undefined);
    expect(loadGroups(repo)).toMatchObject({ ok: false, code: "group_unknown" });
    expect(loadGroups(tmp("at-os-none-"))).toMatchObject({ ok: false, code: "group_unknown" });
  });

  it("a symlinked, non-regular or oversize file is groups_invalid, never read", () => {
    const repo = repoWith(undefined);
    const target = path.join(repo, "real.json");
    fs.writeFileSync(target, JSON.stringify(file()));
    fs.symlinkSync(target, path.join(repo, "openspec", "groups", "groups.json"));
    expect(loadGroups(repo)).toMatchObject({ ok: false, code: "groups_invalid" });
    const big = repoWith(`{"schemaVersion":1,"groups":[],"assignments":{},"pad":"${"x".repeat(1024 * 1024)}"}`);
    expect(loadGroups(big)).toMatchObject({ ok: false, code: "groups_invalid" });
  });

  it("a valid file loads", () => {
    const repo = repoWith(file({ changeOrder: { g: ["a"] } }));
    expect(loadGroups(repo)).toMatchObject({ ok: true, doc: { groups: [{ id: "g", name: "G" }], changeOrder: { g: ["a"] } } });
  });
});
