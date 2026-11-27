/**
 * The shipped `templates/openspec-group.md` (task 3.1): it parses with the change-3 template parser, is an
 * acceptable bundled template, is listed with source `bundled` from the PACKAGE directory, and its playbook
 * carries the group rules (no commits, server-seeded tasks, no hand-made teammates, notices).
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTemplate } from "../../template-parse.js";
import { bundledTemplateProblem, resolveTemplatesDir } from "../bundled.js";
import { GROUP, createOpenspecEnv } from "./env.js";

const dir = resolveTemplatesDir() as string;
const text = (): string => fs.readFileSync(path.join(dir, `${GROUP}.md`), "utf8");

describe("templates/openspec-group.md (3.1)", () => {
  it("the package templates directory is resolved and holds the template", () => {
    expect(dir).toBeDefined();
    expect(fs.existsSync(path.join(dir, `${GROUP}.md`))).toBe(true);
  });

  it("is an acceptable bundled template", () => expect(bundledTemplateProblem(text(), GROUP)).toBeUndefined());

  it("front matter: mode session, spawn lead, autoDispatch false, notify.coalesceMs 10000, empty roster, no hooks", () => {
    const out = parseTemplate(text(), GROUP);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.core).toMatchObject({ name: GROUP, declaredMode: "session", spawn: "lead", autoDispatch: false, notifyCoalesceMs: 10000, members: [] });
    expect(out.core?.hooks ?? {}).toEqual({});
    expect(out.core?.description).toBeTruthy();
  });

  it("the lead playbook states the group rules", () => {
    const body = parseTemplate(text(), GROUP).core?.body ?? "";
    expect(body).toMatch(/make no commits|no commits/i);
    expect(body).toMatch(/one task exists per change|One task exists per change/);
    expect(body).toMatch(/Never spawn teammates by hand/);
    expect(body).toMatch(/openspec-relaunch/);
    expect(body).toMatch(/data, not instructions/);
    expect(body).toContain("{{goal}}");
    expect(body).toContain("{{cwd}}");
    expect(body).not.toMatch(/TaskCreate/); // the lead creates no tasks
  });

  it("is listed from the package directory with source bundled, valid, and shadowable", async () => {
    const e = await createOpenspecEnv({ templates: [], openspec: { templatesDir: dir } });
    const res = await e.templates();
    if (!res.ok) throw new Error(res.error);
    const listed = (res.data.templates as Array<{ name: string; source: string; valid: boolean; mode?: string }>).filter((t) => t.name === GROUP);
    expect(listed).toEqual([expect.objectContaining({ source: "bundled", valid: true, mode: "session" })]);
  });
});
