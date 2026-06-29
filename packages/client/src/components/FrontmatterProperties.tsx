import {
  mdiAlertOutline,
  mdiCalendar,
  mdiCheck,
  mdiChevronDown,
  mdiCircleMedium,
  mdiClose,
  mdiCodeBraces,
  mdiFormatListBulleted,
  mdiFormatText,
  mdiLinkVariant,
  mdiPound,
  mdiTextLong,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { parse as parseYaml } from "yaml";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { isExternalHref } from "./MarkdownContent.js";

/**
 * Match a single YAML frontmatter block at the very start of `content`
 * (leading `---` line, closing `---` line). Mirrors `remark-frontmatter`'s
 * recognition rule: only a block that begins at offset 0 counts, so a
 * mid-document `---` stays a thematic break. Returns the raw YAML text
 * (between the fences) and the remaining markdown body, or null when there
 * is no leading block.
 *
 * See change: improve-frontmatter-rendering.
 */
export function extractFrontmatter(content: string): { raw: string; body: string } | null {
  // Leading `---` then any lines, then a closing `---` on its own line.
  // The opening fence must be at offset 0. \r is tolerated for CRLF files.
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  return { raw: match[1], body: content.slice(match[0].length) };
}

export type ValueType =
  | "text"
  | "para"
  | "num"
  | "date"
  | "list"
  | "bool"
  | "link"
  | "obj"
  | "empty";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Infer the render type of a parsed YAML value. Inference is structural (by
 * the JS value's shape), not by key name — known-key promotion (e.g. `status`)
 * is applied by the caller before falling back to this.
 */
export function inferType(value: unknown): ValueType {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "num";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "list";
  if (isPlainObject(value)) return "obj";
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return "link";
    if (ISO_DATE_RE.test(value.trim())) return "date";
    if (value.length > 60 || value.includes("\n")) return "para";
    return "text";
  }
  return "text";
}

/**
 * Format a relative-time suffix for a date value (e.g. "7 days ago",
 * "in 3 months"). Returns null when the value cannot be parsed as a date.
 */
export function formatRelativeDate(value: string | Date, now: Date = new Date()): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - now.getTime();
  const past = diffMs <= 0;
  const min = Math.abs(diffMs) / 60000;
  if (min < 1) return "just now";
  // Largest-unit-first thresholds (in minutes); first match wins.
  const scales: Array<[limit: number, per: number, unit: string]> = [
    [60, 1, "minute"],
    [60 * 24, 60, "hour"],
    [60 * 24 * 30, 60 * 24, "day"],
    [60 * 24 * 365, 60 * 24 * 30, "month"],
    [Number.POSITIVE_INFINITY, 60 * 24 * 365, "year"],
  ];
  const [, per, unit] = scales.find(([limit]) => min < limit)!;
  const qty = Math.round(min / per);
  const plural = qty === 1 ? unit : `${unit}s`;
  return past ? `${qty} ${plural} ago` : `in ${qty} ${plural}`;
}

/** Format a date value as `YYYY-MM-DD`. */
function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // Strip any time portion from an ISO string for the compact display.
  return value.trim().slice(0, 10);
}

const ICON_BY_TYPE: Record<ValueType, string> = {
  text: mdiFormatText,
  para: mdiTextLong,
  num: mdiPound,
  date: mdiCalendar,
  list: mdiFormatListBulleted,
  bool: mdiCheck,
  link: mdiLinkVariant,
  obj: mdiCodeBraces,
  empty: mdiFormatText,
};

const KEY = "flex items-center gap-1.5 text-[var(--text-tertiary)] text-[13px] min-w-0 pt-px";
const VAL = "text-[var(--text-secondary)] text-[13px] min-w-0 break-words";

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const styles: Record<string, string> = {
    draft:
      "text-[var(--accent-yellow)] border-[color-mix(in_srgb,var(--accent-yellow)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent-yellow)_16%,transparent)]",
    active:
      "text-[var(--accent-green)] border-[color-mix(in_srgb,var(--accent-green)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent-green)_16%,transparent)]",
    archived:
      "text-[var(--text-tertiary)] border-[var(--border-secondary)] bg-[var(--bg-surface)]",
  };
  const cls = styles[v] ?? styles.archived;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[5px] px-2 py-px text-xs font-semibold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

