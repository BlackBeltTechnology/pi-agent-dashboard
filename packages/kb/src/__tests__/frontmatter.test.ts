import { describe, expect, it } from "vitest";
import { buildMeta, buildProperties, DEFAULT_SEARCHABLE_KEYS, parseFrontmatter, strictDate, strictNumber } from "../frontmatter.js";

describe("frontmatter parser (vendored YAML subset)", () => {
  it("E1: CRLF-delimited frontmatter is detected identically to LF", () => {
    const r = parseFrontmatter("---\r\ntitle: X\r\n---\r\n# H\r\nbody");
    expect(r.fm?.title).toBe("X");
    expect(r.body.startsWith("# H")).toBe(true);
    expect(r.body).not.toContain("---");
  });

  it("E2: block list parses to a string array", () => {
    const r = parseFrontmatter("---\ntags:\n  - a\n  - b\n---\nbody");
    expect(r.fm?.tags).toEqual(["a", "b"]);
  });

  it("E3: scalar type coercion (bool / number / string)", () => {
    const r = parseFrontmatter("---\ndraft: true\nn: 42\ns: hi\n---\n");
    expect(r.fm?.draft).toBe(true);
    expect(r.fm?.n).toBe(42);
    expect(r.fm?.s).toBe("hi");
  });

  it("E6: unsupported multiline block scalar falls back (no throw), later keys still parse", () => {
    const r = parseFrontmatter("---\nbody: |\n  multi\n  line\ntitle: T\n---\n");
    expect(r.fm?.title).toBe("T");
    expect(r.fm?.body).toBeUndefined();
  });

  it("E7: malformed frontmatter (no closing fence) → fm null, whole text is body", () => {
    const text = "---\ntitle: X\nno closing fence here";
    const r = parseFrontmatter(text);
    expect(r.fm).toBeNull();
    expect(r.body).toBe(text);
  });

  it("E8: top-level kb: subtree is discarded, rest parses", () => {
    const r = parseFrontmatter("---\nkb:\n  entity: Foo\n  rel: bar\ntitle: T\n---\n");
    expect(r.fm?.title).toBe("T");
    expect(r.fm && "kb" in r.fm).toBe(false);
    expect(r.fm && "entity" in r.fm).toBe(false);
  });

  it("H-BOM: a leading UTF-8 BOM does not hide the frontmatter", () => {
    const r = parseFrontmatter("\uFEFF---\ntitle: T\n---\nbody");
    expect(r.fm?.title).toBe("T");
  });

  it("H-quote: quoted value with a trailing inline comment is unquoted + comment-stripped", () => {
    const r = parseFrontmatter('---\ntitle: "Hello" # a comment\n---\n');
    expect(r.fm?.title).toBe("Hello");
  });

  it("X1: totality + purity on adversarial input (never throws, deterministic)", () => {
    const inputs = [
      "---\n" + "x".repeat(100_000) + "\n---\n",
      "---\n\t\t- weird\n:::\n@#$%^&*()\n---\nbody",
      "---\na:\n  b:\n    c:\n      d: 1\n---\n",
      "\u0000\u0001\u0002 random \uffff bytes ---\n",
      "---\n---\n---\n",
    ];
    for (const t of inputs) {
      let a!: ReturnType<typeof parseFrontmatter>;
      expect(() => { a = parseFrontmatter(t); }).not.toThrow();
      const b = parseFrontmatter(t);
      expect(a).toEqual(b); // pure
      expect(typeof a.body).toBe("string");
    }
  });
});

describe("structural routing (buildMeta / buildProperties / strict typing)", () => {
  it("E4: declared-numeric strict boundary — clean number vs non-number", () => {
    expect(buildProperties({ version: 1.5 }, [{ key: "version", type: "number" }])[0].valueNum).toBe(1.5);
    const row = buildProperties({ version: "1.0.0" }, [{ key: "version", type: "number" }])[0];
    expect(row.value).toBe("1.0.0");
    expect(row.valueNum).toBeNull();
  });

  it("E5: declared-date strict boundary — full YYYY-MM-DD vs partial", () => {
    expect(buildProperties({ date: "2024-01-05" }, [{ key: "date", type: "date" }])[0].valueDate).toBe("2024-01-05");
    expect(buildProperties({ date: "2024-01" }, [{ key: "date", type: "date" }])[0].valueDate).toBeNull();
    expect(strictNumber("12")).toBe(12);
    expect(strictNumber("1.2.3")).toBeNull();
    expect(strictDate("2024-12-31")).toBe("2024-12-31");
    expect(strictDate("nope")).toBeNull();
  });

  it("E9: within-file array duplicates de-dup to a single property row", () => {
    const rows = buildProperties({ tags: ["x", "x", "X"] }, [{ key: "tags" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("x");
  });

  it("E12: tags are excluded from searchable meta but present as a facet", () => {
    const meta = buildMeta({ tags: ["red"], title: "T", description: "d" }, DEFAULT_SEARCHABLE_KEYS);
    expect(meta.title).toBe("T");
    expect(meta.body).toBe("d");
    expect(meta.body).not.toContain("red");
    expect(buildProperties({ tags: ["red"] }, [{ key: "tags" }])[0].value).toBe("red");
  });
});
