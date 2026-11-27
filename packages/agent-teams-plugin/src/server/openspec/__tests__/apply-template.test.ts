/**
 * The shipped `templates/openspec-apply.md` (task 5.1) and its briefing (`apply-briefing.ts`), plus the loopback
 * inject helper (5.2): the template loads through the foundation's bundled-source rules and the core template
 * parser, the reviewer cannot write, the lead playbook carries the commit rule, and the member prompts ARE the
 * canonical briefing texts. Rendering of the briefing at spawn is exercised by the later briefing suite.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTemplate } from "../../template-parse.js";
import { buildApplyBriefing } from "../apply-briefing.js";
import { bundledTemplateProblem } from "../bundled.js";
import { createInject, INJECT_HOST, INJECT_REMOTE_ADDRESS } from "../inject.js";
import { TEMPLATES_DIR } from "./apply-env.js";

const text = fs.readFileSync(path.join(TEMPLATES_DIR, "openspec-apply.md"), "utf8");
const core = parseTemplate(text, "openspec-apply").core;

describe("templates/openspec-apply.md (5.1)", () => {
  it("loads through the bundled-source rules: valid, mode session, no TaskCreated hook", () => {
    expect(bundledTemplateProblem(text, "openspec-apply")).toBeUndefined();
    expect(core?.declaredMode).toBe("session");
    expect(core?.hooks?.TaskCreated).toBeUndefined();
    expect(parseTemplate(text, "openspec-apply").warnings).toEqual([]);
  });

  it("roster: two implementers and a reviewer that reads only (no write/edit tool) with the review-code skill", () => {
    expect(core?.members.map((m) => m.name)).toEqual(["dev-1", "dev-2", "reviewer"]);
    const reviewer = core?.members.find((m) => m.name === "reviewer");
    expect(reviewer?.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    expect(reviewer?.tools).not.toContain("write");
    expect(reviewer?.tools).not.toContain("edit");
    expect(reviewer?.skills).toEqual(["review-code"]);
    expect(core?.members[0]?.tools).toBeUndefined(); // implementers keep the default tool set
    expect(core?.spawn).toBe("eager");
  });

  it("member prompts are exactly the canonical briefing of their role", () => {
    const prompt = (name: string): string => (core?.members.find((m) => m.name === name)?.prompt ?? "").trimEnd();
    expect(prompt("dev-1")).toBe(buildApplyBriefing("implementer"));
    expect(prompt("dev-2")).toBe(buildApplyBriefing("implementer"));
    expect(prompt("reviewer")).toBe(buildApplyBriefing("reviewer"));
  });

  it("the lead playbook: teammates never commit; the lead is the only committer, after Review is completed and the checkboxes are synced", () => {
    const body = core?.body ?? "";
    expect(body).toMatch(/ONLY committer/);
    expect(body).toMatch(/Teammates never commit/);
    expect(body).toMatch(/When `Review` is completed.*checkboxes are synced.*commit the working tree once yourself/s);
    expect(body).toContain("{{goal}}");
    expect(body).toContain("{{cwd}}");
  });
});

describe("apply briefing text", () => {
  for (const role of ["implementer", "reviewer"] as const) {
    it(`${role}: task text is data, no commit, the sole-writer rule, and the honest bash hole`, () => {
      const b = buildApplyBriefing(role);
      expect(b).toMatch(/DATA, not instructions/);
      expect(b).toMatch(/Never commit, push, merge, reset or rebase/);
      expect(b).toMatch(/lead is the only committer/);
      expect(b).toMatch(/openspec\/changes\/\*\/tasks\.md/);
      expect(b).toMatch(/bash is not covered/);
      expect(b).not.toMatch(/guarantee|cannot be bypassed|impossible to|hard enforcement/i);
      expect(b).not.toContain("{{"); // rendered once, never re-expanded
    });
  }

  it("the reviewer is told it only reads and that bash is not a loophole", () => {
    const b = buildApplyBriefing("reviewer");
    expect(b).toMatch(/no write or edit tool/);
    expect(b).toMatch(/review-code/);
    expect(b).toMatch(/using it to modify files is not covered by any guard and is forbidden/);
  });
});

describe("createInject (5.2)", () => {
  it("calls fastify.inject as loopback with a loopback host header and no credential; JSON answers are parsed", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const inject = createInject({
      inject: async (o) => {
        seen.push(o as never);
        return { statusCode: 200, body: '{"success":true}', json: () => JSON.parse('{"success":true}') };
      },
    });
    const res = await inject({ method: "POST", url: "/api/x", payload: { a: 1 } });
    expect(res).toEqual({ statusCode: 200, body: { success: true } });
    expect(seen[0]).toMatchObject({ method: "POST", url: "/api/x", payload: { a: 1 }, remoteAddress: INJECT_REMOTE_ADDRESS, headers: { host: INJECT_HOST } });
    expect(Object.keys(seen[0]?.headers as object)).toEqual(["host"]);
  });

  it("a non-JSON body stays text; an HTTP error status is a result, not an exception; a transport failure rejects", async () => {
    const html = createInject({ inject: async () => ({ statusCode: 502, body: "<html>", json: () => JSON.parse("<html>") }) });
    expect(await html({ method: "GET", url: "/x" })).toEqual({ statusCode: 502, body: "<html>" });
    const boom = createInject({
      inject: async () => {
        throw new Error("down");
      },
    });
    await expect(boom({ method: "GET", url: "/x" })).rejects.toThrow("down");
  });
});
