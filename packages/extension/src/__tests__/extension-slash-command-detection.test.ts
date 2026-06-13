/**
 * Pure-predicate tests for `isExtensionSlashCommand`.
 * One scenario per ADDED Requirement in
 * openspec/changes/fix-extension-slash-commands-in-dashboard/specs/command-routing/spec.md.
 *
 * regression: see openspec/changes/fix-extension-slash-commands-in-dashboard/
 */
import { describe, it, expect } from "vitest";
import {
  isExtensionSlashCommand,
  isHeadlessRpcSession,
  hasDispatchCommand,
} from "../bridge-context.js";

describe("isExtensionSlashCommand", () => {
  it("detects a bare extension command", () => {
    expect(
      isExtensionSlashCommand("/ctx-stats", [{ name: "ctx-stats", source: "extension" }]),
    ).toBe(true);
  });

  it("detects an extension command with arguments", () => {
    expect(
      isExtensionSlashCommand("/ctx-stats verbose=1", [
        { name: "ctx-stats", source: "extension" },
      ]),
    ).toBe(true);
  });

  it("rejects a skill command (source: skill)", () => {
    expect(
      isExtensionSlashCommand("/skill:foo", [{ name: "skill:foo", source: "skill" }]),
    ).toBe(false);
  });

  it("rejects a prompt template (source: prompt)", () => {
    expect(
      isExtensionSlashCommand("/review", [{ name: "review", source: "prompt" }]),
    ).toBe(false);
  });

  it("rejects bridge-native dashboard command (DASHBOARD_NATIVE_COMMANDS)", () => {
    // `roles` is in DASHBOARD_NATIVE_COMMANDS even though pi-flows registers it
    // with source: extension.
    expect(
      isExtensionSlashCommand("/roles", [{ name: "roles", source: "extension" }]),
    ).toBe(false);
  });

  it("rejects __-prefixed bridge-native command", () => {
    expect(
      isExtensionSlashCommand("/__dashboard_reload", [
        { name: "__dashboard_reload", source: "extension" },
      ]),
    ).toBe(false);
  });

  it("rejects an unknown slash", () => {
    expect(isExtensionSlashCommand("/totally-unknown", [])).toBe(false);
  });

  it("rejects multi-line input", () => {
    expect(
      isExtensionSlashCommand("/ctx-stats\nuser context", [
        { name: "ctx-stats", source: "extension" },
      ]),
    ).toBe(false);
  });

  it("rejects non-slash input", () => {
    expect(
      isExtensionSlashCommand("hello world", [{ name: "ctx-stats", source: "extension" }]),
    ).toBe(false);
  });

  it("rejects empty slash `/`", () => {
    expect(
      isExtensionSlashCommand("/", [{ name: "ctx-stats", source: "extension" }]),
    ).toBe(false);
  });
});

// See change: add-rpc-stdin-dispatch-with-keeper-sidecar (task 7.2).
// See change: resolve-global-prompt-templates-from-dashboard (Decision 2).
describe("hasDispatchCommand", () => {
  it("returns true for a plain function", () => {
    expect(hasDispatchCommand({ dispatchCommand: () => {} })).toBe(true);
  });

  it("returns true for a getter-backed / Proxy-hidden function", () => {
    const fn = () => {};
    const pi = new Proxy(
      {},
      {
        has: (_t, k) => k === "dispatchCommand",
        get: (_t, k) => (k === "dispatchCommand" ? fn : undefined),
      },
    );
    expect(hasDispatchCommand(pi)).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasDispatchCommand({})).toBe(false);
  });

  it("returns false for a non-function value", () => {
    expect(hasDispatchCommand({ dispatchCommand: "yes" })).toBe(false);
  });

  it("returns false for null / undefined", () => {
    expect(hasDispatchCommand(null)).toBe(false);
    expect(hasDispatchCommand(undefined)).toBe(false);
  });
});

describe("isHeadlessRpcSession", () => {
  it("returns true when env=1 AND argv contains --mode rpc", () => {
    expect(
      isHeadlessRpcSession(
        { PI_DASHBOARD_SPAWNED: "1" },
        ["node", "pi", "--mode", "rpc"],
      ),
    ).toBe(true);
  });

  it("returns false when env unset (non-dashboard RPC)", () => {
    expect(isHeadlessRpcSession({}, ["node", "pi", "--mode", "rpc"])).toBe(false);
  });

  it("returns false when argv has no --mode rpc (dashboard tmux)", () => {
    expect(isHeadlessRpcSession({ PI_DASHBOARD_SPAWNED: "1" }, ["node", "pi"])).toBe(false);
  });

  it("returns false when neither env nor argv match", () => {
    expect(isHeadlessRpcSession({}, ["node", "pi"])).toBe(false);
  });

  it("returns false when --mode is followed by non-rpc value", () => {
    expect(
      isHeadlessRpcSession({ PI_DASHBOARD_SPAWNED: "1" }, ["node", "pi", "--mode", "interactive"]),
    ).toBe(false);
  });
});