function ValueCell({ keyName, value }: { keyName: string; value: unknown }) {
  // Known-key promotion: status → colored badge.
  if (keyName.toLowerCase() === "status" && (typeof value === "string" || typeof value === "number")) {
    return (
      <span className={VAL}>
        <StatusBadge value={String(value)} />
      </span>
    );
  }

  const type = inferType(value);
  switch (type) {
    case "empty":
      return <span className={`${VAL} text-[var(--text-muted)] italic`}>—</span>;
    case "bool": {
      const on = value === true;
      return (
        <span className={VAL}>
          <span className={`inline-flex items-center gap-1.5 ${on ? "text-[var(--accent-green)]" : "text-[var(--text-muted)]"}`}>
            <Icon path={on ? mdiCheck : mdiClose} size={0.62} />
            <span className="text-[var(--text-secondary)]">{String(on)}</span>
          </span>
        </span>
      );
    }
    case "num":
      return <span className={`${VAL} font-mono text-[var(--accent-blue)]`}>{String(value)}</span>;
    case "date": {
      const display = formatDate(value as string | Date);
      const rel = formatRelativeDate(value as string | Date);
      return (
        <span className={`${VAL} tabular-nums`}>
          {display}
          {rel && <span className="text-[var(--text-muted)]"> · {rel}</span>}
        </span>
      );
    }
    case "list": {
      const arr = value as unknown[];
      return (
        <span className={VAL}>
          <span className="flex flex-wrap gap-1.5">
            {arr.map((item, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-[5px] border border-[var(--border-secondary)] bg-[var(--bg-surface)] px-2 py-px text-xs text-[var(--text-secondary)]"
              >
                {stringify(item)}
              </span>
            ))}
          </span>
        </span>
      );
    }
    case "link": {
      const href = value as string;
      const external = isExternalHref(href);
      return (
        <span className={VAL}>
          <a
            href={href}
            className="text-[var(--link)] hover:underline"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {href}
          </a>
        </span>
      );
    }
    case "obj": {
      const obj = value as Record<string, unknown>;
      const entries = Object.entries(obj);
      return (
        <span className={VAL}>
          <span className="grid grid-cols-[max-content_1fr] gap-x-2.5 gap-y-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-code)] px-2.5 py-1.5">
            {entries.map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="font-mono text-xs text-[var(--text-muted)]">{k}</span>
                <span className="text-xs text-[var(--text-secondary)] break-words">{stringify(v)}</span>
              </React.Fragment>
            ))}
          </span>
        </span>
      );
    }
    case "para":
      return <span className={`${VAL} text-[var(--text-secondary)]`}>{String(value)}</span>;
    default:
      return <span className={`${VAL} text-[var(--text-primary)]`}>{String(value)}</span>;
  }
}

function iconForRow(keyName: string, value: unknown): string {
  if (keyName.toLowerCase() === "status") return mdiCircleMedium;
  return ICON_BY_TYPE[inferType(value)];
}

function PropsPanel({ raw }: { raw: string }) {
  const [collapsed, setCollapsed] = useState(true);

  let parsed: unknown;
  let parseError = false;
  try {
    parsed = parseYaml(raw);
  } catch {
    parseError = true;
  }

  // Malformed YAML, or YAML that parses to a non-object scalar → raw fallback.
  const entries =
    !parseError && isPlainObject(parsed) ? Object.entries(parsed) : null;

  if (entries === null) {
    const rawLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] mb-5 overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] select-none"
        >
          <Icon path={mdiChevronDown} size={0.58} className={`text-[var(--text-muted)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          Properties
        </button>
        {!collapsed && (
          <>
            <div className="mx-1.5 mb-1.5 flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--accent-orange)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-orange)_10%,transparent)] px-2.5 py-1.5 text-xs text-[var(--accent-orange)]">
              <Icon path={mdiAlertOutline} size={0.6} />
              Invalid YAML — showing raw values
            </div>
            <div className="px-1.5 pb-1.5">
              {rawLines.map((line, i) => (
                <div key={i} className="rounded-md px-2 py-1 font-mono text-xs text-[var(--text-secondary)] break-words">
                  {line}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const count = entries.length;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] mb-5 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] select-none"
      >
        <Icon path={mdiChevronDown} size={0.58} className={`text-[var(--text-muted)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        Properties
        <span className="ml-auto text-[11px] font-medium text-[var(--text-muted)]">
          {count} field{count === 1 ? "" : "s"}
        </span>
      </button>
      {!collapsed && (
        <div className="px-1.5 pb-1.5 pt-0.5">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[168px_1fr] items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]"
            >
              <div className={KEY}>
                <Icon path={iconForRow(key, value)} size={0.62} className="text-[var(--text-muted)] flex-none" />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{key}</span>
              </div>
              <ValueCell keyName={key} value={value} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Obsidian-style frontmatter Properties panel. Parses the raw YAML block and
 * renders a collapsed-by-default panel with one typed row per top-level key.
 * Any unexpected throw degrades to rendering nothing (the markdown body is
 * unaffected), matching the ErrorBoundary discipline in MarkdownContent.
 *
 * See change: improve-frontmatter-rendering.
 */
export function FrontmatterProperties({ raw }: { raw: string }) {
  return (
    <ErrorBoundary fallback={<></>}>
      <PropsPanel raw={raw} />
    </ErrorBoundary>
  );
}
