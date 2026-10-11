/**
 * Repo-level invariant: the dashboard shell SHALL NOT carry flow-
 * specific RENDERING or STATE code. This lint scans a curated set of
 * "shell-rendering" files for forbidden identifiers (component names,
 * deleted state fields, deleted scalars) and fails CI if any reappear.
 *
 * What this lint catches:
 *
 *   - Imports from `pi-dashboard-flows-plugin/client` in shell files.
 *   - Identifiers like `FlowDashboard`, `FlowArchitect`, `FlowAgentDetail`,
 *     `FlowArchitectDetail`, `FlowSummary`, `FlowActivityBadge`,
 *     `SessionFlowActions`, `FlowLaunchDialog` — a reintroduction of
 *     any indicates the shell rendering them again.
 *   - Identifiers `flowState`, `flowStates`, `architectState` — deleted
 *     `SessionState` fields.
 *   - Identifiers `activeFlowName`, `flowAgentsDone`, `flowAgentsTotal`,
 *     `flowStatus` — deleted `DashboardSession` scalars.
 *   - `hasActiveFlow` — deleted predicate (replaced by component self-gate).
 *
 * What this lint does NOT catch (intentional):
 *
 *   - `flow_*` / `architect_*` event/message TYPE STRINGS in the wire
 *     protocol (the shell still receives & forwards them; the plugin
 *     is the consumer).
 *   - `overflow`, `workflow`, etc. (CSS / unrelated words).
 *   - Comments / breadcrumb strings referencing the change name.
 *   - References inside `flows-plugin/`, `tests/`, or wire-protocol
 *     files (`protocol.ts`, `browser-protocol.ts`).
 *
 * If this test fails, the suggested replacement depends on what the
 * shell file is trying to do:
 *
 *   - Render flow content       → use a slot consumer
 *                                  (`<ContentHeaderStickySlot>` etc.)
 *   - Read flow state           → it can't. Move the consumer into a
 *                                  plugin and call `useSessionEvents`.
 *
 * See change: pluginize-flows-via-registry.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Specific shell-rendering / shell-state files this lint scans. The
 * scope is curated rather than "all of packages/{shared,server,client}"
 * because the wire protocol legitimately references plugin message
 * names by string, OAuth-flow comments are unrelated, and CSS class
 * names contain "overflow". Curating to the rendering surface gives
 * a high-signal regression test.
 */
const SHELL_FILES_TO_SCAN = [
  // Top-level shell rendering
  path.join(REPO_ROOT, "packages", "client", "src", "App.tsx"),
  path.join(REPO_ROOT, "packages", "client", "src", "components", "SessionCard.tsx"),
  path.join(REPO_ROOT, "packages", "client", "src", "components", "SessionHeader.tsx"),
  path.join(REPO_ROOT, "packages", "client", "src", "components", "MobileShell.tsx"),
  path.join(REPO_ROOT, "packages", "client", "src", "components", "SessionList.tsx"),
  // Shell state machines + back-nav helpers
  path.join(REPO_ROOT, "packages", "client", "src", "lib", "event-reducer.ts"),
  path.join(REPO_ROOT, "packages", "client", "src", "lib", "desktop-back.ts"),
  path.join(REPO_ROOT, "packages", "client", "src", "hooks", "useDesktopBack.ts"),
  path.join(REPO_ROOT, "packages", "client", "src", "hooks", "useMessageHandler.ts"),
  // Server-side session-update extractor
  path.join(REPO_ROOT, "packages", "server", "src", "event-status-extraction.ts"),
];

/**
 * Forbidden identifier patterns. Each is a regex that matches the
 * identifier as a standalone word.
 */
const FORBIDDEN_IDENTIFIERS = [
  // Flow component names from flows-plugin
  /\bFlowDashboard\b/,
  /\bFlowArchitect\b/,
  /\bFlowArchitectDetail\b/,
  /\bFlowAgentDetail\b/,
  /\bFlowSummary\b/,
  /\bFlowActivityBadge\b/,
  /\bSessionFlowActions\b/,
  /\bFlowLaunchDialog\b/,
  /\bFlowAgentCard\b/,
  /\bFlowGraph\b/,
  // Flow / architect plugin-internal state field names
  /\bflowState\b/,
  /\bflowStates\b/,
  /\barchitectState\b/,
  /\bflowDetailAgent\b/,
  /\barchitectDetailOpen\b/,
  /\bsourceOpenAgent\b/,
  /\bflowYamlPreview\b/,
  // Removed DashboardSession scalars
  /\bactiveFlowName\b/,
  /\bflowAgentsDone\b/,
  /\bflowAgentsTotal\b/,
  /\bflowStatus\b/,
  // Removed predicate
  /\bhasActiveFlow\b/,
  // Imports from the plugin's client subpath — the shell SHALL NOT
  // import any React component from flows-plugin.
  /pi-dashboard-flows-plugin\/client/,
];

