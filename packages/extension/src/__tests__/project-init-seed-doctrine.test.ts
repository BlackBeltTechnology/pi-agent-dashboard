/**
 * DOX-doctrine seeding: marker-gated idempotency + kb-wired vs manual READ variant.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDoctrineBlock, seedDoctrine, DOX_MARKER, doctrinePath } from "../project-init/seed-doctrine.js";

describe("project-init dox doctrine seeding", () => {
  let tmp: string;
  let agentsMd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dox-"));
    agentsMd = path.join(tmp, "AGENTS.md");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("kb-wired seed references kb_search / kb agents; manual does not", () => {
    const kb = buildDoctrineBlock({ kbWired: true });
    const manual = buildDoctrineBlock({ kbWired: false });
    expect(kb).toContain("kb_search");
    expect(kb).toContain("kb agents");
    expect(manual).not.toContain("kb_search");
    expect(manual).not.toContain("kb agents");
  });

  it("both variants carry the WRITE size-split rule", () => {
    for (const kbWired of [true, false]) {
      const block = buildDoctrineBlock({ kbWired });
      expect(block).toContain(".AGENTS.md");
      expect(block.toLowerCase()).toContain("split");
    }
  });

  it("seeds once when the marker is absent", () => {
    const res = seedDoctrine(agentsMd, { kbWired: true });
    expect(res.seeded).toBe(true);
    const content = fs.readFileSync(agentsMd, "utf8");
    expect(content).toContain(DOX_MARKER);
  });

  it("no-ops when the marker is already present", () => {
    fs.writeFileSync(agentsMd, `# Existing\n\n${DOX_MARKER}\n\nold doctrine\n`);
    const before = fs.readFileSync(agentsMd, "utf8");
    const res = seedDoctrine(agentsMd, { kbWired: true });
    expect(res.seeded).toBe(false);
    expect(fs.readFileSync(agentsMd, "utf8")).toBe(before);
  });

  it("re-running never double-seeds", () => {
    seedDoctrine(agentsMd, { kbWired: false });
    seedDoctrine(agentsMd, { kbWired: false });
    seedDoctrine(agentsMd, { kbWired: false });
    const markers = fs.readFileSync(agentsMd, "utf8").split(DOX_MARKER).length - 1;
    expect(markers).toBe(1);
  });

  it("preserves existing AGENTS.md content when appending", () => {
    fs.writeFileSync(agentsMd, "# Project\n\nprose\n");
    seedDoctrine(agentsMd, { kbWired: true });
    const content = fs.readFileSync(agentsMd, "utf8");
    expect(content).toContain("# Project");
    expect(content).toContain(DOX_MARKER);
  });

  it("the shipped doctrine file exists and defines all three sections", () => {
    const raw = fs.readFileSync(doctrinePath(), "utf8");
    expect(raw).toContain("dox:write:start");
    expect(raw).toContain("dox:read:kb:start");
    expect(raw).toContain("dox:read:manual:start");
  });
});
