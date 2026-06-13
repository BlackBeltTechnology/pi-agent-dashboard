import { describe, it, expect } from "vitest";
import { tokenize, MAX_LINKS, type Token } from "../linkify-tool-output.js";

/** Helper: collect tokens of a given kind. */
const ofKind = (toks: Token[], kind: Token["kind"]) => toks.filter((t) => t.kind === kind);
/** Helper: rebuild the original string from a token stream. */
const concat = (toks: Token[]) => toks.map((t) => t.text).join("");

describe("tokenize — URLs", () => {
  it("detects a bare https URL", () => {
    const input = "visit https://example.com/foo and stop";
    const toks = tokenize(input);
    const urls = ofKind(toks, "url");
    expect(urls).toHaveLength(1);
    expect(urls[0].text).toBe("https://example.com/foo");
    expect(concat(toks)).toBe(input);
  });

  it("strips trailing punctuation from URLs", () => {
    const toks = tokenize("see https://example.com/page.");
    const url = ofKind(toks, "url")[0];
    expect(url.text).toBe("https://example.com/page");
    expect(concat(toks)).toBe("see https://example.com/page.");
  });

  it("strips multiple trailing punctuation chars", () => {
    const toks = tokenize("really? https://example.com/foo!?,");
    const url = ofKind(toks, "url")[0];
    expect(url.text).toBe("https://example.com/foo");
    expect(concat(toks)).toBe("really? https://example.com/foo!?,");
  });

  it("rejects javascript: scheme", () => {
    const toks = tokenize("click javascript:alert(1) now");
    expect(ofKind(toks, "url")).toHaveLength(0);
    expect(ofKind(toks, "file")).toHaveLength(0);
    expect(concat(toks)).toBe("click javascript:alert(1) now");
  });

  it("rejects data: scheme", () => {
    const toks = tokenize("data:text/html,<script>");
    expect(ofKind(toks, "url")).toHaveLength(0);
    expect(concat(toks)).toBe("data:text/html,<script>");
  });

  it("rejects vbscript: and file: schemes", () => {
    expect(ofKind(tokenize("vbscript:foo()"), "url")).toHaveLength(0);
    expect(ofKind(tokenize("file:///etc/passwd"), "url")).toHaveLength(0);
  });

  it("detects http URLs (not just https)", () => {
    const toks = tokenize("http://localhost:8080/x");
    expect(ofKind(toks, "url")[0].text).toBe("http://localhost:8080/x");
  });
});

describe("tokenize — file path with line(:col)", () => {
  it("detects grep-style path:line:col", () => {
    const toks = tokenize("src/foo.ts:42:7: error TS2322");
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(1);
    const f = files[0] as Extract<Token, { kind: "file" }>;
    expect(f.text).toBe("src/foo.ts:42:7");
    expect(f.path).toBe("src/foo.ts");
    expect(f.line).toBe(42);
    expect(f.col).toBe(7);
    expect(concat(toks)).toBe("src/foo.ts:42:7: error TS2322");
  });

  it("detects path:line without col", () => {
    const toks = tokenize("at src/bar.js:120");
    const f = ofKind(toks, "file")[0] as Extract<Token, { kind: "file" }>;
    expect(f.text).toBe("src/bar.js:120");
    expect(f.path).toBe("src/bar.js");
    expect(f.line).toBe(120);
    expect(f.col).toBeUndefined();
  });

  it("detects parent-traversal relative path", () => {
    const toks = tokenize("../pkg/baz.tsx:5");
    const f = ofKind(toks, "file")[0] as Extract<Token, { kind: "file" }>;
    expect(f.path).toBe("../pkg/baz.tsx");
    expect(f.line).toBe(5);
  });

  it("emits multiple matches across a multi-line grep result", () => {
    const input = "src/foo.ts:42:7: error\nsrc/bar.ts:9: warning";
    const toks = tokenize(input);
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(2);
    expect(concat(toks)).toBe(input);
  });
});

