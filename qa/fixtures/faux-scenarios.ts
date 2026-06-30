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
  "tool-ctx": toolScenario("ctx_execute", {
    language: "shell",
    code: "echo hi",
  }),
  "tool-agent": toolScenario("Agent", {
    subagent_type: "Explore",
    description: "find faux usages",
    prompt: "Locate all faux provider references.",
  }),
  "tool-unknown": toolScenario("some_unknown_tool", { foo: "bar" }),

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
