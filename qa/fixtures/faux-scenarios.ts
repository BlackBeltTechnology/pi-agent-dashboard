/**
 * Shared faux scenario catalog.
 *
 * Single source of truth for the scripted model responses driven by the faux
 * provider (`faux-provider.ext.ts`). Both the server-side integration test
 * (`packages/server/src/__tests__/faux-session.integration.test.ts`) and the
 * client-side renderer test
 * (`packages/client/src/components/__tests__/faux-renderers.integration.test.tsx`)
 * import this catalog, so a faux event stream is defined once and asserted in
 * both places.
 *
 * Each entry is `{ script, expect }` where `script` is a `FauxResponseStep[]`
 * composed purely from the faux helpers (`fauxText` / `fauxThinking` /
 * `fauxToolCall` / `fauxAssistantMessage`) plus factory steps. Keeping `script`
 * as pure data + factories lets the client layer import it without spawning a
 * pi subprocess.
 *
 * See change: add-faux-model-integration-tests.
 */

// pi-ai's published `index.d.ts` re-exports its members with `.ts` extensions,
// which do not resolve under this repo's `moduleResolution: "bundler"` (no
// `allowImportingTsExtensions`). No repo source static-imports pi-ai types for
// that reason (cf. `pi-ai-shape.test.ts`, which loads it dynamically). So we
// import the namespace and read the runtime helpers off an `any` view, and use
// local minimal types for the shapes we touch. Runtime resolution is unaffected.
import * as piAi from "@earendil-works/pi-ai";

const { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } =
  piAi as unknown as {
    fauxAssistantMessage: (content: unknown, options?: unknown) => unknown;
    fauxText: (text: string) => unknown;
    fauxThinking: (thinking: string) => unknown;
    fauxToolCall: (name: string, args: Record<string, unknown>, options?: unknown) => MiniToolCall;
  };

/** Minimal structural type for a faux tool-call content block. */
export interface MiniToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A scripted step: a faux assistant message or a factory of one. */
export type FauxResponseStep =
  | unknown
  | ((context: FauxContext, options: unknown, state: { callCount: number }, model: unknown) => unknown);

/** Minimal view of the agent context a factory step reads. */
export interface FauxContext {
  /**
   * Final assembled system prompt pi-ai passes to the provider (`Context.systemPrompt`).
   * Carries the dashboard `before_agent_start` injector fragment when present.
   * See change: inject-session-context-into-agent.
   */
  systemPrompt?: string;
  messages: Array<{
    role: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
}

/**
 * Opening delimiter the dashboard session-context injector emits. Kept in sync
 * with `CONTEXT_DELIMITER` in `packages/extension/src/dashboard-context-injector.ts`.
 * Duplicated (not imported) so the faux catalog stays decoupled from the
 * extension package. See change: inject-session-context-into-agent.
 */
export const DASHBOARD_CONTEXT_DELIMITER = "── pi-dashboard session context ──";
/** Sentinel streamed when no dashboard fragment is found in the system prompt. */
export const NO_DASHBOARD_CONTEXT_MARKER = "NO_DASHBOARD_CONTEXT";

/**
 * Slice the dashboard session-context fragment (delimiter through end) out of a
 * system prompt. Returns NO_DASHBOARD_CONTEXT_MARKER when absent. Matches the
 * LAST delimiter occurrence (the injector splices at the tail). Pure.
 * See change: inject-session-context-into-agent.
 */
export function extractDashboardFragment(systemPrompt: string | undefined): string {
  const sp = systemPrompt ?? "";
  const idx = sp.lastIndexOf(DASHBOARD_CONTEXT_DELIMITER);
  return idx === -1 ? NO_DASHBOARD_CONTEXT_MARKER : sp.slice(idx);
}

/**
 * Marker a flow-agent's system prompt embeds so the faux provider can branch
 * its reply per agent. The synthetic e2e flow's agent `.md` bodies carry
 * `[[flow-agent:<name>]]`; the `flow-agent-branch` scenario reads it off
 * `context.systemPrompt` and echoes a per-agent completion line. Keeps the
 * fixture as pure data + a factory — no per-spec wiring.
 * See change: add-flow-plugin-e2e-tests.
 */
export const FLOW_AGENT_MARKER = /\[\[flow-agent:([\w-]+)\]\]/;

/** Extract the flow-agent name from a system prompt, or `"unknown"` when absent. Pure. */
export function flowAgentName(systemPrompt: string | undefined): string {
  const match = FLOW_AGENT_MARKER.exec(systemPrompt ?? "");
  return match ? match[1] : "unknown";
}

/** Assertion hints shared across both test layers. */
export interface ScenarioExpect {
  /** Substring that MUST appear in the streamed assistant text. */
  text?: string;
  /** Tool name a single-tool scenario emits (renderer-matrix scenarios). */
  toolName?: string;
  /** `ask_user` method a single-interactive scenario emits. */
  method?: string;
}

export interface Scenario {
  script: FauxResponseStep[];
  expect: ScenarioExpect;
}

/** Marker text the happy-path scenario streams; asserted verbatim downstream. */
export const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

/**
 * Inline-screenshot scenario (Fix B end-to-end). A real `bash` tool call writes
 * a tiny valid PNG UNDER THE DEFAULT ARTIFACT ROOT (`$HOME/.agent-browser/tmp`,
 * = `/home/pi/...` in the test container) so the bridge's artifact-root gate
 * allows it, then echoes `Screenshot saved: <path>`. The bridge's tool-result
 * inliner (`inlineToolResultImages`) reads the file at `tool_execution_end`,
 * attaches a `type:"image"` block, and strips the path so no dead link renders.
 * The e2e asserts the inline `<img>` + path-consumption.
 * See change: inline-agent-screenshot-artifacts.
 */
export const SCREENSHOT_INLINE = {
  // Resolved path the bash result echoes (container HOME is /home/pi). Inside
  // the default artifact root, so the bridge containment gate permits inlining.
  path: "/home/pi/.agent-browser/tmp/e2e-shot.png",
  mime: "image/png",
} as const;

/** 1×1 transparent PNG (67 bytes), base64. Valid bytes → inliner accepts it. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Long text used by the slow-stream/abort scenario (paired with FAUX_TPS=2). */
const SLOW_TEXT = Array.from(
  { length: 40 },
  (_unused, index) => `slow-chunk-${index}`,
).join(" ");

/**
 * Pull the most recent `ask_user` answer out of the agent context.
 *
 * The factory step for `ask-select-roundtrip` reads the toolResult the dashboard
 * posts back after the user submits, so the follow-up text reflects the choice.
 */
function lastToolResultText(context: FauxContext): string {
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index];
    if (message.role === "toolResult") {
      return (message.content ?? [])
        .map((block) => (block.type === "text" ? block.text ?? "" : ""))
        .join("")
        .trim();
    }
  }
  return "(no answer)";
}