describe("tokenize — bare path with known extension", () => {
  it("detects path with separator", () => {
    const toks = tokenize("wrote packages/client/src/foo.ts");
    const f = ofKind(toks, "file")[0] as Extract<Token, { kind: "file" }>;
    expect(f.text).toBe("packages/client/src/foo.ts");
    expect(f.path).toBe("packages/client/src/foo.ts");
    expect(f.line).toBeUndefined();
  });

  it("detects leading ./", () => {
    const toks = tokenize("./bar.tsx");
    const f = ofKind(toks, "file")[0] as Extract<Token, { kind: "file" }>;
    expect(f.text).toBe("./bar.tsx");
  });

  it("detects leading ../", () => {
    const toks = tokenize("see ../pkg/baz.md");
    const f = ofKind(toks, "file")[0] as Extract<Token, { kind: "file" }>;
    expect(f.text).toBe("../pkg/baz.md");
  });

  it("does NOT detect bare filename with no separator (README.md alone)", () => {
    // Spec: MAY be detected. We choose MUST NOT for tier-1 conservatism.
    // A bare `README.md` token without leading `./` or path separator MUST NOT
    // produce a file link to avoid prose false positives like "see README.md".
    const toks = tokenize("see README.md for info");
    expect(ofKind(toks, "file")).toHaveLength(0);
  });
});

describe("tokenize — absolute / file:// / Windows-drive", () => {
  type FileTok = Extract<Token, { kind: "file" }>;

  it("falls back to plain text on malformed percent-encoding in file:// URI", () => {
    const input = "file:///tmp/bad%ZZ.ts";
    const toks = tokenize(input);
    expect(ofKind(toks, "file")).toHaveLength(0);
    expect(concat(toks)).toBe(input);
  });

  it("detects Windows file URI form file:///C:/... as absolute", () => {
    const toks = tokenize("file:///C:/src/app.ts:9");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("C:/src/app.ts");
    expect(f.line).toBe(9);
    expect(f.absolute).toBe(true);
  });

  it("detects a bare absolute POSIX path with root preserved", () => {
    const input = "see /Users/me/app.ts for details";
    const toks = tokenize(input);
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.text).toBe("/Users/me/app.ts");
    expect(f.path).toBe("/Users/me/app.ts");
    expect(f.absolute).toBe(true);
    expect(concat(toks)).toBe(input);
  });

  it("decodes a file:// URI (percent-encoded) to a native path", () => {
    const toks = tokenize("file:///Users/me/my%20app.ts");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("/Users/me/my app.ts");
    expect(f.absolute).toBe(true);
    expect(ofKind(toks, "url")).toHaveLength(0);
    expect(concat(toks)).toBe("file:///Users/me/my%20app.ts");
  });

  it("spans dot-directory segments in an absolute path (.git, .worktrees)", () => {
    const input = "at /Users/me/.config/app/.worktrees/x/main.ts:8";
    const toks = tokenize(input);
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("/Users/me/.config/app/.worktrees/x/main.ts");
    expect(f.line).toBe(8);
    expect(f.absolute).toBe(true);
    expect(concat(toks)).toBe(input);
  });

  it("parses absolute path with :line:col", () => {
    const toks = tokenize("/Users/me/app.ts:42:7: error");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("/Users/me/app.ts");
    expect(f.line).toBe(42);
    expect(f.col).toBe(7);
    expect(f.absolute).toBe(true);
    expect(concat(toks)).toBe("/Users/me/app.ts:42:7: error");
  });

  it("detects a Windows drive path", () => {
    const input = "open C:\\src\\app.ts:10 now";
    const toks = tokenize(input);
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("C:\\src\\app.ts");
    expect(f.line).toBe(10);
    expect(f.absolute).toBe(true);
    expect(concat(toks)).toBe(input);
  });

  it("does not parse the Windows drive colon as a line separator", () => {
    const toks = tokenize("C:/src/app.ts");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("C:/src/app.ts");
    expect(f.line).toBeUndefined();
  });

  it("verbatim coverage holds for mixed absolute input", () => {
    const input = "wrote /Users/me/a.ts and file:///tmp/b.ts and C:\\c.ts:3 done";
    const toks = tokenize(input);
    expect(concat(toks)).toBe(input);
    expect(ofKind(toks, "file")).toHaveLength(3);
  });
});

