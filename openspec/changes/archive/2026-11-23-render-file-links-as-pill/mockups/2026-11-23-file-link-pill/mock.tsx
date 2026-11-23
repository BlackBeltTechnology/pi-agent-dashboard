// File links in the chat transcript: icon + name + HTML chevron are separate inline boxes today, so the
// line can break between them (icon at a line end, name on the next, chevron alone). Proposed: one
// no-wrap pill per link. Current = the REAL MarkdownContent + FileLink inside a LinkResolutionProvider
// (states from a resolve-mentions fixture). Proposed = the same MarkdownContent with a pill `fileLink`.
import { LinkResolutionProvider } from "@app/components/chat/LinkResolutionProvider.tsx";
import { MarkdownContent } from "@app/components/preview/MarkdownContent.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import { LinkIconSlot } from "@app/components/tool-renderers/LinkIconSlot.tsx";
import { makeToolContext } from "@app/components/tool-renderers/make-tool-context.tsx";
import type { FileLinkRenderer, ToolContext } from "@app/components/tool-renderers/types.ts";
import { fileIcon } from "@app/lib/preview/file-icon.ts";
import { mdiChevronDown, mdiHelpCircleOutline, mdiLock } from "@mdi/js";
import { Fix, type Fixtures, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

type LinkState = "found" | "recovered" | "missing" | "gated" | "ambiguous";

const CWD = "/Users/dev/web-app";

/** Fixture state per mention (the same table drives both panes). */
function stateFor(mention: string): LinkState {
  if (mention.includes("legacy-links")) return "missing";
  if (mention.includes("other-repo")) return "gated";
  if (mention.endsWith("/index.ts")) return "ambiguous";
  if (mention.includes("LinkIconSlot")) return "recovered";
  return "found";
}

const fixtures = (): Fixtures => ({
  http: {
    "POST /api/file/resolve-mentions": (r) => {
      const { items } = r.json<{ items: Array<{ mention: string }> }>();
      return {
        success: true,
        data: {
          results: items.map(({ mention }) => {
            const state = stateFor(mention);
            return state === "missing" || state === "gated" ? { state } : { state, resolved: `${CWD}/${mention}` };
          }),
        },
      };
    },
  },
});

// ---- Proposed: one no-wrap pill per link (mock-local; would replace FileLink's button markup) ----

function glyphFor(path: string, state: LinkState): { glyph: string; tone: string } {
  if (state === "gated") return { glyph: mdiLock, tone: "text-[var(--text-muted)]" };
  if (state === "ambiguous") return { glyph: mdiHelpCircleOutline, tone: "text-[var(--text-muted)]" };
  const i = fileIcon(path);
  return { glyph: i.iconPath, tone: i.colorClass };
}

const PILL =
  // One atomic inline box: never breaks inside; long paths truncate from the START (file name stays visible).
  "inline-flex items-center max-w-full min-w-0 whitespace-nowrap align-[-0.2em] mx-[0.1em] " +
  "rounded-full border px-[0.5em] leading-[1.45] text-[0.92em] " +
  // Inside an inline `code` chip the pill drops its own chrome (no chip-in-chip), keeps no-wrap.
  "[code_&]:border-0 [code_&]:bg-transparent [code_&]:px-0 [code_&]:mx-0 [code_&]:text-[1em]";

function toneFor(state: LinkState): string {
  if (state === "missing")
    return "border-dashed border-[var(--border-secondary)] bg-transparent text-[var(--text-muted)] line-through cursor-not-allowed";
  if (state === "gated" || state === "ambiguous")
    return "border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--link)] cursor-pointer";
  return "border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--link)] hover:border-[var(--link)] cursor-pointer";
}

function PillLink({ path, state, children }: { path: string; state: LinkState; children: ReactNode }) {
  const { glyph, tone } = glyphFor(path, state);
  const html = /\.html?$/i.test(path);
  return (
    <span className={`${PILL} ${toneFor(state)}`} data-link-state={state}>
      <button
        type="button"
        draggable={false}
        title={state === "missing" ? `Not found: ${path}` : `Preview ${path}`}
        className="inline-flex items-center min-w-0 bg-transparent border-0 p-0 m-0 text-inherit cursor-inherit"
        style={{ font: "inherit", userSelect: "text" }}
      >
        <LinkIconSlot glyph={glyph} tone={tone} />
        {/* rtl + bdi: an overflowing path ellipsises at the start, so ".../FileLink.tsx" stays readable. */}
        <span
          className={`truncate min-w-0 ${state === "recovered" ? "underline decoration-dotted underline-offset-2" : ""}`}
          style={{ direction: "rtl", textAlign: "left" }}
        >
          <bdi dir="ltr">{children}</bdi>
        </span>
      </button>
      {html && (
        <button
          type="button"
          aria-label={`Open ${path} as…`}
          className="inline-flex shrink-0 items-center self-stretch bg-transparent border-0 border-l border-[var(--border-secondary)] ml-[0.35em] pl-[0.2em] p-0 text-[var(--text-muted)] hover:text-[var(--link)] cursor-pointer select-none"
          style={{ font: "inherit" }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" className="fill-current">
            <path d={mdiChevronDown} />
          </svg>
        </button>
      )}
    </span>
  );
}

const pillFileLink: FileLinkRenderer = ({ path, children }) => (
  <PillLink path={path} state={stateFor(path)}>
    {children}
  </PillLink>
);

// ---- page parts ----

const MESSAGE = [
  "I moved the icon slot into packages/client/src/components/tool-renderers/FileLink.tsx and reused tool-renderers/LinkIconSlot.tsx for web links.",
  "",
  "The report is at mockups/link-report.html — open it as Static. Notes are in docs/architecture.md, the old helper src/lib/legacy-links.ts is gone, and ~/other-repo/secrets.ts is outside the session folders.",
  "",
  "Two files match src/index.ts; the config lives in `packages/client/vite.config.ts`.",
].join("\n");

const STATES = [
  "- found: docs/faq.md",
  "- recovered: tool-renderers/LinkIconSlot.tsx",
  "- missing: src/lib/legacy-links.ts",
  "- gated: ~/other-repo/secrets.ts",
  "- ambiguous: src/index.ts",
  "- html + menu: mockups/link-report.html",
  "- long: packages/client/src/components/tool-renderers/tests/FileLink.rich-chat-links.test.tsx",
].join("\n");

const ctxCurrent: ToolContext = makeToolContext({ cwd: CWD, sessionId: "mock-session" });
const ctxProposed: ToolContext = { ...ctxCurrent, fileLink: pillFileLink };

/** The real assistant bubble chrome from ChatView (MessageBubble, assistant branch). */
function Bubble({ variant, content }: { variant: "current" | "proposed"; content: string }) {
  return (
    <ThemeProvider>
      <LinkResolutionProvider sessionId="mock-session">
        <div className="bg-[var(--bg-primary)] p-3 min-w-0">
          <div className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-md px-4 py-2 text-sm text-[var(--text-primary)]">
            <MarkdownContent content={content} context={variant === "current" ? ctxCurrent : ctxProposed} />
          </div>
        </div>
      </LinkResolutionProvider>
    </ThemeProvider>
  );
}

const ring = (variant: "current" | "proposed", n: number, bad: string, good: string, node: ReactNode) =>
  variant === "current" ? (
    <Issue n={n} tip={bad} block>
      {node}
    </Issue>
  ) : (
    <Fix n={n} tip={good} block>
      {node}
    </Fix>
  );

const mock: Mock = {
  title: "File links - chat pill",
  category: "Chat",
  fixtures,
  frames: [
    {
      title: "Assistant message - narrow bubble",
      width: 460,
      why: "Icon, name and chevron wrap apart today; one no-wrap pill keeps each link a single unit.",
      current: ring("current", 1, "Icon/name/chevron split across lines", "", <Bubble variant="current" content={MESSAGE} />),
      proposed: ring("proposed", 1, "", "One pill per link, never split", <Bubble variant="proposed" content={MESSAGE} />),
    },
    {
      title: "Assistant message - phone",
      phone: true,
      why: "At 375px the long path truncates from the start inside the pill instead of wrapping mid-path.",
      current: <Bubble variant="current" content={MESSAGE} />,
      proposed: <Bubble variant="proposed" content={MESSAGE} />,
    },
    {
      title: "Link states",
      width: 520,
      why: "Every resolver state keeps its signal (glyph, strike, dotted) inside the pill; HTML menu is a split end.",
      current: ring("current", 2, "Chevron floats loose; long path wraps", "", <Bubble variant="current" content={STATES} />),
      proposed: ring("proposed", 2, "", "Split pill; start-ellipsis path", <Bubble variant="proposed" content={STATES} />),
    },
  ],
};
export default mock;