/**
 * Deterministic marker prefix for the `tool-list-models` scenario (change:
 * fix-list-models-empty-on-unhydrated-registry). Step 1 executes the REAL bridge
 * `list_models` tool against the faux-populated session registry; step 2 reads
 * the tool result out of context and echoes the readiness discriminator as plain
 * assistant text the e2e asserts. `faux/faux-1` (registered via
 * `pi.registerProvider`) guarantees a hydrated, non-empty catalogue — so this is
 * the live end-to-end proof of the `registryReady: true` / populated path (V.2).
 */
export const LIST_MODELS_MARKER_PREFIX = "list-models registryReady=";

/**
 * Read the `list_models` tool result out of context and render the readiness
 * discriminator as a single deterministic line. Pure; parse-safe (a malformed
 * or absent result yields `parse-error`, never a throw). Mirrors the
 * `ask-select-roundtrip` factory that reads `lastToolResultText(context)`.
 */
export function summarizeListModelsResult(context: FauxContext): string {
  const raw = lastToolResultText(context);
  try {
    const parsed = JSON.parse(raw) as {
      registryReady?: unknown;
      models?: Array<{ ref?: string }>;
    };
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    const hasFaux = models.some((m) => m?.ref === "faux/faux-1");
    return `${LIST_MODELS_MARKER_PREFIX}${String(parsed.registryReady)} count=${models.length} hasFaux=${hasFaux}`;
  } catch {
    return `${LIST_MODELS_MARKER_PREFIX}parse-error count=-1 hasFaux=false`;
  }
}

/** Build a single-tool-call scenario for the client renderer matrix. */
function toolScenario(
  name: string,
  args: Record<string, unknown>,
): Scenario {
  return {
    script: [
      fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
    ],
    expect: { toolName: name },
  };
}

/** Build a single `ask_user` scenario for the interactive renderer matrix. */
function askScenario(method: string, extra: Record<string, unknown>): Scenario {
  return {
    script: [
      fauxAssistantMessage(
        [fauxToolCall("ask_user", { method, ...extra })],
        { stopReason: "toolUse" },
      ),
    ],
    expect: { method },
  };
}

/**
 * Tail marker for the `long-transcript` scenario — the last plain-text message.
 * The virtualization e2e (`tests/e2e/chat-transcript-virtualization.spec.ts`)
 * waits for this text to know the long stream has settled, and asserts the
 * streaming tail against it. See change: virtualize-chat-transcript-tanstack.
 */
export const LONG_TRANSCRIPT_TAIL = "long-transcript complete";

/**
 * Build a deliberately LONG, heterogeneous transcript (Step B e2e fixture).
 *
 * Each turn streams a thinking block + an assistant text reply + one DISTINCT
 * bash tool call. The non-empty assistant text is a HARD burst boundary, so each
 * tool call renders as its own single-member burst (thinking absorbed inside)
 * yielding ~2 top-level rows per turn. `turns` turns therefore span several
 * viewports — enough to force a >50px scroll-up AND to make windowing observable
 * (mounted `[data-index]` rows bounded far below the total). The final plain-text
 * step (`LONG_TRANSCRIPT_TAIL`) terminates the run. `burst-heterogeneous` is too
 * short for any of this; this is the single fixture that unblocks the 6 e2e specs.
 */
