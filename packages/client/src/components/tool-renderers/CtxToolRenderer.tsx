import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronDown, mdiChevronRight, mdiOpenInNew } from "@mdi/js";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeContext } from "../ThemeProvider.js";
import { getSyntaxTheme } from "../../lib/syntax-theme.js";
import type { ToolRendererProps } from "./types.js";
import { LinkifiedText } from "./LinkifiedText.js";
import {
  parseCtxResult,
  type CtxResult,
  type QueryBlock,
  type IntentPreview,
} from "./parse-ctx-result.js";
import { t as i18nT } from "../../lib/i18n";

// Single renderer for every context-mode (`ctx_*`) tool. Parses the result
// text into a typed struct (parse-ctx-result.ts) and switches the body layout
// on the parsed `kind`. Shared header chip + error card live here; per-tool
// bodies are small branches. See change: add-ctx-tool-renderer (design → Decision 1).

const CHIP =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-code)] text-[var(--text-secondary)] border border-[var(--border-secondary)]";

function headerChip(toolName: string, parsed: CtxResult, args?: Record<string, unknown>): string {
  switch (parsed.kind) {
    case "execute": {
      const lang = (args?.language as string) ?? "code";
      const lines = parsed.stdout ? parsed.stdout.split("\n").length : 0;
      return `⚙ ${lang} · ${lines} lines`;
    }
    case "batch":
      return `▦ ${parsed.summary.commands} cmds · ${parsed.summary.sections} sections · ${parsed.summary.queries} queries`;
    case "search":
      return `🔍 ${parsed.queries.length} ${parsed.queries.length === 1 ? "query" : "queries"}`;
    case "index":
      return `🗂 ${parsed.sections} sections — ${parsed.source}`;
    case "fetch":
      return `🌐 ${parsed.url ? hostOf(parsed.url) : parsed.source} · ${parsed.sections} sections`;
    case "insight":
      return `📊 insight`;
    case "error":
      return `✕ ${parsed.variant} error`;
    default:
      return toolName;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const bodyCap = "max-h-80 overflow-auto rounded";

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--border-secondary)] rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 w-full text-left px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.55} />
        <span className="truncate">{title}</span>
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);
  if (!language) {
    return (
      <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded">
        {code}
      </pre>
    );
  }
  return (
    <SyntaxHighlighter
      style={syntaxStyle}
      language={language}
      PreTag="div"
      customStyle={{ margin: 0, padding: "0.5rem", fontSize: "12px", background: "var(--bg-code)" }}
    >
      {code}
    </SyntaxHighlighter>
  );
}

function QueryAccordions({ queries, context }: { queries: QueryBlock[]; context: ToolRendererProps["context"] }) {
  return (
    <div className="space-y-1">
      {queries.map((q, i) => (
        <Collapsible key={i} title={q.query}>
          {q.noResults || q.sections.length === 0 ? (
            <span className="text-[11px] text-[var(--text-muted)] italic">{i18nT("auto.no_results_found", undefined, "No results found")}</span>
          ) : (
            <div className="space-y-2">
              {q.sections.map((s, j) => (
                <div key={j}>
                  <div className="text-[11px] font-mono text-[var(--accent-green)]">{s.title}</div>
                  <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">
                    <LinkifiedText text={s.body} context={context} />
                  </pre>
                </div>
              ))}
            </div>
          )}
        </Collapsible>
      ))}
    </div>
  );
}

