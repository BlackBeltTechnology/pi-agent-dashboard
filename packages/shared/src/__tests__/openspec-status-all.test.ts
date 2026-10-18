/**
 * Pure `status --all` helpers: envelope classification (#E2–#E4), error
 * sanitization BVA (#E5), unknown entry (#E6), task-line counting (#E7),
 * canonical order (#E9) and the unsupported-CLI cache (#E15).
 * See change: use-openspec-status-all.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalArtifactOrder,
  classifyStatusAll,
  computeTrackedExtras,
  countTasksFromContent,
  createStatusAllSupportCache,
  entryError,
  mapCliPath,
  matchesOutputPattern,
  type StatusAllRaw,
  sanitizeChangeError,
} from "../openspec-status-all.js";

const raw = (over: Partial<StatusAllRaw>): StatusAllRaw => ({ stdout: "", stderr: "", exitCode: 0, ...over });
const okEnvelope = (entries: unknown[] = []) =>
  JSON.stringify({ changes: entries, root: { path: "/repo", source: "nearest" } });

describe("classifyStatusAll", () => {
  it("#E1 partial failure: exit 1 with full JSON is success with a per-change error", () => {
    const entries = [
      { changeName: "good", artifacts: [{ id: "proposal", status: "done" }] },
      { changeName: "bad", status: [{ severity: "error", code: "change_error", message: "Invalid YAML" }] },
    ];
    const c = classifyStatusAll(raw({ stdout: okEnvelope(entries), exitCode: 1 }));
    expect(c.kind).toBe("ok");
    if (c.kind !== "ok") return;
    expect(c.entries).toHaveLength(2);
    expect(entryError(c.entries[0])).toBeNull();
    expect(entryError(c.entries[1])).toEqual({ code: "change_error", message: "Invalid YAML" });
  });

  it("#E2 root:null with a top-level error status is a whole-call failure", () => {
    const stdout = JSON.stringify({
      changes: [],
      root: null,
      status: [{ severity: "error", code: "invalid_store_pointer", message: "x" }],
    });
    expect(classifyStatusAll(raw({ stdout, exitCode: 1 })).kind).toBe("failed");
  });

  it("#E2 root:null alone is a whole-call failure", () => {
    expect(classifyStatusAll(raw({ stdout: JSON.stringify({ changes: [], root: null }) })).kind).toBe("failed");
  });

  it("#E3 implicit root is a whole-call failure even with exit 0", () => {
    const stdout = JSON.stringify({ changes: [], root: { source: "implicit", path: "/x" } });
    expect(classifyStatusAll(raw({ stdout, exitCode: 0 })).kind).toBe("failed");
  });

  it("#E4 no JSON at all is a failure, not an empty list", () => {
    expect(classifyStatusAll(raw({ stdout: "Error: boom", exitCode: 1 })).kind).toBe("failed");
    expect(classifyStatusAll(raw({ stdout: "", exitCode: 0 })).kind).toBe("failed");
  });

  it("tolerates a non-JSON preamble before the body", () => {
    const stdout = `Telemetry notice\n${okEnvelope([{ changeName: "a", artifacts: [] }])}`;
    expect(classifyStatusAll(raw({ stdout })).kind).toBe("ok");
  });

  it("a spawn-level failure (timeout) is a failure regardless of partial stdout", () => {
    expect(classifyStatusAll(raw({ stdout: okEnvelope(), failure: "timeout", exitCode: null })).kind).toBe("failed");
  });

  describe("#E15 unsupported-CLI decision table", () => {
    const text = "error: unknown option '--all'";
    it("stderr text, no JSON → unsupported", () => {
      expect(classifyStatusAll(raw({ stderr: text, exitCode: 1 })).kind).toBe("unsupported");
    });
    it("stdout text, no JSON → unsupported", () => {
      expect(classifyStatusAll(raw({ stdout: text, exitCode: 1 })).kind).toBe("unsupported");
    });
    it("text alongside a JSON body → NOT unsupported", () => {
      const c = classifyStatusAll(raw({ stdout: okEnvelope(), stderr: text, exitCode: 1 }));
      expect(c.kind).toBe("ok");
    });
    it("a timeout is never an unsupported verdict", () => {
      expect(classifyStatusAll(raw({ stderr: text, failure: "timeout" })).kind).toBe("failed");
    });
  });
});

describe("sanitizeChangeError (#E5)", () => {
  it.each([499, 500])("message of %i chars is unchanged", (n) => {
    const m = "a".repeat(n);
    expect(sanitizeChangeError("c", m).message).toBe(m);
  });
  it.each([501, 4000])("message of %i chars is truncated to 500", (n) => {
    expect(sanitizeChangeError("c", "a".repeat(n)).message).toHaveLength(500);
  });
  it("collapses onto one line and strips control characters", () => {
    const out = sanitizeChangeError("c", "line1\nline2\r\n\u001b[31mred\u0007");
    expect(out.message).toBe("line1 line2 [31mred");
    expect(out.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });
  it("code ≤ 64 chars, controls stripped", () => {
    expect(sanitizeChangeError("c".repeat(64), "m").code).toHaveLength(64);
    expect(sanitizeChangeError("c".repeat(100), "m").code).toHaveLength(64);
    expect(sanitizeChangeError("a\nb\u001b", "m").code).toBe("ab");
  });
  it("does not end on a lone high surrogate", () => {
    const out = sanitizeChangeError("c", `${"a".repeat(499)}😀`).message;
    expect(out).toHaveLength(499);
  });
});

describe("entryError", () => {
  it("#E6 entry with neither artifacts nor status maps to unknown-entry", () => {
    expect(entryError({ changeName: "odd" })?.code).toBe("unknown-entry");
  });
  it("healthy entry has no error", () => {
    expect(entryError({ changeName: "a", artifacts: [] })).toBeNull();
  });
});

describe("countTasksFromContent (#E7)", () => {
  it("counts indented, starred, X and CRLF lines (fenced lines included)", () => {
    const content = [
      "- [ ] 1.1 a",
      "- [x] 1.2 b",
      "  - [X] 1.2.1 sub",
      "  - [ ] 1.2.2 sub",
      "* [x] star",
      "```",
      "- [ ] fenced",
      "```",
      "- [x] crlf\r",
      "not a task",
    ].join("\n");
    expect(countTasksFromContent(content)).toEqual({ total: 7, completed: 4 });
  });
  it("matches the base fixture of 34 top-level + 3 indented (16 done)", () => {
    const lines = [
      ...Array.from({ length: 34 }, (_, i) => `- [${i < 13 ? "x" : " "}] t${i}`),
      "  - [x] s1",
      "  - [x] s2",
      "  - [x] s3",
    ];
    expect(countTasksFromContent(lines.join("\n"))).toEqual({ total: 37, completed: 16 });
  });
});

describe("canonicalArtifactOrder (#E9)", () => {
  it("proposal, design, specs, tasks, then extras in CLI order", () => {
    const cli = ["proposal", "specs", "dependencies", "design", "tasks"].map((id) => ({ id }));
    expect(canonicalArtifactOrder(cli).map((a) => a.id)).toEqual([
      "proposal",
      "design",
      "specs",
      "tasks",
      "dependencies",
    ]);
  });
  it("only present ids are emitted", () => {
    expect(canonicalArtifactOrder([{ id: "tasks" }, { id: "proposal" }]).map((a) => a.id)).toEqual(["proposal", "tasks"]);
  });
});

describe("createStatusAllSupportCache (#E15)", () => {
  it("no retry while the package version is unchanged", () => {
    const c = createStatusAllSupportCache();
    expect(c.isKnownUnsupported("1.0.0", false)).toBe(false);
    c.markUnsupported("1.0.0");
    expect(c.isKnownUnsupported("1.0.0", false)).toBe(true);
    expect(c.isKnownUnsupported("1.0.0", true)).toBe(true);
  });
  it("a changed version retries `--all`", () => {
    const c = createStatusAllSupportCache();
    c.markUnsupported("1.0.0");
    expect(c.isKnownUnsupported("1.1.0", false)).toBe(false);
    expect(c.isKnownUnsupported("1.0.0", false)).toBe(false); // verdict was cleared
  });
  it("unresolvable version: cached for the process, retried on force refresh", () => {
    const c = createStatusAllSupportCache();
    c.markUnsupported(null);
    expect(c.isKnownUnsupported(null, false)).toBe(true);
    expect(c.isKnownUnsupported(null, true)).toBe(false);
    expect(c.isKnownUnsupported(null, false)).toBe(true);
  });
});

describe("mapCliPath / computeTrackedExtras (#E14)", () => {
  const root = "/private/tmp/repo";
  const canon = "/private/tmp/repo/openspec";
  it("maps CLI paths onto the canonical openspec dir", () => {
    expect(mapCliPath(`${root}/openspec/changes/a/tasks.md`, root, canon)).toBe(`${canon}/changes/a/tasks.md`);
    expect(mapCliPath(`${root}/openspec/changes/a/tasks.md`, root, "/tmp/other/openspec")).toBe(
      "/tmp/other/openspec/changes/a/tasks.md",
    );
  });
  it("ignores escaping and non-openspec paths", () => {
    expect(mapCliPath(`${root}/../../etc/x`, root, canon)).toBeNull();
    expect(mapCliPath("/etc/passwd", root, canon)).toBeNull();
    expect(mapCliPath(`${root}/src/a.ts`, root, canon)).toBeNull();
  });
  it("extras cover existing outputs, parents, literal outputs and glob prefixes", () => {
    const changeDir = `${canon}/changes/a`;
    const extras = computeTrackedExtras(
      {
        changeName: "a",
        changeRoot: `${root}/openspec/changes/a`,
        artifactPaths: {
          proposal: {
            outputPath: "proposal.md",
            resolvedOutputPath: `${root}/openspec/changes/a/proposal.md`,
            existingOutputPaths: [`${root}/openspec/changes/a/proposal.md`],
          },
          dependencies: {
            outputPath: "dependencies.yaml",
            resolvedOutputPath: `${root}/openspec/changes/a/dependencies.yaml`,
            existingOutputPaths: [],
          },
          specs: {
            outputPath: "specs/**/*.md",
            resolvedOutputPath: `${root}/openspec/changes/a/specs/**/*.md`,
            existingOutputPaths: [`${root}/../../etc/x`],
          },
        },
      },
      root,
      canon,
      changeDir,
    );
    expect(extras.files).toContain(`${changeDir}/proposal.md`);
    expect(extras.files).toContain(changeDir);
    expect(extras.files).toContain(`${changeDir}/dependencies.yaml`); // not yet created
    expect(extras.files.some((f) => f.includes("etc"))).toBe(false); // escaping path ignored
    expect(extras.globPrefixes).toEqual([`${changeDir}/specs`]);
    expect(extras.outputs.sort()).toEqual(["dependencies.yaml", "proposal.md", "specs/**/*.md"]);
  });
});

describe("matchesOutputPattern", () => {
  it("literal and glob outputs", () => {
    expect(matchesOutputPattern("dependencies.yaml", "dependencies.yaml")).toBe(true);
    expect(matchesOutputPattern("other.yaml", "dependencies.yaml")).toBe(false);
    expect(matchesOutputPattern("specs/cap/spec.md", "specs/**/*.md")).toBe(true);
    expect(matchesOutputPattern("specs/spec.md", "specs/**/*.md")).toBe(true);
    expect(matchesOutputPattern("specs/cap/README.txt", "specs/**/*.md")).toBe(false);
    expect(matchesOutputPattern("specs\\cap\\spec.md", "specs/**/*.md")).toBe(true);
  });
});
