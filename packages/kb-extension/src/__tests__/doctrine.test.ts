// Pure doctrine module (change: inject-dox-doctrine-and-describe,
// test-plan #E9–#E12). Decision table and legacy detection.
import { describe, expect, it } from "vitest";
import {
  buildDoctrineFragment,
  DOX_DELIMITER,
  hasLegacySeed,
  loadDoctrineSections,
} from "../doctrine.js";

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

// E13–E17 (cwd-anchor insertion + composition with the bridge splice) removed:
// the hook now writes the structured `dox_doctrine` section; coexistence with
// the bridge is covered at the pi boundary by
// packages/extension/src/__tests__/system-prompt-structured-contributions.test.ts.
// See change: fix-forced-system-prompt-drops-tool-guidelines.
