/**
 * ship-batch SKILL.md contract (test-plan #K1). The skill prose is what an agent
 * follows to launch / inspect / resume the runner, so the prose is what these
 * assertions pin. Style mirrors `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`.
 *
 * See change: add-ship-batch-orchestrator.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_NUDGES,
  DEFAULT_PARALLEL,
  DEFAULT_SETTLE_MS,
  DEFAULT_START_TIMEOUT_MS,
} from "../args.ts";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

describe("#K1 skill contract", () => {
  it("has the frontmatter name and the trigger phrases", () => {
    expect(SKILL).toMatch(/^---\nname: ship-batch\n/);
    const description = /^description: (.*)$/m.exec(SKILL)?.[1] ?? "";
    expect(description).toContain("ship the group");
    expect(description).toContain("batch ship-it");
  });

  it("documents the defaults the code actually uses", () => {
    expect(SKILL).toMatch(new RegExp(`\`--parallel N\` \\| \`${DEFAULT_PARALLEL}\``));
    expect(SKILL).toMatch(/`--max-live M` \| `2×N`/);
    expect(SKILL).toMatch(new RegExp(`\`--model <ref>\` \\| \`${DEFAULT_MODEL}\``));
    expect(SKILL).toMatch(new RegExp(`\`--nudges K\` \\| \`${DEFAULT_NUDGES}\``));
    expect(SKILL).toMatch(new RegExp(`\`--settle <dur>\` \\| \`${DEFAULT_SETTLE_MS / 1000}s\``));
    expect(SKILL).toMatch(new RegExp(`\`--start-timeout <dur>\` \\| \`${DEFAULT_START_TIMEOUT_MS / 60_000}m\``));
  });

  it("states the two hard guardrails", () => {
    expect(SKILL).toMatch(/Never answer questions/);
    expect(SKILL).toMatch(/Never remove a worktree with unpushed work/);
    expect(SKILL).toMatch(/Never auto-trust the init hook/);
  });

  it("explains detached launch, --status and resume", () => {
    expect(SKILL).toMatch(/nohup npx tsx \.pi\/skills\/ship-batch\/scripts\/ship-batch\.ts --group <id\|name>.*&/);
    expect(SKILL).toContain("--status");
    expect(SKILL).toMatch(/\*\*Resume\*\*/);
    expect(SKILL).toMatch(/never spawns a second session/);
  });

  it("documents the exit codes and the teardown table", () => {
    expect(SKILL).toMatch(/`0` every change `shipped`/);
    expect(SKILL).toMatch(/`2` any `kept \| incomplete \| failed \| skipped`/);
    expect(SKILL).toContain("## Teardown");
    expect(SKILL).toContain("wip(ship-batch)");
  });
});
