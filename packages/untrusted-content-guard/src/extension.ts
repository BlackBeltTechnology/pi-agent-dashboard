/**
 * pi-untrusted-content-guard — extension entry point.
 *
 * Wires the pi-independent `UntrustedContentGuard` to pi's hooks:
 *   before_agent_start → spotlighting guideline
 *   agent_start        → fresh per-run marker (taint untouched)
 *   input              → taint reset in run scope
 *   message_end        → taint on untrusted-by-name tool calls (parallel-safe)
 *   tool_result        → scan + mode + spotlight untrusted results, taint
 *   tool_call          → confirm / block sensitive tools while tainted
 *   /guard-clear       → manual taint reset
 *
 * Settings are re-read at each session start (see settings.ts). No dashboard
 * dependency; works in TUI, RPC and print mode (headless → block).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { UntrustedContentGuard } from "./guard.js";
import { getRegistry } from "./registry.js";
import { type GuardSettings, loadSettings } from "./settings.js";

export default function untrustedContentGuard(pi: ExtensionAPI): void {
  let settings: GuardSettings = loadSettings(undefined, false);
  const guard = new UntrustedContentGuard({ settings: () => settings, registry: getRegistry() });

  pi.on("session_start", async (_event, ctx) => {
    let trusted = false;
    try {
      trusted = ctx.isProjectTrusted();
    } catch {
      trusted = false;
    }
    settings = loadSettings(ctx.cwd, trusted);
  });

  pi.on("before_agent_start", async (event) => {
    guard.onBeforeAgentStart(event);
  });

  pi.on("agent_start", async () => {
    guard.onAgentStart();
  });

  pi.on("input", async () => {
    guard.onInput();
  });

  pi.on("message_end", async (event) => {
    guard.onMessageEnd(event.message);
  });

  pi.on("tool_result", async (event) => guard.onToolResult(event));

  pi.on("tool_call", async (event, ctx) => guard.onToolCall(event, ctx));

  pi.registerCommand("guard-clear", {
    description: "Clear the untrusted-content taint for this session",
    handler: async (_args, ctx) => {
      guard.clearTaint();
      ctx.ui.notify("Untrusted-content taint cleared", "info");
    },
  });
}
