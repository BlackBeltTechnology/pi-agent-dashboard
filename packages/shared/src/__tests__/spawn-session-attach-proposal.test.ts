/**
 * Type-level + structural tests for the `attachProposal` field on
 * `SpawnSessionBrowserMessage`. See change:
 * add-folder-task-checker-and-spawn-attach.
 */
import { describe, it, expect } from "vitest";
import type {
  SpawnSessionBrowserMessage,
  BrowserToServerMessage,
} from "../browser-protocol.js";

describe("SpawnSessionBrowserMessage.attachProposal", () => {
  it("is optional — the bare-spawn payload still type-checks", () => {
    // Compile-time: omitting attachProposal is allowed.
    const bare: SpawnSessionBrowserMessage = { type: "spawn_session", cwd: "/x" };
    expect(bare.attachProposal).toBeUndefined();
    const _inUnion: BrowserToServerMessage = bare;
    void _inUnion;
  });

  it("accepts a string attachProposal when set", () => {
    const withAttach: SpawnSessionBrowserMessage = {
      type: "spawn_session",
      cwd: "/x",
      attachProposal: "add-foo",
    };
    expect(withAttach.attachProposal).toBe("add-foo");
  });

  it("JSON round-trip preserves the field", () => {
    const sent: SpawnSessionBrowserMessage = {
      type: "spawn_session",
      cwd: "/project/foo",
      attachProposal: "add-auth",
    };
    const parsed = JSON.parse(JSON.stringify(sent)) as SpawnSessionBrowserMessage;
    expect(parsed.type).toBe("spawn_session");
    expect(parsed.cwd).toBe("/project/foo");
    expect(parsed.attachProposal).toBe("add-auth");
  });

  it("JSON round-trip without the field omits it", () => {
    const sent: SpawnSessionBrowserMessage = { type: "spawn_session", cwd: "/x" };
    const parsed = JSON.parse(JSON.stringify(sent)) as SpawnSessionBrowserMessage;
    expect("attachProposal" in parsed).toBe(false);
  });
});
