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

  it("kb-wired READ discipline carries the kb substitution table", () => {
    // Spec: kb-read-discipline → "New projects inherit the substitution table"
    // (Scenario: kb-wired seed carries the table).
    const kb = buildDoctrineBlock({ kbWired: true });
    expect(kb).toContain("You're about to"); // the table exists
    expect(kb).toContain("kb_search --doc-type agents"); // symbol-lookup row, named case
    expect(kb).toContain("kb_neighbors"); // chase imports / callers chain-through
    expect(kb).toContain("kb_get"); // read one doc section chain-through
    // Fall-through stays explicit — the table must not read as "kb replaces grep".
    expect(kb).toContain("Fall-through (explicit)");
    expect(kb).toContain("does NOT replace grep");
  });

  it("manual READ discipline carries a degraded same-shape table (no kb tools)", () => {
    // Spec: kb-read-discipline (Scenario: Manual seed carries a degraded table).
    const manual = buildDoctrineBlock({ kbWired: false });
    expect(manual).toContain("You're about to"); // same-shape table exists
    expect(manual).toContain("nearest directory"); // lookup rows walk the AGENTS.md chain
    expect(manual).toContain("Fall-through (explicit)"); // fall-through still explicit
    // Degraded variant references no kb tooling at all.
    expect(manual).not.toContain("kb_neighbors");
    expect(manual).not.toContain("kb_get");
    expect(manual).not.toContain("--doc-type agents");
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
