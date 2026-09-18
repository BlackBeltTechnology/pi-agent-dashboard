import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyBrowserMessage,
  isSessionOwnedMessage,
  NON_SESSION_MESSAGES,
  SESSION_LIST_MESSAGES,
  SESSION_OWNED_MESSAGES,
} from "../ws-message-scope.js";

/**
 * Re-derive the `BrowserToServerMessage` union's type literals from the shared
 * protocol source and assert every one is classified (§7.4 / D10). A new
 * message type added to the protocol without a scope entry fails HERE — that is
 * the "a new session road without owner-equality fails" guarantee.
 */
function protocolMessageLiterals(): string[] {
  const base = fileURLToPath(new URL("../../../../shared/src/", import.meta.url));
  const src =
    readFileSync(`${base}browser-protocol.ts`, "utf8") +
    "\n\n" +
    readFileSync(`${base}dashboard-plugin/intent-types.ts`, "utf8");
  const bp = readFileSync(`${base}browser-protocol.ts`, "utf8");
  const start = bp.indexOf("export type BrowserToServerMessage =");
  const block = bp.slice(start, bp.indexOf(";", start));
  const members = [...block.matchAll(/\|\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const literalOf = (name: string): string | null => {
    const re = new RegExp(`interface ${name}\\b[^{]*\\{`);
    const mm = re.exec(src);
    if (!mm) return null;
    let depth = 0;
    let i = mm.index + mm[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    return (src.slice(mm.index, i).match(/type:\s*"([^"]+)"/) ?? [])[1] ?? null;
  };
  return members.map((m) => {
    const lit = literalOf(m);
    if (!lit) throw new Error(`could not resolve type literal for union member ${m}`);
    return lit;
  });
}

describe("ws-message-scope coverage (§7.4 / D10)", () => {
  it("classifies every BrowserToServerMessage type into exactly one scope", () => {
    const literals = protocolMessageLiterals();
    expect(literals.length).toBeGreaterThan(50);
    const unclassified = literals.filter((t) => classifyBrowserMessage(t) === undefined);
    expect(unclassified).toEqual([]);
  });

  it("has no type in more than one scope set", () => {
    const all = [...SESSION_OWNED_MESSAGES, ...SESSION_LIST_MESSAGES, ...NON_SESSION_MESSAGES];
    expect(all.length).toBe(new Set(all).size);
  });

  it("classifies the canonical session commands as owner-gated", () => {
    for (const t of ["send_prompt", "abort", "retry_session", "kill_process", "rename_session", "archive_session", "set_session_tags", "subscribe", "resume_session"]) {
      expect(isSessionOwnedMessage(t)).toBe(true);
    }
  });

  it("classifies global/workspace context-carrying types as non-session", () => {
    for (const t of ["request_models", "role_set", "list_files", "open_inline_terminal", "ui_management", "spawn_session"]) {
      expect(classifyBrowserMessage(t)).toBe("non-session");
    }
  });

  it("classifies session list roads as session-list (per-item filtered)", () => {
    expect(classifyBrowserMessage("list_sessions")).toBe("session-list");
    expect(classifyBrowserMessage("sessions_page")).toBe("session-list");
  });
});