function buildLongTranscript(turns = 120): FauxResponseStep[] {
  const steps: FauxResponseStep[] = [];
  for (let i = 0; i < turns; i++) {
    steps.push(
      fauxAssistantMessage(
        [
          fauxThinking(`step ${i}: weighing probe ${i}`),
          fauxText(`Investigating item ${i} of the long transcript.`),
          fauxToolCall("bash", { command: `echo long-${i}` }),
        ],
        { stopReason: "toolUse" },
      ),
    );
  }
  steps.push(fauxAssistantMessage([fauxText(LONG_TRANSCRIPT_TAIL)]));
  return steps;
}

/**
 * Tail marker for the `scroll-top-heavy` scenario (change: fix-chat-scroll-to-
 * top-estimate-drift). The scroll-to-top e2e waits for it to know the transcript
 * settled at the bottom before climbing.
 */
export const SCROLL_TOP_HEAVY_TAIL = "scroll-top-heavy complete";

/**
 * Top-heavy transcript fixture (change: fix-chat-scroll-to-top-estimate-drift,
 * task 1.1). The LARGEST rows sit near the TOP — a ~16k-char thinking block, a
 * ~9k-char assistant text, a ~24k-char bash toolResult, and an inline image —
 * mirroring the reproducing session (biggest rows ~5th-from-top, under-estimated
 * 10-50x by the OLD static per-role estimate). `trailingTurns` small turns push
 * them far above the bottom so scrolling up / scroll-to-top must climb past them.
 * Gates the content-aware estimate + scroll-to-top convergence that jsdom cannot
 * reproduce (the scroll-timing / async-image-remeasure race). Tail =
 * SCROLL_TOP_HEAVY_TAIL.
 */
