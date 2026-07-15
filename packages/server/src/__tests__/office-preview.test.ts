/**
 * Unit tests for the office-preview pure helpers + sheet parser.
 * See change: render-office-previews.
 */

import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  applyImageCap,
  hyperlinkGuard,
  OFFICE_CAPS,
  parseSheet,
  pdfCachePath,
  pickCsvEncoding,
  resolveRowLimit,
} from "../lib/office-preview.js";

describe("hyperlinkGuard (design D2)", () => {
  it("sets href='' on a hyperlink with null href AND null anchor", () => {
    const doc = { children: [{ type: "hyperlink", href: null, anchor: null, children: [] }] };
    hyperlinkGuard(doc);
    expect((doc.children[0] as any).href).toBe("");
  });

  it("leaves a hyperlink with a real href untouched", () => {
    const doc = { children: [{ type: "hyperlink", href: "http://x", anchor: null }] };
    hyperlinkGuard(doc);
    expect((doc.children[0] as any).href).toBe("http://x");
  });

  it("leaves an internal-anchor hyperlink untouched", () => {
    const doc = { children: [{ type: "hyperlink", href: null, anchor: "sec1" }] };
    hyperlinkGuard(doc);
    expect((doc.children[0] as any).href).toBeNull();
  });

  it("walks nested children", () => {
    const doc = {
      children: [{ type: "paragraph", children: [{ type: "hyperlink", href: null, anchor: null }] }],
    };
    hyperlinkGuard(doc);
    expect((doc.children[0] as any).children[0].href).toBe("");
  });
});

describe("applyImageCap (design D3)", () => {
  const caps = { imageCap: 20, htmlByteCap: 2 * 1024 * 1024 };

  it("keeps html unchanged under both caps", () => {
    const html = "<p>hi</p><img src='data:image/png;base64,AAAA'>";
    const out = applyImageCap(html, 1, caps);
    expect(out.truncated).toBe(false);
    expect(out.html).toBe(html);
  });

  it("strips images when image count exceeds the cap", () => {
    const html = "<p>x</p>" + "<img src='data:image/png;base64,AAAA'>".repeat(25);
    const out = applyImageCap(html, 25, caps);
    expect(out.truncated).toBe(true);
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("preview-image-placeholder");
  });

  it("strips images when serialized html exceeds the byte cap", () => {
    // A single but huge base64 image trips the byte cap even though the image
    // COUNT is under the image cap. Stripping removes the base64 payload so it
    // never reaches the browser.
    const big = `<img src='data:image/png;base64,${"A".repeat(4000)}'>`;
    const html = `<p>x</p>${big}`;
    const out = applyImageCap(html, 1, { imageCap: 20, htmlByteCap: 2048 });
    expect(out.truncated).toBe(true);
    expect(out.html).not.toContain("<img");
    expect(out.html).not.toContain("data:image");
    expect(Buffer.byteLength(out.html, "utf8")).toBeLessThan(Buffer.byteLength(html, "utf8"));
  });
});

describe("resolveRowLimit", () => {
  it("defaults to rowCap when unset/invalid", () => {
    expect(resolveRowLimit(undefined, OFFICE_CAPS)).toBe(OFFICE_CAPS.rowCap);
    expect(resolveRowLimit(0, OFFICE_CAPS)).toBe(OFFICE_CAPS.rowCap);
    expect(resolveRowLimit(-5, OFFICE_CAPS)).toBe(OFFICE_CAPS.rowCap);
    expect(resolveRowLimit(Number.NaN, OFFICE_CAPS)).toBe(OFFICE_CAPS.rowCap);
  });
  it("clamps to rowCapMax", () => {
    expect(resolveRowLimit(999999, OFFICE_CAPS)).toBe(OFFICE_CAPS.rowCapMax);
    expect(resolveRowLimit(50, OFFICE_CAPS)).toBe(50);
  });
});

describe("pdfCachePath", () => {
  it("is deterministic on path+mtime+size and changes when any varies", () => {
    const a = pdfCachePath("/x/a.docx", 100, 10);
    expect(a).toBe(pdfCachePath("/x/a.docx", 100, 10));
    expect(a).not.toBe(pdfCachePath("/x/a.docx", 101, 10));
    expect(a).not.toBe(pdfCachePath("/x/a.docx", 100, 11));
    expect(a.endsWith(".pdf")).toBe(true);
  });
});

function xlsxBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("pickCsvEncoding (design D6)", () => {
  it("prefers a competitive Latin-2 candidate over a Latin-1 top pick", () => {
    expect(
      pickCsvEncoding([
        { name: "ISO-8859-1", confidence: 10 },
        { name: "ISO-8859-2", confidence: 9 },
      ]),
    ).toBe("ISO-8859-2");
  });
  it("keeps Latin-1 when no Latin-2 candidate is competitive", () => {
    expect(
      pickCsvEncoding([
        { name: "ISO-8859-1", confidence: 30 },
        { name: "ISO-8859-2", confidence: 5 },
      ]),
    ).toBe("ISO-8859-1");
  });
  it("returns the top pick when it is not Latin-1", () => {
    expect(pickCsvEncoding([{ name: "UTF-8", confidence: 50 }])).toBe("UTF-8");
  });
  it("defaults to UTF-8 on an empty ranking", () => {
    expect(pickCsvEncoding([])).toBe("UTF-8");
  });
});

describe("parseSheet — xlsx", () => {
  it("returns one entry per sheet with activeSheet=0 (test-plan #14)", async () => {
    const buf = xlsxBuffer({
      Alpha: [["a", "b"], [1, 2]],
      Beta: [["c"], [3]],
    });
    const res = await parseSheet(buf, ".xlsx", { rowLimit: 500, colCap: 100 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.sheets.map((s) => s.name)).toEqual(["Alpha", "Beta"]);
    expect(res.activeSheet).toBe(0);
    expect(res.sheets[0].header).toEqual(["a", "b"]);
  });

  it("bounds rows to the cap, reports true total + truncated (BVA, test-plan #15)", async () => {
    const body = Array.from({ length: 12 }, (_, i) => [i]);
    const buf = xlsxBuffer({ S: [["h"], ...body] });
    const res = await parseSheet(buf, ".xlsx", { rowLimit: 5, colCap: 100 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.sheets[0].rows.length).toBe(5);
    expect(res.sheets[0].totalRows).toBe(12);
    expect(res.sheets[0].truncated).toBe(true);
  });

  it("corrupt (truncated zip) buffer → success:false, no throw", async () => {
    const valid = xlsxBuffer({ S: [["a"], [1]] });
    const res = await parseSheet(valid.subarray(0, 40), ".xlsx", {
      rowLimit: 500,
      colCap: 100,
    });
    expect(res.success).toBe(false);
  });

  it("password-protected / encrypted buffer → success:false, no throw (test-plan #17)", async () => {
    const encrypted = Buffer.from(`PK\x03\x04${"g".repeat(60)}`);
    const res = await parseSheet(encrypted, ".xlsx", { rowLimit: 500, colCap: 100 });
    expect(res.success).toBe(false);
  });
});

describe("parseSheet — csv encoding (design D6, test-plan #16)", () => {
  it("decodes a non-UTF-8 (CP1250) csv and reports a charset", async () => {
    // Representative Hungarian CSV. A one-line sample is too short for any
    // statistical detector to disambiguate the Latin-2 family; ő/ű share code
    // points across ISO-8859-2 and windows-1250, so either label decodes the
    // double-acute vowels correctly — the real D6 requirement.
    const rows = ["nev;varos"];
    for (let i = 0; i < 40; i++) {
      rows.push("Árvíztűrő tükörfúrógép;Magyarország Győr Székesfehérvár őrület");
    }
    const buf = iconv.encode(`${rows.join("\n")}\n`, "windows-1250");
    const res = await parseSheet(buf, ".csv", { rowLimit: 500, colCap: 100 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    // Accented chars — including the ő/ű double-acute vowels — survive.
    const flat = JSON.stringify(res.sheets);
    expect(flat).toContain("Árvíztűrő");
    expect(flat).toContain("Győr");
    // A Central-European (Latin-2 family) charset is reported, not UTF-8.
    expect(res.encoding).toBeDefined();
    expect(/8859-2|1250/.test(res.encoding ?? "")).toBe(true);
  });
});
