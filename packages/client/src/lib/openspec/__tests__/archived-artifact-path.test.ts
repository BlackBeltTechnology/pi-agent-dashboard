/**
 * Active-change path → archived path mapping (test-plan #E2–#E5).
 * See change: fix-archived-session-view-header-and-stale-artifact-tab (D2).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import { describe, expect, it } from "vitest";
import { activeChangeOfPath, archivedArtifactPath } from "../archived-artifact-path.js";

const entry = (name: string): ArchiveEntry => ({ name, date: name.slice(0, 10), artifacts: [] });

describe("activeChangeOfPath", () => {
  it("A1: names the change of an active-change artifact path", () => {
    expect(activeChangeOfPath("openspec/changes/add-x/proposal.md")).toBe("add-x");
    expect(activeChangeOfPath("openspec/changes/add-x/specs/cap/spec.md")).toBe("add-x");
  });

  it("A2: archive, unrelated and bare-dir paths are not active-change paths", () => {
    expect(activeChangeOfPath("openspec/changes/archive/2026-01-01-add-x/proposal.md")).toBeNull();
    expect(activeChangeOfPath("docs/proposal.md")).toBeNull();
    expect(activeChangeOfPath("openspec/changes/add-x")).toBeNull();
  });
});

describe("archivedArtifactPath", () => {
  it("A4: keeps the sub-path under the matching archive entry", () => {
    expect(
      archivedArtifactPath("openspec/changes/add-x/specs/cap/spec.md", [entry("2026-10-22-add-x"), entry("2026-10-22-other")]),
    ).toBe("openspec/changes/archive/2026-10-22-add-x/specs/cap/spec.md");
  });

  it("A5: picks the newest same-name archive regardless of input order", () => {
    const a = entry("2026-03-04-add-x");
    const b = entry("2026-01-02-add-x");
    const p = "openspec/changes/add-x/tasks.md";
    expect(archivedArtifactPath(p, [a, b])).toBe("openspec/changes/archive/2026-03-04-add-x/tasks.md");
    expect(archivedArtifactPath(p, [b, a])).toBe("openspec/changes/archive/2026-03-04-add-x/tasks.md");
  });

  it("A6: exact, regex-escaped name match only", () => {
    expect(
      archivedArtifactPath("openspec/changes/add.x/proposal.md", [entry("2026-10-22-add-x-two"), entry("2026-10-22-addyx")]),
    ).toBeNull();
  });

  it("returns null for a non-change path", () => {
    expect(archivedArtifactPath("src/a.ts", [entry("2026-10-22-add-x")])).toBeNull();
  });
});