function IntentPreviewList({ intent }: { intent: IntentPreview }) {
  return (
    <div className="text-[11px] text-[var(--text-muted)] space-y-0.5">
      <div>
        {intent.matched} {i18nT("auto.sections_matched", undefined, "sections matched")} <span className="font-mono">"{intent.query}"</span>
        {intent.indexed != null && ` · ${intent.indexed} indexed`}
      </div>
      <ul className="list-disc list-inside">
        {intent.previews.map((p, i) => (
          <li key={i} className="truncate">
            {p.replace(/^- /, "")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorCard({
  parsed,
  context,
}: {
  parsed: Extract<CtxResult, { kind: "error" }>;
  context: ToolRendererProps["context"];
}) {
  return (
    <div className="rounded border border-red-500/40 bg-red-950/20 p-2 space-y-2">
      <div className="text-[11px] font-medium text-red-400 uppercase">{parsed.variant} error</div>
      <pre className="whitespace-pre-wrap text-code text-red-300">
        <LinkifiedText text={parsed.message} context={context} />
      </pre>
      {parsed.receivedArgs && (
        <Collapsible title={i18nT("auto.received_arguments", undefined, "Received arguments")}>
          <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)] p-2 bg-[var(--bg-code)] rounded">
            {parsed.receivedArgs}
          </pre>
        </Collapsible>
      )}
    </div>
  );
}

function CtxBody({
  parsed,
  toolName,
  args,
  context,
}: {
  parsed: CtxResult;
  toolName: string;
  args?: Record<string, unknown>;
  context: ToolRendererProps["context"];
}) {
  switch (parsed.kind) {
    case "error":
      return <ErrorCard parsed={parsed} context={context} />;

    case "execute": {
      const code = args?.code as string | undefined;
      const language = args?.language as string | undefined;
      const path = args?.path as string | undefined;
      return (
        <div className="space-y-2">
          {path && <div className="text-xs font-mono text-[var(--text-secondary)]">{path}</div>}
          {code && (
            <div className={bodyCap}>
              <CodeBlock code={code} language={language} />
            </div>
          )}
          {parsed.intent && <IntentPreviewList intent={parsed.intent} />}
          {parsed.stdout && (
            <div className={`${bodyCap} bg-[var(--bg-code)] p-2`}>
              <pre className="whitespace-pre-wrap text-code font-mono">
                <LinkifiedText text={parsed.stdout} context={context} />
              </pre>
            </div>
          )}
        </div>
      );
    }

    case "batch":
      return (
        <div className={`${bodyCap} space-y-2`}>
          {parsed.sections.length > 0 && (
            <Collapsible title={`Indexed Sections (${parsed.sections.length})`}>
              <ul className="text-[11px] font-mono text-[var(--text-muted)] space-y-0.5">
                {parsed.sections.map((s, i) => (
                  <li key={i} className="truncate">
                    {s.label}
                    {s.size && <span className="text-[var(--text-tertiary)]"> ({s.size})</span>}
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {parsed.queries.length > 0 && <QueryAccordions queries={parsed.queries} context={context} />}
        </div>
      );

    case "search":
      return (
        <div className={bodyCap}>
          <QueryAccordions queries={parsed.queries} context={context} />
        </div>
      );

    case "index":
      return (
        <div className="text-xs text-[var(--text-secondary)] font-mono">
          {parsed.sections} sections
          {parsed.withCode != null && ` (${parsed.withCode} with code)`} — {parsed.source}
        </div>
      );

    case "fetch":
      return (
        <div className="text-xs text-[var(--text-secondary)] font-mono space-y-0.5">
          <div>
            {parsed.sections} {i18nT("auto.sections", undefined, "sections ·")} {parsed.size} — {parsed.source}
          </div>
          {parsed.url && (
            <a
              href={parsed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline break-all"
            >
              {parsed.url}
            </a>
          )}
        </div>
      );

    case "insight":
      return (
        <div className="space-y-2">
          {parsed.url && (
            <a
              href={parsed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--bg-code)] border border-[var(--border-secondary)] text-blue-400 hover:underline"
            >
              <Icon path={mdiOpenInNew} size={0.5} />
              {parsed.url}
            </a>
          )}
          <div className={`${bodyCap} bg-[var(--bg-code)] p-2`}>
            <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">{parsed.log}</pre>
          </div>
        </div>
      );

    case "raw":
    default:
      return (
        <div className={`${bodyCap} bg-[var(--bg-code)] p-2`}>
          <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">
            <LinkifiedText text={parsed.kind === "raw" ? parsed.text : String(parsed)} context={context} />
          </pre>
        </div>
      );
  }
}

export function CtxToolRenderer({ toolName, args, status, result, context }: ToolRendererProps) {
  const parsed = parseCtxResult(toolName, result, status === "error");

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={CHIP}>{headerChip(toolName, parsed, args)}</span>
        <span className="text-[10px] text-[var(--text-muted)] font-mono">{toolName}</span>
      </div>

      {status === "running" && !result && (
        <div className="text-xs text-[var(--text-muted)] italic">{i18nT("auto.running", undefined, "Running…")}</div>
      )}

      {result && <CtxBody parsed={parsed} toolName={toolName} args={args} context={context} />}
    </div>
  );
}
