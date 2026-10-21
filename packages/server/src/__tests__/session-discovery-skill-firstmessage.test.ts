/**
 * See change: render-skill-invocations-collapsibly.
 *
 * Verifies that session-scanner extracts the first user message and condenses
 * it to a slash-command form when the message is wrapped in a `<skill>`
 * envelope. Tests both the wrapped path (skill invocation) and the plain path
 * (regular text) end-to-end via readJsonlHeaderSync (the path firstMessage
 * actually flows through).
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { condenseForFirstMessage } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAllSessions } from "../session/session-scanner.js";

const SESSION_HEADER = {
  type: "session",
  id: "01JABCDEFGHIJKLMNOPQRSTUVWX",
  cwd: "/some/cwd",
  timestamp: "2026-05-05T10:00:00.000Z",
};

function userMsgEntry(text: string) {
  return {
    type: "message",
    id: "msg-1",
    parentId: null,
    timestamp: "2026-05-05T10:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1777032001000 },
  };
}

describe("condenseForFirstMessage (used by session-scanner / session-discovery)", () => {
  it("returns slash form when content is a wrapped <skill> envelope", () => {
    const wrapped =
      `<skill name="openspec-explore" location="/abs/path/SKILL.md">\nReferences are relative to /abs/path.\n\nbody body body\n</skill>\n\ncontinue with X`;
    expect(condenseForFirstMessage(wrapped, 200)).toBe(
      "/skill:openspec-explore continue with X",
    );
  });

  it("returns slash form even when condensed exceeds maxLen, truncated to maxLen", () => {
    const longArgs = "x".repeat(500);
    const wrapped = `<skill name="foo" location="/p">\nb\n</skill>\n\n${longArgs}`;
    const out = condenseForFirstMessage(wrapped, 200);
    expect(out.length).toBe(200);
    expect(out.startsWith("/skill:foo ")).toBe(true);
  });

  it("returns raw text slice when content is plain text", () => {
    expect(condenseForFirstMessage("Hello world", 200)).toBe("Hello world");
  });

  it("returns raw text slice when content is partial / unparseable wrapper", () => {
    // No closing </skill> — falls through to raw slice
    const broken = `<skill name="foo" location="/x">\nbody`;
    expect(condenseForFirstMessage(broken, 200)).toBe(broken);
  });
});

// End-to-end against the actual session-scanner path. We touch the same JSONL
// reader the scanner uses indirectly by importing the module.
describe("session-scanner firstMessage condensation (end-to-end via scanAllSessions)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `pi-firstmsg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Replaces a source-text pin (`condenseForFirstMessage(...)` present in the scanner
  // sources) with the behaviour it stood for. See change: test-trust-audit (D4).
  function writeSession(name: string, text: string): void {
    const cwdDir = join(tmpRoot, "--some-cwd--");
    mkdirSync(cwdDir, { recursive: true });
    const lines = [SESSION_HEADER, userMsgEntry(text)].map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(join(cwdDir, `2026-05-05T10-00-00-000Z_${name}.jsonl`), `${lines}\n`);
  }

  function firstMessageOf(id: string): string | undefined {
    const { sessions } = scanAllSessions(tmpRoot, { archiveAfterDays: 0, archiveServiceSessionsOnEnd: false });
    return sessions.find((s) => s.id === id)?.firstMessage;
  }

  it("a JSONL whose first user message is a wrapped <skill> envelope scans to the slash form", () => {
    const wrapped = `<skill name="openspec-explore" location="/abs/SKILL.md">\nbody\n</skill>\n\ncontinue with X`;
    writeSession("wrapped-1", wrapped);
    expect(firstMessageOf("wrapped-1")).toBe("/skill:openspec-explore continue with X");
  });

  it("a JSONL whose first user message is plain text scans to the raw text", () => {
    writeSession("plain-1", "Hello world");
    expect(firstMessageOf("plain-1")).toBe("Hello world");
  });
});
