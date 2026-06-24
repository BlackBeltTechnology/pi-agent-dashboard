import { describe, expect, it } from "vitest";
import {
  buildProvenance,
  provenanceFrontmatter,
  stampProvenance,
} from "../provenance.js";

const FIXED = "2026-06-24T00:00:00.000Z";

describe("provenance frontmatter", () => {
  it("builds a deterministic record with a fixed timestamp", () => {
    const prov = buildProvenance({
      sourcePath: "/docs/a.pdf",
      sha256: "abc123",
      docType: "pdf",
      convertedAt: FIXED,
    });
    expect(prov).toEqual({
      source_path: "/docs/a.pdf",
      sha256: "abc123",
      doc_type: "pdf",
      converted_at: FIXED,
    });
  });

  it("includes page/slide only when provided", () => {
    const prov = buildProvenance({
      sourcePath: "/a.pptx",
      sha256: "x",
      docType: "pptx",
      convertedAt: FIXED,
      slide: 3,
    });
    expect(prov.slide).toBe(3);
    expect(prov.page).toBeUndefined();
  });

  it("prepends a frontmatter block to a bare body", () => {
    const prov = buildProvenance({
      sourcePath: "/a.pdf",
      sha256: "deadbeef",
      docType: "pdf",
      convertedAt: FIXED,
    });
    const out = stampProvenance("# Title\n\nbody", prov);
    expect(out.startsWith("---\nprovenance:\n")).toBe(true);
    expect(out).toContain("sha256: deadbeef");
    expect(out.trimEnd().endsWith("body")).toBe(true);
  });

  it("injects into existing frontmatter without clobbering keys", () => {
    const prov = buildProvenance({
      sourcePath: "/a.pdf",
      sha256: "h",
      docType: "pdf",
      convertedAt: FIXED,
    });
    const existing = "---\ntitle: Hello\n---\n\nbody\n";
    const out = stampProvenance(existing, prov);
    expect(out).toContain("provenance:");
    expect(out).toContain("title: Hello");
    // Single opening fence only.
    expect(out.match(/^---\n/)).toBeTruthy();
    expect(out.indexOf("---", 4)).toBeGreaterThan(0);
  });

  it("re-stamping the same hash is byte-identical (idempotent)", () => {
    const prov = buildProvenance({
      sourcePath: "/a.pdf",
      sha256: "same",
      docType: "pdf",
      convertedAt: FIXED,
    });
    const a = stampProvenance("body", prov);
    const b = stampProvenance("body", prov);
    expect(a).toBe(b);
  });

  it("quotes scalars that could be misparsed", () => {
    const prov = buildProvenance({
      sourcePath: "/path with spaces/a.pdf",
      sha256: "h",
      docType: "pdf",
      convertedAt: FIXED,
    });
    const fm = provenanceFrontmatter(prov);
    expect(fm).toContain('"/path with spaces/a.pdf"');
  });
});