function buildScrollTopHeavy(trailingTurns = 40): FauxResponseStep[] {
  const hugeThinking = "reasoning about the oversized top rows ".repeat(420); // ~16k chars
  const hugeText = "This assistant reply is deliberately enormous. ".repeat(190); // ~9k chars
  const steps: FauxResponseStep[] = [
    // Turn 0: the biggest text rows + a ~24k-char bash toolResult, all near top.
    fauxAssistantMessage(
      [
        fauxThinking(hugeThinking),
        fauxText(hugeText),
        fauxToolCall("bash", {
          command: 'for i in $(seq 1 800); do echo "scroll-top padding line $i xxxxxxxxxxxxxxxxxxxxxxxx"; done',
        }),
      ],
      { stopReason: "toolUse" },
    ),
    // Turn 1: an inline image near the top (async <img> decode -> row remeasure).
    // Reuses the screenshot inliner: bash writes a PNG + echoes its path; the
    // bridge attaches a type:"image" block.
    fauxAssistantMessage(
      [
        fauxToolCall("bash", {
          command:
            `mkdir -p "$HOME/.agent-browser/tmp" && printf %s '${TINY_PNG_B64}' | base64 -d > "$HOME/.agent-browser/tmp/scroll-top-shot.png" && ` +
            `echo "Screenshot saved: $HOME/.agent-browser/tmp/scroll-top-shot.png"`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ];
  for (let i = 0; i < trailingTurns; i++) {
    steps.push(
      fauxAssistantMessage(
        [fauxText(`trailing turn ${i}`), fauxToolCall("bash", { command: `echo trail-${i}` })],
        { stopReason: "toolUse" },
      ),
    );
  }
  steps.push(fauxAssistantMessage([fauxText(SCROLL_TOP_HEAVY_TAIL)]));
  return steps;
}

/**
 * Later-inference marker for the supersede-heal e2e. The second scripted
 * assistant message (a NEW `message_start`) is the proof-of-completion signal
 * the supersede heal requires. See change: fix-stuck-tool-card-superseded-heal.
 */
export const SUPERSEDE_HEAL_MARKER = "supersede-heal follow-up landed";

/**
 * Completion marker for the `oversized-turn` scenario. The scenario drives a
 * bash tool call that emits a large multi-KB output — the kind of oversized,
 * forwarded event that used to OOM-crash the server inside a single
 * `JSON.stringify` on the broadcast path. The liveness e2e
 * (`tests/e2e/oversized-event-liveness.spec.ts`) waits for this text to know the
 * heavy turn settled, then proves the server stayed up and responsive.
 * See change: bound-subagent-event-serialization.
 */
export const OVERSIZED_TURN_MARKER = "oversized-turn complete";

export const SCENARIOS: Record<string, Scenario> = {
  // ── Server-side round-trip scenarios ────────────────────────────────────
  "plain-text": {
    script: [fauxAssistantMessage([fauxText(PLAIN_TEXT_MARKER)])],
    expect: { text: PLAIN_TEXT_MARKER },
  },

  // Echoes the dashboard session-context fragment out of the live system
  // prompt back as assistant text, proving the bridge `before_agent_start`
  // injector reaches the model end-to-end (bridge → pi pipeline → provider).
  // See change: inject-session-context-into-agent.
  "echo-system-context": {
    script: [
      (context: FauxContext) =>
        fauxAssistantMessage([fauxText(extractDashboardFragment(context.systemPrompt))]),
    ],
    expect: { text: DASHBOARD_CONTEXT_DELIMITER },
  },

  "slow-stream": {
    // Long body so a mid-stream abort (with FAUX_TPS=2) lands before `done`.
    script: [fauxAssistantMessage([fauxText(SLOW_TEXT)])],
    expect: { text: "slow-chunk-0" },
  },

  "model-error": {
    script: [
      fauxAssistantMessage("faux boom", {
        stopReason: "error",
        errorMessage: "faux model error",
      }),
    ],
    expect: { text: "faux model error" },
  },

  "isolation-a": {
    script: [fauxAssistantMessage([fauxText("ISOLATION_MARKER_AAA")])],
    expect: { text: "ISOLATION_MARKER_AAA" },
  },

  "isolation-b": {
    script: [fauxAssistantMessage([fauxText("ISOLATION_MARKER_BBB")])],
    expect: { text: "ISOLATION_MARKER_BBB" },
  },

  // Assistant text carrying a unified-diff header. Exercises tool-output
  // linkification end-to-end: MarkdownContent linkifies the `a/`/`b/` paths,
  // the tokenizer strips the diff prefix from the resolved path, and clicking
  // the (nonexistent) target opens the stale-file preview message.
  // See change: selectable-tool-output-links.
  "text-difflinks": {
    script: [
      fauxAssistantMessage([
        fauxText("diff --git a/src/ghost.ts b/src/ghost.ts"),
      ]),
    ],
    expect: { text: "src/ghost.ts" },
  },

  // Assistant text referencing a `~/.pi/…` home config file. Exercises the
  // Phase-1 tilde-home mention path end-to-end: the client tokenizer emits ONE
  // `~/…` FileLink, and on click the server resolve endpoint expands `~/` and
  // authorizes it via the fixed `~/.pi` anchor — so the preview opens the
  // resolved home file (`$HOME/.pi/agent/settings.json`, seeded by
  // test-entrypoint under PI_E2E_SEED), NOT a `/`-rooted 404 from the old
  // tilde-split bug. See change: server-side-file-mention-resolution.
  "text-tildelink": {
    script: [
      fauxAssistantMessage([
        fauxText("see ~/.pi/agent/settings.json for the config"),
      ]),
    ],
    expect: { text: "settings.json" },
  },

  // Assistant text referencing a REAL fixture file. The explicit `./` prefix
  // gives the tokenizer the separator it needs to linkify (a bare `hello.txt`
  // has no separator and stays prose); the link resolves against the session
  // cwd to `/fixtures/sample-git/hello.txt`, which `/api/file` reads
  // successfully — so the preview overlay shows real content. Used by the
  // file-preview-survives-churn e2e to assert the overlay persists across
  // message churn with live content (not a stale-file error body).
  // See change: fix-file-preview-survives-message-churn.
  "text-realfile": {
    script: [
      fauxAssistantMessage([fauxText("preview ./hello.txt for the greeting")]),
    ],
    expect: { text: "hello.txt" },
  },

  // Assistant text with an inline-code span carrying a file path + a URL.
  // Inline code is linkified (markdown does not autolink inside code), so this
  // renders a real FileLink (button) and UrlLink (anchor) — the surfaces whose
  // selectability (drag-to-select, not drag-the-link) this change guarantees.
  // See change: selectable-tool-output-links.
  "text-linkrefs": {
    script: [
      fauxAssistantMessage([
        fauxText("refs `src/example.ts https://example.com/page` end"),
      ]),
    ],
    expect: { text: "src/example.ts" },
  },

  // Assistant text carrying a fenced mermaid diagram mixing default
  // (un-authored) and authored nodes. Exercises MermaidBlock default-node
  // colorization end-to-end: default nodes (A, C) get a soft accent wash;
  // the `style B fill:#ff0000` node keeps its author color untouched.
  // See change: colorize-mermaid-default-nodes.
  "mermaid-colorize": {
    script: [
      fauxAssistantMessage([
        fauxText(
          "```mermaid\ngraph TD\n  A[Alpha] --> B[Bravo]\n  A --> C[Charlie]\n  style B fill:#ff0000\n```",
        ),
      ]),
    ],
    expect: { text: "Alpha" },
  },

  // Copy-surfaces round-trip. Streams an assistant message carrying a GFM table
  // AND a fenced code block so one render exercises all four copy buttons:
  //   - table "Copy as Markdown" / "Copy as TSV" (TableWrapper, ref-at-click),
  //   - code-block "Copy code" (CodeBlockWrapper),
  //   - message "Copy as plain text" (MessageBubble.getPlainText, ref-at-click).
  // MarkdownContent is React.memo → a completed message renders exactly once, so
  // the payloads MUST resolve at click time (post-commit) or copy the empty
  // string. See change: fix-table-copy-empty-clipboard.
  "copy-surfaces": {
    script: [
      fauxAssistantMessage([
        fauxText(
          "Here is a table and some code.\n\n| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |\n\n```js\nconst x = 1;\n```",
        ),
      ]),
    ],
    expect: { text: "Alice" },
  },

  "thinking-text": {
    script: [
      fauxAssistantMessage([
        fauxThinking("faux is thinking about the prompt"),
        fauxText("done thinking"),
      ]),
    ],
    expect: { text: "done thinking" },
  },

  // ── ask_user answer round-trip ──────────────────────────────────────────
  "ask-select-roundtrip": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("ask_user", {
            method: "select",
            title: "Pick one",
            options: ["a", "b"],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context: FauxContext) =>
        fauxAssistantMessage([fauxText(`you picked ${lastToolResultText(context)}`)]),
    ],
    expect: { text: "you picked" },
  },

  // ── Client tool-renderer matrix (one per registry entry + unknown) ──────
  "tool-read": toolScenario("read", { path: "src/example.ts" }),
  // Reads a file that REALLY exists in the sample-git fixture, so the
  // OpenFileButton → internal Monaco editor pane opens a path the server can
  // serve. Used by tests/e2e/editor-pane.spec.ts.
  // See change: add-internal-monaco-editor-pane.
  "tool-read-fixture": toolScenario("read", { path: "README.md" }),
  "tool-edit": toolScenario("edit", {
    path: "src/example.ts",
    edits: [{ oldText: "alpha", newText: "beta" }],
  }),
  "tool-write": toolScenario("write", {
    path: "src/new-file.ts",
    content: "export const x = 1;\n",
  }),
  // opt-in-out-of-cwd-session-diffs: a Write OUTSIDE the session cwd. pi really
  // creates the file (writable /tmp in the harness); the server carries it into
  // data.files keyed by absolute path (payload-only, previewable:false). Drives
  // tests/e2e/out-of-cwd-session-diffs.spec.ts (F1/F2/F4/F5, X1).
  "tool-write-out-of-cwd": toolScenario("write", {
    path: "/tmp/e2e-out-of-cwd/index.html",
    content: "<!doctype html>\n<h1>out of cwd mockup</h1>\n",
  }),
  // A >4 KB out-of-cwd Write: the in-memory event store truncates `content`
  // (`…[truncated]`) while the session JSONL keeps it whole → the client lazy-
  // fetches full fidelity (F3). 6000 chars comfortably exceeds the 4 KB cap.
  "tool-write-out-of-cwd-large": toolScenario("write", {
    path: "/tmp/e2e-out-of-cwd/big.html",
    content: `<!doctype html>\n<!-- ${"A".repeat(6000)} -->\n<h1>big out of cwd</h1>\n`,
  }),
  "tool-bash": toolScenario("bash", { command: "ls -la" }),
  // Strategy B (reduce-session-replay-traffic): a bash result with > 200 LINES.
  // On a FULL replay the server pre-truncates it to the display form
  // (`«N earlier lines hidden»` + last 200 lines) to trim replay bytes; the
  // client renders the truncated form + a "Show full output" affordance
  // (develop's adopt-pi-071-072-073-features mechanism). 500 numbered lines so
  // line 1 (HEADMARKER-1) is dropped from the 200-line tail. Two-step so the
  // agent TERMINATES after the tool result.
  "tool-bash-large": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command: "seq 1 500 | sed 's/^/HEADMARKER-/'",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("large output done")]),
    ],
    expect: { toolName: "bash" },
  },
  // Oversized-event liveness driver (change: bound-subagent-event-serialization).
  // A bash call emits ~8000 numbered lines (~90 KB raw) — a genuinely large
  // tool-result event that flows through the real ingest → persist → broadcast
  // (`JSON.stringify`) path. Before the per-event size ceiling, a payload like a
  // subagent's full timeline crashed the whole server here with a V8 OOM. The
  // e2e drives this then asserts /api/health stays 200 and a follow-up turn
  // round-trips (server alive + responsive). Two-step so the agent TERMINATES
  // after the tool result.
  "oversized-turn": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command: "seq 1 8000 | sed 's/^/OVERSIZED-/'",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText(OVERSIZED_TURN_MARKER)]),
    ],
    expect: { text: OVERSIZED_TURN_MARKER },
  },
  // Fix B end-to-end: bash writes a real PNG + echoes its absolute path; the
  // bridge inlines it as a type:"image" block. Two-step so the agent TERMINATES
  // after the tool result (a single-step tool scenario would loop forever in a
  // real pi session, never settling the UI). See change:
  // inline-agent-screenshot-artifacts.
  "tool-screenshot": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            // Use $HOME (expands to /home/pi) so the command DISPLAY keeps the
            // literal `$HOME/...` while the RESULT echoes the resolved path —
            // keeping the D5 exact-path assertion isolated to the result.
            command:
              `mkdir -p "$HOME/.agent-browser/tmp" && printf %s '${TINY_PNG_B64}' | base64 -d > "$HOME/.agent-browser/tmp/e2e-shot.png" && ` +
              `echo "Screenshot saved: $HOME/.agent-browser/tmp/e2e-shot.png"`,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("screenshot captured")]),
    ],
    expect: { toolName: "bash" },
  },
  // detect-tool-created-files (U1/U3): a bash tool call writes a NEW file into
  // the session cwd (a git repo). session-diff's git-status detector + Bash
  // attributor surface it as an `origin:"tool"` row with `producedBy`. Two-step
  // so the agent terminates after the tool result. See change:
  // detect-tool-created-files.
  "tool-bash-artifact": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            // Unique content each run so a re-run in a shared container (where a
            // prior run's cleanup committed the file) still produces a git
            // change → the detector re-surfaces it. See change:
            // detect-tool-created-files.
            command: "echo generated-by-tool-$(date +%s%N) > tool-artifact.md",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("artifact written")]),
    ],
    expect: { toolName: "bash" },
  },
  "tool-ctx": toolScenario("ctx_execute", {
    language: "shell",
    code: "echo hi",
  }),
  // Running-state render fixture (fix-ctx-running-render). A single
  // `ctx_batch_execute` call carrying `args.commands`; the e2e DROPS the
  // tool's `tool_execution_end` WS frame so the card stays RUNNING, proving
  // the args-derived header chip (`▦ N cmds`) + command-list RunningPreview
  // render mid-run instead of a bare `Running…` + duplicated tool name.
  "ctx-batch-running": toolScenario("ctx_batch_execute", {
    commands: [
      { label: "list files", command: "echo list-files" },
      { label: "count lines", command: "echo count-lines" },
    ],
    queries: ["find the thing"],
  }),
  "tool-agent": toolScenario("Agent", {
    subagent_type: "Explore",
    description: "find faux usages",
    prompt: "Locate all faux provider references.",
  }),
  "tool-unknown": toolScenario("some_unknown_tool", { foo: "bar" }),

  // Registry-readiness discriminator, live (change:
  // fix-list-models-empty-on-unhydrated-registry). Step 1 executes the REAL
  // bridge `list_models` tool against the faux-populated session registry
  // (`faux/faux-1` is registered via pi.registerProvider, so getAvailable() is
  // non-empty). Step 2 reads the tool result back out of context and echoes the
  // discriminator (`registryReady`, model count, `faux/faux-1` presence) as
  // plain text — a robust marker the e2e asserts without touching tool-card
  // collapse/virtualization. Proves the steady-state `registryReady: true` +
  // populated catalogue path (V.2); the absent-registry race (V.3) stays
  // unit-proven (role-model-tools-registry-readiness.test.ts case A).
  "tool-list-models": {
    script: [
      fauxAssistantMessage([fauxToolCall("list_models", {})], { stopReason: "toolUse" }),
      (context: FauxContext) => fauxAssistantMessage([fauxText(summarizeListModelsResult(context))]),
    ],
    expect: { text: LIST_MODELS_MARKER_PREFIX },
  },

  // Temporal burst: three DISTINCT bash calls in a row (heterogeneous, so the
  // semantic ×N pass never merges them) with the LAST one slow, so a window
  // exists where 2 are done and 1 runs. groupToolBursts wraps them into one
  // burst group: auto-expanded + "Working · 2 done · $ sleep …" while running,
  // auto-collapsed to "3 tool calls" once the final text lands. Four steps so
  // the agent TERMINATES after the burst. See change: group-tool-call-bursts.
  "burst-heterogeneous": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo burst-one" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo burst-two" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 2 && echo burst-three" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("burst complete")]),
    ],
    expect: { text: "burst complete" },
  },

  // Supersede-heal fixture (fix-stuck-tool-card-superseded-heal). One bash tool
  // call (inference #1) followed by a plain-text reply (inference #2 → a LATER
  // assistant message_start = the completion proof). The e2e DROPS the tool's
  // `tool_execution_end` WS frame (server→browser drop) and 404s the reconcile
  // route (store eviction), so the card is unrecoverable yet provably finished
  // → the client supersede heal must finalize it + badge it. Two steps so the
  // agent terminates after the follow-up text.
  "stuck-tool-superseded": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo supersede-probe" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText(SUPERSEDE_HEAL_MARKER)]),
    ],
    expect: { text: SUPERSEDE_HEAL_MARKER },
  },

  // Long heterogeneous transcript spanning several viewports (Step B e2e gate).
  // Streams ~120 turns of thinking + text + a distinct bash call, so the
  // transcript is long enough to force a >50px scroll-up and to make TanStack
  // windowing observable. Tail = LONG_TRANSCRIPT_TAIL. See change:
  // virtualize-chat-transcript-tanstack (task 9.1).
  "long-transcript": {
    script: buildLongTranscript(),
    expect: { text: LONG_TRANSCRIPT_TAIL },
  },

  // Top-heavy transcript: the biggest rows (16k thinking, 9k text, 24k bash
  // toolResult, inline image) sit near the TOP, then ~40 small turns. Gates the
  // content-aware estimate + scroll-to-top convergence (scroll-up must land on
  // index 0 without the top receding). See change:
  // fix-chat-scroll-to-top-estimate-drift.
  "scroll-top-heavy": {
    script: buildScrollTopHeavy(),
    expect: { text: SCROLL_TOP_HEAVY_TAIL },
  },

  // Navigable variant for the scroll-to-TURN e2e. A faux scenario has ONE user
  // turn, so only turn 0 is ever assigned a turnIndex; its per-turn stat must
  // stay inside the client's MAX_TURN_STATS=50 window or the TokenStatsBar
  // butterfly renders no clickable `turn-bar`. 40 turns keeps turn 0's stat
  // (and its bar) alive while still pushing turn 0 well off-screen (~80 rows
  // below). Same tail marker. See change: virtualize-chat-transcript-tanstack
  // (task 9.3 — off-screen scrollToTurn trigger).
  "long-transcript-nav": {
    script: buildLongTranscript(40),
    expect: { text: LONG_TRANSCRIPT_TAIL },
  },

  // Composition flip (collapse-tool-calls-across-narration): a NARRATED poll
  // loop — four IDENTICAL bash calls each preceded by a line of narration prose
  // in the same tool-use turn. The semantic pass runs first over the full
  // stream and treats prose as transparent, so all four fold into ONE ×4
  // CollapsedToolGroup with the narration absorbed into `rendered` (visible
  // only when expanded). The trailing "poll complete" is NOT absorbed and
  // renders at the top level. Five steps so the agent TERMINATES.
  "poll-narrated": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo checking" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("still starting"), fauxToolCall("bash", { command: "echo checking" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("still starting"), fauxToolCall("bash", { command: "echo checking" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("still starting"), fauxToolCall("bash", { command: "echo checking" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("poll complete")]),
    ],
    expect: { text: "poll complete" },
  },

  // Composition flip — a heterogeneous investigation split by a MID-TURN reply.
  // Three distinct bash calls, then a non-empty assistant reply (HARD boundary
  // for burst formation), then three more distinct bash calls, then the final
  // text. Renders as: burst, the reply at the TOP level, burst. Seven steps.
  "burst-split-by-reply": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-a1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-a2" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-a3" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("found the cause"), fauxToolCall("bash", { command: "echo probe-b1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-b2" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-b3" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("split complete")]),
    ],
    expect: { text: "split complete" },
  },

  // Universal grouping (enhance-tool-call-grouping): a SINGLE tool call now
  // forms a framed group that renders its own one-line summary (NOT "1 tool
  // calls"). Two steps so the agent terminates.
  "grp-single": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo single-call" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("single done")]),
    ],
    expect: { text: "single done" },
  },

  // Turn-scoped reasoning folding (enhance-tool-call-grouping): a TRAILING
  // `thinking` row after the last tool is absorbed INTO the group and renders
  // as a real ThinkingBlock (labeled "Reasoning"), not demoted narration. The
  // trailing `thinking`+`text` pattern replays reliably (matches thinking-text).
  // Requires "Reasoning blocks" ON to see the folded reasoning.
  "grp-reasoning": {
    script: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-one" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-two" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo probe-three" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([
        fauxThinking("all three probed; the cause is the stale cache"),
        fauxText("reasoning burst complete"),
      ]),
    ],
    expect: { text: "reasoning burst complete" },
  },

  // ── Flow / subagent scenario family (L3 activation + render) ─────────────
  // Per-agent branching by system prompt. Each agent in the synthetic e2e flow
  // carries `[[flow-agent:<name>]]` in its `.md` body; the flow step wires
  // `task: "[[faux:flow-agent-branch]] …"` so the agent's rendered user message
  // selects THIS scenario, and the factory reads the agent's systemPrompt marker
  // to echo a deterministic per-agent completion line. Drives the REAL pi-flows
  // engine at L3 with agents resolving to faux/faux-1 (via the faux role-preset).
  //
  // A pi-flows agent step terminates by calling the guard's `finish` tool. The
  // finish schema (mirrored from pi-flows' own extensions/flow-engine/testing.ts
  // `FinishArgs` — NOT imported, per design D2's hermetic-L2 decision) requires
  // `{ status, summary, files }` PLUS the agent's declared typed outputs (`note`).
  // A finish MISSING status/summary/files fails the guard schema (isError) so the
  // finish-latch never fires and the agent loops forever. The tool name is bare
  // `finish` (pi-flows only mcp__flows__-prefixes for anthropic-messages models;
  // faux/faux-1's api is `faux`). No explicit stopReason — mirrors `scriptFinish`.
  // On success the latch aborts the agent, `flow_agent_complete` fires with the
  // note in typedOutputs, and the flow advances. See change: add-flow-plugin-e2e-tests.
  "flow-agent-branch": {
    script: [
      (context: FauxContext) =>
        fauxAssistantMessage([
          fauxToolCall("finish", {
            status: "complete",
            summary: `flow-agent ${flowAgentName(context.systemPrompt)} done`,
            files: [],
            note: `flow-agent ${flowAgentName(context.systemPrompt)} done`,
          }),
        ]),
    ],
    expect: { text: "flow-agent" },
  },

  // Spawns a REAL subagent via the `Agent` tool, then terminates. The spawned
  // subagent's prompt embeds a `[[faux:plain-text]]` sentinel so it resolves the
  // plain-text scenario, replies once, and completes — firing the subagent
  // lifecycle events (`subagents:created/started/completed`) the subagents-plugin
  // bridge forwards and its inspector renders. Two steps so the PARENT session
  // terminates after the subagent returns. See change: add-flow-plugin-e2e-tests.
  "subagent-spawn": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("Agent", {
            subagent_type: "Explore",
            description: "faux subagent probe",
            prompt: "[[faux:plain-text]] run the faux subagent probe",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("subagent spawn complete")]),
    ],
    expect: { text: "subagent spawn complete" },
  },

  // ── auto-canvas driver scenarios (change: auto-canvas, Sections 6–8) ────
  // A `write` of a renderable markdown deliverable. The server-side detect
  // (write/edit only, gated by RENDERER_BY_EXT + canvasTypes) pushes a DOC
  // candidate and broadcasts `canvas_intent{phase:"eager"}` immediately, then
  // `settle` at agent_end. pi executes the REAL write tool, so `report.md`
  // lands in the session cwd and `/api/file` can serve it. Two-step so the
  // agent terminates after the write. Drives S23–S28 (client canvas surface).
  "canvas-write-md": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("write", {
            path: "report.md",
            content: "# Auto-canvas report\n\nThe deliverable the canvas opens.\n",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("report written")]),
    ],
    expect: { toolName: "write" },
  },

  // A `write` of an HTML deliverable carrying an external-image beacon. The
  // auto-open path renders it under a restrictive CSP so the beacon subresource
  // is blocked (S34). Two-step terminate.
  "canvas-write-html-beacon": {
    script: [
      fauxAssistantMessage(
        [
          fauxToolCall("write", {
            path: "beacon.html",
            content:
              '<!doctype html><html><head><title>b</title></head><body>' +
              '<img data-testid="beacon-img" src="http://attacker.example/beacon.gif">' +
              "canvas beacon doc</body></html>\n",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("beacon html written")]),
    ],
    expect: { toolName: "write" },
  },

  // A `canvas({ target:{ kind:"server", port } })` declare. The server
  // normalizes it to a ServerChip and broadcasts `canvas_server_chip` with NO
  // pre-tap fetch (S29). Drives the server-chip UI (S29–S32). Two-step
  // terminate. `canvas` is the real bridge-registered declare tool.
  "canvas-declare-server": {
    script: [
      fauxAssistantMessage(
        [fauxToolCall("canvas", { target: { kind: "server", port: 5173 }, title: "dev server" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("server declared")]),
    ],
    expect: { toolName: "canvas" },
  },

  // A `canvas({ target:{ kind:"server", port } })` declare for a port nothing
  // listens on. On chip tap the loopback probe is refused → "server not
  // running" immediately, no iframe (S30). Two-step terminate.
  "canvas-declare-server-dead": {
    script: [
      fauxAssistantMessage(
        [fauxToolCall("canvas", { target: { kind: "server", port: 59321 }, title: "dead server" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("dead server declared")]),
    ],
    expect: { toolName: "canvas" },
  },

  // A `canvas({ target:{ kind:"url", url } })` declare (youtube). Renders the
  // live URL normally with NO document CSP (S35). Two-step terminate.
  "canvas-declare-url": {
    script: [
      fauxAssistantMessage(
        [fauxToolCall("canvas", { target: { kind: "url", url: "https://youtu.be/dQw4w9WgXcQ" } })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("url declared")]),
    ],
    expect: { toolName: "canvas" },
  },

  // ── Client interactive-renderer matrix (one per ask_user method) ────────
  "ask-confirm": askScenario("confirm", { title: "Proceed?" }),
  "ask-select": askScenario("select", {
    title: "Choose one",
    options: ["alpha", "beta"],
  }),
  "ask-multiselect": askScenario("multiselect", {
    title: "Choose many",
    options: ["one", "two", "three"],
  }),
  "ask-input": askScenario("input", {
    title: "Your name?",
    placeholder: "name",
  }),
  "ask-editor": askScenario("editor", {
    title: "Edit the draft",
    content: "draft body",
  }),
  "ask-batch": askScenario("batch", {
    title: "Setup",
    questions: [
      { method: "input", title: "Project name" },
      { method: "confirm", title: "Init git?" },
    ],
  }),
  "ask-notify": askScenario("notify", { title: "Heads up", message: "done" }),
  "ask-unknown-method": askScenario("totally-unknown-method", {
    title: "Mystery",
  }),
};

export type ScenarioId = keyof typeof SCENARIOS;