describe("tokenize — generic extensions and dot-directories", () => {
  type FileTok = Extract<Token, { kind: "file" }>;

  it("detects leading dot-directory and does not truncate .json to .js", () => {
    const input = ".pi/settings.json";
    const toks = tokenize(input);
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(1);
    const f = files[0] as FileTok;
    expect(f.path).toBe(".pi/settings.json");
    expect(f.absolute).toBeFalsy();
    expect(concat(toks)).toBe(input);
    // no stray `on` text token
    expect(ofKind(toks, "text")).toHaveLength(0);
  });

  it("does not truncate src/data.json to src/data.js", () => {
    const toks = tokenize("src/data.json");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("src/data.json");
  });

  it("detects multi-segment leading dot-directory (.github/workflows)", () => {
    const input = ".github/workflows/ci.yml";
    const toks = tokenize(input);
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe(".github/workflows/ci.yml");
    expect(f.absolute).toBeFalsy();
    expect(concat(toks)).toBe(input);
  });

  it("detects interior dot-directory as a single relative token", () => {
    const input = "a/.config/b.ts";
    const toks = tokenize(input);
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(1);
    const f = files[0] as FileTok;
    expect(f.path).toBe("a/.config/b.ts");
    expect(f.absolute).toBeFalsy();
    expect(concat(toks)).toBe(input);
  });

  it("detects multi-level parent traversal without dropping leading ..", () => {
    const input = "../../packages/server/src/cli.ts";
    const toks = tokenize(input);
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(1);
    const f = files[0] as FileTok;
    expect(f.path).toBe("../../packages/server/src/cli.ts");
    expect(f.absolute).toBeFalsy();
    expect(concat(toks)).toBe(input);
  });

  it("detects unlisted text extension with line suffix", () => {
    const toks = tokenize("config/app.toml:12");
    const f = ofKind(toks, "file")[0] as FileTok;
    expect(f.path).toBe("config/app.toml");
    expect(f.line).toBe(12);
  });

  it("detects unlisted text extensions with separator", () => {
    const input = "wrote scripts/setup.lua and config/db.sql";
    const toks = tokenize(input);
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(2);
    expect((files[0] as FileTok).path).toBe("scripts/setup.lua");
    expect((files[1] as FileTok).path).toBe("config/db.sql");
    expect(concat(toks)).toBe(input);
  });

  it("does not detect bare Node.js or README.md in prose", () => {
    const toks = tokenize("the Node.js runtime and README.md docs");
    expect(ofKind(toks, "file")).toHaveLength(0);
  });
});

describe("tokenize — negative cases", () => {
  it("does not match version 1.0.0", () => {
    const toks = tokenize("installed v1.2.3 of foo and version 1.0.0 today");
    expect(ofKind(toks, "file")).toHaveLength(0);
    expect(ofKind(toks, "url")).toHaveLength(0);
  });

  it("does not match and/or", () => {
    const toks = tokenize("decide and/or skip");
    expect(ofKind(toks, "file")).toHaveLength(0);
  });

  it("does not match math.PI", () => {
    const toks = tokenize("compute math.PI radius");
    expect(ofKind(toks, "file")).toHaveLength(0);
  });

  it("does not match bare 1.2.3", () => {
    const toks = tokenize("update to 1.2.3 today");
    expect(ofKind(toks, "file")).toHaveLength(0);
  });
});

describe("tokenize — precedence and coverage", () => {
  it("URL beats path-shaped tail", () => {
    const input = "https://example.com/src/foo.ts";
    const toks = tokenize(input);
    expect(ofKind(toks, "url")).toHaveLength(1);
    expect(ofKind(toks, "file")).toHaveLength(0);
    expect(toks[0].text).toBe(input);
  });

  it("path-with-line beats bare path-with-ext for same span", () => {
    const toks = tokenize("src/foo.ts:42");
    const files = ofKind(toks, "file");
    expect(files).toHaveLength(1);
    const f = files[0] as Extract<Token, { kind: "file" }>;
    expect(f.line).toBe(42);
    expect(f.path).toBe("src/foo.ts");
  });

  it("coverage holds for mixed input", () => {
    const input =
      "see https://example.com/x. error in src/foo.ts:42:7. wrote ./bar.tsx done.";
    const toks = tokenize(input);
    expect(concat(toks)).toBe(input);
    expect(ofKind(toks, "url")).toHaveLength(1);
    expect(ofKind(toks, "file").length).toBeGreaterThanOrEqual(2);
  });

  it("coverage holds for input with no matches", () => {
    const input = "no matches here, only prose with version 1.2.3";
    const toks = tokenize(input);
    expect(concat(toks)).toBe(input);
    expect(toks.every((t) => t.kind === "text")).toBe(true);
  });

  it("coverage holds for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("tokenize — overflow cap", () => {
  it("caps link tokens at MAX_LINKS and reports suppression", () => {
    const N = MAX_LINKS + 1000; // 6000
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(`src/file${i}.ts:${i + 1}: msg`);
    const input = lines.join("\n");

    const toks = tokenize(input);
    const fileLinks = ofKind(toks, "file");
    expect(fileLinks).toHaveLength(MAX_LINKS);

    const last = toks[toks.length - 1];
    expect(last.kind).toBe("text");
    expect(last.text).toBe(`\n+${N - MAX_LINKS} more links suppressed`);
  });
});
