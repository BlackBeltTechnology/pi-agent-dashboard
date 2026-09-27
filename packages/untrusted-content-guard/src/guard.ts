/**
 * Guard core — pi-runtime-independent state machine behind the extension hooks.
 *
 * - Selection (D2): untrusted when the tool name matches `untrustedTools`, is
 *   declared `untrusted` in the registry (D6), or the result carries
 *   `details.untrusted === true`.
 * - Modes (D3) + spotlighting (D4) in `onToolResult`.
 * - Taint gate (D5): set at assistant `message_end` (untrusted-by-name calls,
 *   so parallel siblings are gated) and at `tool_result`; gates sensitive
 *   `tool_call`s; reset on `input` (run scope) or `/guard-clear`.
 */

import { matchesAny } from "./glob.js";
import { type GuardRegistry, isDeclared } from "./registry.js";
import type { Finding } from "./scanner/findings.js";
import { scan } from "./scanner/scan.js";
import type { GuardSettings } from "./settings.js";
import {
  GUIDELINE,
  blockNotice,
  closeDelimiter,
  escapeDelimiters,
  newMarker,
  openDelimiter,
  summaryLine,
} from "./spotlight.js";

export const TAINT_REASON = "untrusted_taint";

type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolResultLike {
  toolName: string;
  content: Block[];
  details?: unknown;
}

export interface ToolCallLike {
  toolName: string;
  input: Record<string, unknown>;
}

export interface UiLike {
  hasUI: boolean;
  ui?: { confirm(title: string, message: string): Promise<boolean> };
}

export interface GuardDeps {
  settings: () => GuardSettings;
  registry: GuardRegistry;
  marker?: () => string;
}

function detailsRecord(details: unknown): Record<string, unknown> | undefined {
  return typeof details === "object" && details !== null ? (details as Record<string, unknown>) : undefined;
}

function mergeFindings(into: Map<string, Finding>, findings: readonly Finding[]): void {
  for (const f of findings) {
    const existing = into.get(f.layer);
    if (existing) existing.count += f.count;
    else into.set(f.layer, { ...f });
  }
}

function argsSummary(input: Record<string, unknown>): string {
  const raw = typeof input.command === "string" ? input.command : JSON.stringify(input);
  const flat = (raw ?? "").replace(/\s+/g, " ");
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export class UntrustedContentGuard {
  private taintSource: string | undefined;
  private runMarker: string;
  private readonly makeMarker: () => string;

  constructor(private readonly deps: GuardDeps) {
    this.makeMarker = deps.marker ?? newMarker;
    this.runMarker = this.makeMarker();
  }

  get tainted(): boolean {
    return this.taintSource !== undefined;
  }

  get marker(): string {
    return this.runMarker;
  }

  private get active(): boolean {
    return this.deps.settings().mode !== "off";
  }

  /** agent_start: fresh marker per run. Deliberately does NOT reset taint (retries, compaction). */
  onAgentStart(): void {
    this.runMarker = this.makeMarker();
  }

  /** input (any source — dashboard prompts arrive as `extension`): reset in run scope. */
  onInput(): void {
    if (this.deps.settings().taintScope === "run") this.clearTaint();
  }

  clearTaint(): void {
    this.taintSource = undefined;
  }

  isUntrustedByName(toolName: string): boolean {
    return (
      matchesAny(toolName, this.deps.settings().untrustedTools) ||
      isDeclared(this.deps.registry, "untrusted", toolName)
    );
  }

  isUntrustedResult(toolName: string, details: unknown): boolean {
    return this.isUntrustedByName(toolName) || detailsRecord(details)?.untrusted === true;
  }

  onBeforeAgentStart(event: { systemPromptOptions?: { promptGuidelines?: string[] } }): void {
    if (!this.active) return;
    const guidelines = event.systemPromptOptions?.promptGuidelines;
    if (Array.isArray(guidelines) && !guidelines.includes(GUIDELINE)) guidelines.push(GUIDELINE);
  }

  /** Assistant message finalized: taint BEFORE any of its tool calls execute. */
  onMessageEnd(message: unknown): void {
    if (!this.active) return;
    const m = message as { role?: unknown; content?: unknown };
    if (m?.role !== "assistant" || !Array.isArray(m.content)) return;
    for (const block of m.content as Array<{ type?: unknown; name?: unknown }>) {
      if (block?.type === "toolCall" && typeof block.name === "string" && this.isUntrustedByName(block.name)) {
        this.taintSource ??= block.name;
      }
    }
  }

  /** Rewrite an untrusted result per mode; undefined = leave the result untouched. */
  onToolResult(event: ToolResultLike): { content: Block[] } | undefined {
    const settings = this.deps.settings();
    if (settings.mode === "off" || !this.isUntrustedResult(event.toolName, event.details)) return undefined;
    this.taintSource ??= event.toolName;
    const mode = settings.mode;

    const contentType = detailsRecord(event.details)?.contentType;
    const merged = new Map<string, Finding>();
    const blocks: Block[] = event.content.map((block) => {
      if (block.type !== "text") return block;
      const result = scan(block.text, {
        mode,
        contentType: typeof contentType === "string" ? contentType : undefined,
        allowHosts: settings.allowHosts,
      });
      mergeFindings(merged, result.findings);
      return { type: "text", text: escapeDelimiters(result.cleaned) };
    });
    const findings = [...merged.values()];

    if (mode === "block" && findings.some((f) => f.severity === "high")) {
      return { content: [{ type: "text", text: blockNotice(event.toolName, findings) }] };
    }

    const open = openDelimiter(event.toolName, this.runMarker);
    const summary = summaryLine(findings, mode);
    const close = closeDelimiter(this.runMarker) + (summary ? `\n${summary}` : "");
    const first = blocks[0];
    if (first?.type === "text") blocks[0] = { type: "text", text: `${open}\n${first.text}` };
    else blocks.unshift({ type: "text", text: open });
    const last = blocks[blocks.length - 1] as Block;
    if (last.type === "text") blocks[blocks.length - 1] = { type: "text", text: `${last.text}\n${close}` };
    else blocks.push({ type: "text", text: close });
    return { content: blocks };
  }

  /**
   * Gate a sensitive call while tainted. Any internal failure BLOCKS (fail-safe,
   * design D5) — the guard never fails open.
   */
  async onToolCall(event: ToolCallLike, ctx: UiLike): Promise<{ block: true; reason: string } | undefined> {
    try {
      const settings = this.deps.settings();
      if (settings.mode === "off" || !this.tainted) return undefined;
      if (!matchesAny(event.toolName, settings.sensitiveTools)) return undefined;
      if (isDeclared(this.deps.registry, "selfConfirming", event.toolName)) return undefined;

      const call = `${event.toolName}(${argsSummary(event.input ?? {})})`;
      if (!ctx.hasUI || !ctx.ui) {
        return {
          block: true,
          reason: `${TAINT_REASON}: untrusted content (${this.taintSource}) was read this run; ${call} needs confirmation but no UI is available`,
        };
      }
      let allowed = false;
      try {
        allowed =
          (await ctx.ui.confirm(
            "Untrusted content guard",
            `Untrusted content was read this run (from ${this.taintSource}). It may contain instructions aimed at the agent. Allow ${call}?`,
          )) === true;
      } catch {
        allowed = false; // dismissed / timed out / transport error → deny
      }
      return allowed
        ? undefined
        : { block: true, reason: `${TAINT_REASON}: user denied ${call} after untrusted content was read` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { block: true, reason: `${TAINT_REASON}: guard check failed (${msg}); blocked fail-safe` };
    }
  }
}