/** Regex for full-line comments (single-line // or block-comment continuation *). */
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;

interface Violation {
  file: string;
  line: number;
  source: string;
  match: string;
}

/**
 * Scan a source file for forbidden identifiers outside of comment
 * lines. Returns each violation with file:line + the matching token.
 */
function scanFile(filePath: string): Violation[] {
  if (!fs.existsSync(filePath)) return [];
  const source = fs.readFileSync(filePath, "utf-8");
  const violations: Violation[] = [];
  const lines = source.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      const closeIdx = line.indexOf("*/");
      if (closeIdx >= 0) inBlockComment = false;
      continue;
    }
    if (COMMENT_LINE_RE.test(line)) continue;
    const blockOpenIdx = line.indexOf("/*");
    if (blockOpenIdx >= 0 && line.indexOf("*/", blockOpenIdx + 2) < 0) {
      inBlockComment = true;
    }

    for (const re of FORBIDDEN_IDENTIFIERS) {
      const match = line.match(re);
      if (!match) continue;
      violations.push({
        file: path.relative(REPO_ROOT, filePath),
        line: i + 1,
        source: line.trim(),
        match: match[0],
      });
      break; // one violation per line is enough
    }
  }
  return violations;
}

/**
 * @structural-pin repo lint: the dashboard shell files must carry no flow-specific identifiers; absence of text is the contract
 */
describe("no-flow-references-in-shell (repo-lint)", () => {
  it("dashboard shell source SHALL NOT contain any reference to flows", () => {
    const allViolations: Violation[] = [];
    for (const file of SHELL_FILES_TO_SCAN) {
      allViolations.push(...scanFile(file));
    }

    if (allViolations.length > 0) {
      const lines = allViolations.map(
        (v) => `  ${v.file}:${v.line}  [matched "${v.match}"]\n    ${v.source}`,
      );
      throw new Error(
        `Found ${allViolations.length} flow reference(s) in shell source.\n` +
          "The dashboard shell SHALL contain zero references to flows. Move the\n" +
          "code into flows-plugin instead. See change: pluginize-flows-via-registry.\n\n" +
          lines.join("\n\n"),
      );
    }
  });

  it("self-test: detects a planted bad fixture", () => {
    const fixture = `import { FlowDashboard } from "@blackbelt-technology/pi-dashboard-flows-plugin/client";\nconst x = 1;\n`;
    const tmp = path.join(REPO_ROOT, ".tmp-no-flow-refs-fixture.tsx");
    fs.writeFileSync(tmp, fixture);
    try {
      const violations = scanFile(tmp);
      // Both the FlowDashboard identifier AND the import path match;
      // the scanner returns one violation per line, so we expect 1.
      expect(violations).toHaveLength(1);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("self-test: comment-only references are not flagged", () => {
    const fixture = [
      `// FlowDashboard moved to flows-plugin per pluginize-flows-via-registry`,
      `/* hasActiveFlow predicate removed */`,
      `const x = 1;`,
    ].join("\n");
    const tmp = path.join(REPO_ROOT, ".tmp-no-flow-refs-fixture-comments.tsx");
    fs.writeFileSync(tmp, fixture);
    try {
      const violations = scanFile(tmp);
      expect(violations).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("self-test: CSS overflow / workflow / unrelated 'flow' words not flagged", () => {
    const fixture = [
      `<div className="overflow-hidden flow-root">`,
      `const oauthFlow = "codex_cli_simplified_flow";`,
      `// publish workflow contract test`,
    ].join("\n");
    const tmp = path.join(REPO_ROOT, ".tmp-no-flow-refs-fixture-css.tsx");
    fs.writeFileSync(tmp, fixture);
    try {
      const violations = scanFile(tmp);
      expect(violations).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
