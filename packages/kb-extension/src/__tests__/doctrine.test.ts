// Pure doctrine module (change: inject-dox-doctrine-and-describe,
// test-plan #E9–#E17). Decision table, legacy detection, insertion, and
// composition with the REAL dashboard bridge splice.
import { describe, expect, it } from "vitest";
import { spliceContextFragment } from "../../../extension/src/dashboard-context-injector.js";
import {
  buildDoctrineFragment,
  DOX_DELIMITER,
  hasLegacySeed,
  insertFragment,
  loadDoctrineSections,
} from "../doctrine.js";

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("E9: buildDoctrineFragment decision table", () => {
  const read = () => loadDoctrineSections();

  it("{kb,false} → delimiter + READ, no WRITE heading", () => {
    const frag = buildDoctrineFragment({ inject: "kb", write: false, sections: read() });
    expect(frag).toContain(DOX_DELIMITER);
    expect(frag).toContain(read().read.slice(0, 40));
    expect(frag).not.toContain("Documentation Update Protocol (WRITE discipline)");
  });

  it("{kb,true} → READ + WRITE", () => {
    const frag = buildDoctrineFragment({ inject: "kb", write: true, sections: read() });
    expect(frag).toContain(read().read.slice(0, 40));
    expect(frag).toContain("Documentation Update Protocol (WRITE discipline)");
  });

  it("{off,false} and {off,true} → empty", () => {
    expect(buildDoctrineFragment({ inject: "off", write: false, sections: read() })).toBe("");
    expect(buildDoctrineFragment({ inject: "off", write: true, sections: read() })).toBe("");
  });
});

describe("E10–E12: hasLegacySeed", () => {
  it("E10: delimiter without marker → true (half migration)", () => {
    expect(hasLegacySeed([{ path: "AGENTS.md", content: "<!-- dox:write:start -->\nX\n<!-- dox:write:end -->" }])).toBe(true);
  });

  it("E11: pointer block (marker, no delimiter) → false", () => {
    expect(hasLegacySeed([{ path: "AGENTS.md", content: "<!-- dox-doctrine -->\nsee the kb extension" }])).toBe(false);
  });

  it("E12: manual variant delimiter → true", () => {
    expect(hasLegacySeed([{ content: "<!-- dox:read:manual:start -->\nX" }])).toBe(true);
  });

  it("no context files → false", () => {
    expect(hasLegacySeed(undefined)).toBe(false);
    expect(hasLegacySeed([])).toBe(false);
  });
});

describe("E13–E15: insertion", () => {
  const frag = "── dox doctrine ──\n\n## Finding docs (READ discipline)\nbody";

  it("E13: inserted before the anchor; anchor line preserved verbatim", () => {
    const sp = "A\nCurrent working directory: /x\n";
    const out = insertFragment(sp, frag);
    expect(out.indexOf(frag)).toBeLessThan(out.indexOf("\nCurrent working directory: "));
    expect(out).toContain("\nCurrent working directory: /x\n");
  });

  it("E14: no anchor → appended after a blank line", () => {
    expect(insertFragment("A", frag)).toBe(`A\n\n${frag}`);
  });

  it("E15: running twice leaves exactly one delimiter", () => {
    const sp = "A\nCurrent working directory: /x\n";
    const once = insertFragment(sp, frag);
    const twice = insertFragment(once, frag);
    expect(count(twice, DOX_DELIMITER)).toBe(1);
    expect(twice).toBe(once);
  });
});

describe("E16–E17: coexists with the real bridge spliceContextFragment", () => {
  const frag = "── dox doctrine ──\n\n## Finding docs (READ discipline)\nbody";
  const base = "A\nCurrent working directory: /x\n";

  it("E16: kb handler THEN bridge — both fragments survive", () => {
    const out = spliceContextFragment(insertFragment(base, frag), "sid-1", "/x", null);
    expect(out).toContain(DOX_DELIMITER);
    expect(out).toContain("You are pi session");
    expect(count(out, DOX_DELIMITER)).toBe(1);
    expect(count(out, "You are pi session")).toBe(1);
  });

  it("E17: bridge THEN kb handler — both fragments survive", () => {
    const out = insertFragment(spliceContextFragment(base, "sid-1", "/x", null), frag);
    expect(out).toContain(DOX_DELIMITER);
    expect(out).toContain("You are pi session");
    expect(count(out, DOX_DELIMITER)).toBe(1);
    expect(count(out, "You are pi session")).toBe(1);
  });
});
