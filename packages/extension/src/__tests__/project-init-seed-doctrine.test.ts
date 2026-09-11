/**
 * DOX-doctrine seeding: the seed is a fixed marker + pointer block (doctrine is
 * injected per turn by the kb extension). See change: inject-dox-doctrine-and-describe.
 * test-plan #E22.
 */

import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDoctrineBlock, DOX_MARKER, seedDoctrine } from "../project-init/seed-doctrine.js";

describe("E22: project-init dox pointer seeding", () => {
  let tmp: string;
  let agentsMd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dox-"));
    agentsMd = path.join(tmp, "AGENTS.md");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("the block is a pointer, not the doctrine text", () => {
    const block = buildDoctrineBlock();
    expect(block).toContain(DOX_MARKER);
    expect(block).toContain("pi-dashboard-kb-extension");
    expect(block).toContain(".pi/dashboard/knowledge_base.json");
    // No legacy section delimiters and no READ table.
    expect(block).not.toMatch(/dox:\w+:start/);
    expect(block).not.toContain("| You're about to");
  });

  it("seeds once; the second call is a byte-identical no-op", () => {
    const first = seedDoctrine(agentsMd);
    expect(first.seeded).toBe(true);
    const afterFirst = readFileSync(agentsMd, "utf8");
    expect(afterFirst).toContain(DOX_MARKER);
    expect(afterFirst).toContain("pi-dashboard-kb-extension");
    expect(afterFirst).toContain(".pi/dashboard/knowledge_base.json");
    expect(afterFirst).not.toMatch(/dox:\w+:start/);

    const second = seedDoctrine(agentsMd);
    expect(second.seeded).toBe(false);
    expect(readFileSync(agentsMd, "utf8")).toBe(afterFirst);
  });

  it("preserves existing AGENTS.md content when appending", () => {
    fs.writeFileSync(agentsMd, "# Project\n\nprose\n");
    seedDoctrine(agentsMd);
    const content = readFileSync(agentsMd, "utf8");
    expect(content).toContain("# Project");
    expect(content).toContain(DOX_MARKER);
  });

  it("no-ops when the marker is already present", () => {
    fs.writeFileSync(agentsMd, `# Existing\n\n${DOX_MARKER}\n\nold pointer\n`);
    const before = readFileSync(agentsMd, "utf8");
    expect(seedDoctrine(agentsMd).seeded).toBe(false);
    expect(readFileSync(agentsMd, "utf8")).toBe(before);
  });
});
