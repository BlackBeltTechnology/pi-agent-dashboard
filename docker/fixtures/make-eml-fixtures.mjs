#!/usr/bin/env node
/**
 * Generates the .eml preview fixtures used by tests/e2e/eml-preview.spec.ts.
 * Writes into ./sample-git/ (copied to /fixtures/sample-git at container start).
 * Run: node docker/fixtures/make-eml-fixtures.mjs
 * See change: add-eml-preview.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "sample-git");

// A minimal but fully valid single blank page PDF that pdfjs can open + render
// to a canvas (the 446-byte doc.pdf renders in a native <object> but pdfjs
// rejects it). Byte offsets in the xref are exact for this literal.
function minimalPdf() {
  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n",
  ];
  const header = "%PDF-1.4\n";
  let body = header;
  const offsets = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o;
  }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

// Reuse the real PNG fixture so <img> decodes; the JPEG part carries PNG bytes
// (mime mismatch is irrelevant — the assertion is on the blob: src, not decode).
const PDF = minimalPdf();
const PNG = readFileSync(path.join(out, "logo.png"));
const JPEG = PNG;
const DOCX = Buffer.from("PK\x03\x04 fake docx zip");

function part(headers, bytes) {
  return `${headers.join("\r\n")}\r\n\r\n${bytes.toString("base64")}`;
}

function eml({ subject, html, boundary, parts }) {
  const body = `${parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n")}\r\n--${boundary}--\r\n`;
  return (
    `From: Alice Example <alice@example.com>\r\n` +
    `To: Bob Reviewer <bob@example.com>\r\n` +
    `Subject: ${subject}\r\n` +
    `Date: Wed, 01 Jan 2025 12:00:00 +0000\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n` +
    body
  );
}

// ── rich.eml — the everything fixture ──────────────────────────────────────
// XSS subject, body script, remote tracker img, cid image in BOTH src and CSS
// url(), plus PDF + JPEG + DOCX attachments and the cid PNG part.
const richHtml =
  `<style>.hero{background-image:url(cid:logo@x);height:20px}</style>` +
  `<h1>Quarterly Report</h1>` +
  `<div class="hero"></div>` +
  `<script>window.__EML_XSS__=1;document.title="pwned"</script>` +
  `<img src="cid:logo@x" alt="logo">` +
  `<img src="https://tracker.example/pixel.gif" alt="tracker">` +
  `<p>See attachments.</p>`;

const rich = eml({
  subject: "<img src=x onerror=alert(1)> Quarterly Report",
  html: richHtml,
  boundary: "RICH1",
  parts: [
    part(
      [
        `Content-Type: image/png`,
        `Content-Disposition: inline; filename="logo.png"`,
        `Content-ID: <logo@x>`,
        `Content-Transfer-Encoding: base64`,
      ],
      PNG,
    ),
    part(
      [
        `Content-Type: application/pdf; name="report.pdf"`,
        `Content-Disposition: attachment; filename="report.pdf"`,
        `Content-Transfer-Encoding: base64`,
      ],
      PDF,
    ),
    part(
      [
        `Content-Type: image/jpeg; name="photo.jpg"`,
        `Content-Disposition: attachment; filename="photo.jpg"`,
        `Content-Transfer-Encoding: base64`,
      ],
      JPEG,
    ),
    part(
      [
        `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="notes.docx"`,
        `Content-Disposition: attachment; filename="notes.docx"`,
        `Content-Transfer-Encoding: base64`,
      ],
      DOCX,
    ),
  ],
});

// ── lazy.eml — no cid, no remote; ONE PDF for the lazy-fetch assertion ──────
const lazy = eml({
  subject: "Lazy attachment fetch",
  html: `<p>The PDF below must not be fetched until expanded.</p>`,
  boundary: "LAZY1",
  parts: [
    part(
      [
        `Content-Type: application/pdf; name="deferred.pdf"`,
        `Content-Disposition: attachment; filename="deferred.pdf"`,
        `Content-Transfer-Encoding: base64`,
      ],
      PDF,
    ),
  ],
});

writeFileSync(path.join(out, "rich.eml"), rich);
writeFileSync(path.join(out, "lazy.eml"), lazy);
console.log("wrote rich.eml + lazy.eml to", out);
