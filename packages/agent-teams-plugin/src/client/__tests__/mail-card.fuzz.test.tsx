// @vitest-environment jsdom
/**
 * Renderer robustness (test-plan S74, task 13.42): 10 000 random bodies — Unicode,
 * control characters, NULs, very long lines, near-valid headers, nested `│` / `•` —
 * through the parser and the card: never throws, always renders non-empty text,
 * never creates an element from agent text, parse work is O(n) (gate: operation
 * count ≤ 4 × body length for a 100 KB body; wall-clock is not gated).
 * See change: add-agent-teams-ui.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatEnvelope } from "../../shared/mail-format.js";
import { MailEntryCard } from "../MailEntryCard.js";
import { parseMailBody, parseNoticeItems } from "../mail-parse.js";
import { header } from "./mail-fixtures.js";

afterEach(cleanup);

/** Deterministic PRNG (mulberry32) so a failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ATOMS = ["<img src=x onerror=1>", "<script>", "**", "[a](javascript:1)", "https://x.example/", "&lt;", "│ ", "• ", "│ • ", "\n", "\r\n", "\u0000", "\u202E", "\uFEFF", "\u200B", "«5 earlier lines hidden»\n", "[agent-teams · ", " · from ", "peer message", "]", "🙂", "é", "\t", " "];
const HEADERS = [formatEnvelope({ kind: "message", sender: "bob" }), header("plan_request", "bob", true), header("Bad", "bob"), header("message", "system"), `${formatEnvelope({ kind: "message", sender: "bob" }).slice(0, -3)}`, "", "[agent-teams · "];
function body(r: () => number): string {
  const parts: string[] = [HEADERS[Math.floor(r() * HEADERS.length)] as string, "\n"];
  const n = Math.floor(r() * 30);
  for (let i = 0; i < n; i++) {
    const k = r();
    parts.push(k < 0.5 ? (ATOMS[Math.floor(r() * ATOMS.length)] as string) : k < 0.9 ? String.fromCharCode(Math.floor(r() * 0xd7ff)) : "x".repeat(Math.floor(r() * 3000)));
  }
  return parts.join("");
}

describe("renderer robustness (S74)", () => {
  it("10 000 random bodies × the three custom types: parser and card never throw; text is always rendered; no element comes from agent text", () => {
    const r = rng(0x5eed);
    const types = ["agent-teams-mail", "agent-teams-idle", "agent-teams-notice"] as const;
    for (let i = 0; i < 10_000; i++) {
      const b = body(r);
      expect(() => parseMailBody(b)).not.toThrow();
      expect(() => parseNoticeItems(b)).not.toThrow();
      // Render a sample (jsdom) — every body is parsed; 1 in 20 is mounted.
      if (i % 20 !== 0) continue;
      const view = render(<MailEntryCard customType={types[i % 3] as string} body={b} timestamp={i} expanded={i % 40 === 0} onToggle={() => undefined} payloadLoading={false} />);
      const card = view.container.querySelector('[data-testid="team-mail-card"]') as HTMLElement;
      expect(card).not.toBeNull();
      expect((card.textContent ?? "").trim().length).toBeGreaterThan(0);
      expect(card.querySelector("img,script,a,b,strong,iframe,style")).toBeNull();
      view.unmount();
    }
  });

  it("parse is O(n): counted String operations for a 100 KB body are ≤ 4 × its length and scale linearly", () => {
    const line = `• item ${"y".repeat(92)}\n`; // 100 chars
    const make = (lines: number) => `${formatEnvelope({ kind: "notice", sender: "server" })}\n${line.repeat(lines)}`;
    const count = (text: string): number => {
      let ops = 0;
      const spies = (["startsWith", "indexOf", "slice", "split", "trim", "charCodeAt"] as const).map((m) => {
        const original = String.prototype[m] as (...a: unknown[]) => unknown;
        return (vi.spyOn(String.prototype, m as never) as unknown as { mockImplementation(f: unknown): { mockRestore(): void } }).mockImplementation(function (this: string, ...args: unknown[]) {
          ops++;
          return original.apply(this, args);
        });
      });
      try {
        const parsed = parseMailBody(text);
        if (parsed.type === "mail") parseNoticeItems(parsed.text);
      } finally {
        for (const s of spies) s.mockRestore();
      }
      return ops;
    };
    const small = make(1000); // ≈ 100 KB
    const opsSmall = count(small);
    const opsBig = count(make(4000));
    expect(opsSmall).toBeLessThanOrEqual(4 * small.length);
    expect(opsBig / opsSmall).toBeLessThan(4.5); // 4× the input ⇒ ≈ 4× the work, never quadratic
  });
});
