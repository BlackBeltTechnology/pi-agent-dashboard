/**
 * pi-SDK-coupled half of the AI-draft feature: the real ephemeral
 * fork-subagent runner + the session-context text extractor. Kept separate
 * from the pure `commit-draft.ts` ladder so the ladder stays unit-testable
 * without spawning a model, and so the risky in-process `AgentSession`
 * instantiation is isolated behind one guarded entry point.
 *
 * The primary path (design.md §4 rung 1) spins a throwaway
 * `SessionManager.inMemory` `AgentSession` on the live session's model,
 * prompts once, captures the assistant text off the event stream, and
 * disposes it. Every failure mode throws so the ladder degrades.
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */

/**
 * Compact the live session context (from `buildSessionContext()`) into a
 * bounded text block for the draft seed. Best-effort — returns `undefined`
 * when the context is unavailable so the ladder drops to the diff-only rung.
 */
export function buildSessionContextText(
  ctx: { sessionManager?: { buildSessionContext?: () => { messages?: unknown[] } | undefined } } | undefined,
  maxChars = 8_000,
): string | undefined {
  try {
    const built = ctx?.sessionManager?.buildSessionContext?.();
    const messages = built?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return undefined;
    const parts: string[] = [];
    for (const m of messages) {
      const role = (m as { role?: string }).role ?? "?";
      const content = (m as { content?: unknown }).content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? "")).join("")
          : "";
      if (text.trim()) parts.push(`${role}: ${text.trim()}`);
    }
    const joined = parts.join("\n");
    if (!joined) return undefined;
    return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
  } catch {
    return undefined;
  }
}

/**
 * Run ONE ephemeral in-memory agent turn on `seed` and resolve with the
 * assistant text. Throws on any failure (no model, SDK unavailable, empty
 * output) so the caller's fallback ladder engages. The subagent is always
 * disposed. `getModel` supplies the live session's model object.
 */
export async function runForkSubagentDraft(
  seed: string,
  cwd: string,
  getModel: () => unknown | undefined,
  overallTimeoutMs = 30_000,
): Promise<string> {
  const model = getModel();
  if (!model) throw new Error("no-model");

  // Dynamic import so a missing/older pi never breaks module load; the
  // catch in the caller degrades to a fallback rung.
  const sdk = (await import("@earendil-works/pi-coding-agent")) as unknown as {
    createAgentSession: (opts: unknown) => Promise<{ session: AgentSessionLike }>;
    SessionManager: { inMemory: (cwd?: string) => unknown };
  };

  const { session } = await sdk.createAgentSession({
    sessionManager: sdk.SessionManager.inMemory(cwd),
    model,
    tools: [],
    cwd,
  });

  let captured = "";
  const unsubscribe = session.subscribe((event: AgentSessionEventLike) => {
    if (
      event?.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string"
    ) {
      captured += event.assistantMessageEvent.delta;
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.prompt(seed),
      new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error("prompt-timeout")), overallTimeoutMs); }),
    ]);
    const text = captured.trim();
    if (!text) throw new Error("empty-draft");
    return text;
  } finally {
    if (timer) clearTimeout(timer);
    try { unsubscribe(); } catch { /* ignore */ }
    try { session.dispose(); } catch { /* ignore */ }
  }
}

// ── Minimal structural types for the SDK surface we touch ────────────────────

interface AgentSessionEventLike {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
}
interface AgentSessionLike {
  subscribe: (listener: (event: AgentSessionEventLike) => void) => () => void;
  prompt: (text: string) => Promise<void>;
  dispose: () => void;
}
