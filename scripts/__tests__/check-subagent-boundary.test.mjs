/**
 * Subagent boundary gate (`scripts/check-subagent-boundary.mjs`): tmp-tree
 * fixtures (test-plan #E39) and the real-tree check (#E40).
 *
 * #E40 runs the CLI over the repo's own tree with the checked-in allowlist, the
 * same invocation `npm test` makes first.
 *
 * See change: move-subagents-to-plugin (D9, tasks 11.5, 11.6).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-subagent-boundary.mjs");
const ALLOWLIST = "scripts/subagent-boundary-allowlist.json";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-boundary-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe("check-subagent-boundary — fixtures (#E39)", () => {
  it("fails on `case \"subagent_completed\":` in browser-gateway.ts, naming file:line", () => {
    const root = makeTree({
      "packages/server/src/pairing/browser-gateway.ts": 'switch (t) {\n  case "subagent_completed":\n    break;\n}\n',
    });
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/server/src/pairing/browser-gateway.ts:2");
  });

  it('passes on a "Max parallel subagents" label', () => {
    const root = makeTree({
      "packages/client/src/components/Label.tsx": 'export const label = "Max parallel subagents";\n',
    });
    const r = run(root);
    expect(r.code).toBe(0);
  });

  it("fails on SUBAGENTSTATE (case-insensitive), naming file:line", () => {
    const root = makeTree({
      "packages/shared/src/types.ts": "export type A = 1;\nexport type B = SUBAGENTSTATE;\n",
    });
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/shared/src/types.ts:2");
  });

  it("passes `/api/plugins/subagents/` in route-tiers.ts, with an allowlist entry", () => {
    const root = makeTree({
      "packages/shared/src/route-tiers.ts": '{ path: "/api/plugins/subagents/limits", tier: "observe" },\n',
      [ALLOWLIST]: {
        entries: [{ file: "packages/shared/src/route-tiers.ts", pattern: "plugins/subagents/", reason: "route-tier registry" }],
      },
    });
    expect(run(root).code).toBe(0);
  });

  it("an allowlist row forgives only its own file and pattern", () => {
    const root = makeTree({
      "packages/shared/src/custom-event-groups.ts": 'x = "^subagents:";\n',
      "packages/server/src/other.ts": 'x = "^subagents:";\n',
      [ALLOWLIST]: {
        entries: [{ file: "packages/shared/src/custom-event-groups.ts", pattern: "\\^subagents:", reason: "registry" }],
      },
    });
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("packages/server/src/other.ts:1");
    expect(r.out).not.toContain("custom-event-groups.ts:1");
  });

  it("exempts tests, generated and i18n", () => {
    const root = makeTree({
      "packages/server/src/__tests__/a.test.ts": 'x = "subagent_completed";\n',
      "packages/client/src/foo.test.tsx": 'x = "subagents:";\n',
      "packages/client/src/generated/registry.tsx": "x.subagents;\n",
      "packages/client/src/i18n/en.ts": 'x = "subagent_started";\n',
    });
    expect(run(root).code).toBe(0);
  });
});

describe("check-subagent-boundary — real tree (#E40)", () => {
  it("the change's final tree is clean", () => {
    const r = run(REPO_ROOT);
    expect(r.out).not.toMatch(/violation/);
    expect(r.code).toBe(0);
  });
});
