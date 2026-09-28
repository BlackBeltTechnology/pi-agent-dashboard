/**
 * L1 MIME round-trip (test-plan E26). See change: add-gmail-plugin.
 */
import { describe, expect, it } from "vitest";
import { buildMime, toRaw } from "../mime.js";

/** Minimal parser for the builder's own output (test-only). */
function parse(raw: string) {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of (head as string).split("\r\n")) {
    const i = line.indexOf(": ");
    headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 2));
  }
  const decodeWord = (v: string) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b: string) => Buffer.from(b, "base64").toString("utf8"));
  const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type") ?? "")?.[1] as string;
  const parts = rest
    .join("\r\n\r\n")
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => {
      const [ph, ...pb] = p.replace(/^\r\n/, "").split("\r\n\r\n");
      return { headers: ph as string, data: Buffer.from(pb.join("").replace(/\s+/g, ""), "base64") };
    });
  return { subject: decodeWord(headers.get("subject") ?? ""), headers, parts };
}

describe("E26 — MIME", () => {
  it("round-trips a UTF-8 subject, body and attachment bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 13, 10]);
    const raw = toRaw(
      buildMime({
        to: ["a@x.com"],
        subject: "Árvíztűrő",
        body: "Tükörfúrógép ✓\nline 2",
        attachments: [{ filename: "a.bin", mimeType: "application/octet-stream", data: bytes }],
      }),
    );
    expect(raw).not.toMatch(/[+/=]/);
    const m = parse(raw);
    expect(m.subject).toBe("Árvíztűrő");
    expect(m.parts[0]?.data.toString("utf8")).toBe("Tükörfúrógép ✓\nline 2");
    expect(m.parts[1]?.headers).toContain('filename="a.bin"');
    expect(m.parts[1]?.data.equals(bytes)).toBe(true);
  });

  it("strips CR/LF from header values (no header injection)", () => {
    const text = buildMime({ to: ["a@x.com\r\nBcc: evil@x.com"], subject: "S\r\nX-Evil: 1", body: "b" });
    expect(text).not.toMatch(/^Bcc: evil/m);
    expect(text).not.toMatch(/^X-Evil/m);
  });
});

describe("CodeRabbit — quoted filename parameter", () => {
  it("a trailing backslash or quote cannot break the quoted filename", () => {
    const text = buildMime({
      to: ["a@x.com"],
      subject: "s",
      body: "b",
      attachments: [{ filename: 'we"ird\\', mimeType: "text/plain", data: Buffer.from("x") }],
    });
    expect(text).toMatch(/filename="we_ird_"\r?$/m);
  });
});
