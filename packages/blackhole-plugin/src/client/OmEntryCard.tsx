/**
 * OmEntryCard — the blackhole `custom-entry-renderer` contribution.
 *
 * Renders the three observation-memory ledger entry types as compact,
 * meaningful chat rows instead of raw JSON blobs:
 *
 *   om.observations.recorded  →  observations stored by the observer worker
 *   om.reflections.recorded   →  reflections derived by the reflector worker
 *   om.observations.dropped   →  observations the dropper worker discarded
 *
 * Contract (spec: blackhole-om-entry-rendering; design D3/D4/D10):
 *   - COLLAPSED-FIRST: the collapsed line is derived from the row body ALONE —
 *     no keystroke of the payload fetch fires until the user expands. The
 *     container owns the fetch and expansion state; this component is
 *     presentation only.
 *   - It never reports a PARTIAL count: a body that does not parse as a
 *     complete payload (which includes every truncated body) renders the label
 *     with no count. Under-reporting is safe; over-reporting is not.
 *   - Record text renders as PLAIN TEXT — no markdown, no linkification, no
 *     `dangerouslySetInnerHTML` — because it is extension-authored input.
 *   - Each type carries its OWN icon, ADDITIVE to a text label and marked
 *     decorative (`aria-hidden`), so the type is never conveyed by icon alone.
 *
 * See change: add-custom-entry-renderer-slot.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiChevronDown, mdiChevronRight, mdiDeleteOutline, mdiEyeOutline, mdiLightbulbOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";

type OmKind = "observations" | "reflections" | "dropped";

function kindOf(customType: string): OmKind | null {
  switch (customType) {
    case "om.observations.recorded":
      return "observations";
    case "om.reflections.recorded":
      return "reflections";
    case "om.observations.dropped":
      return "dropped";
    default:
      return null;
  }
}

const ICONS: Record<OmKind, string> = {
  observations: mdiEyeOutline,
  reflections: mdiLightbulbOutline,
  dropped: mdiDeleteOutline,
};

const LABEL_KEY: Record<OmKind, string> = {
  observations: "omLabelRecorded",
  reflections: "omLabelReflections",
  dropped: "omLabelDropped",
};

const LABEL_FALLBACK: Record<OmKind, string> = {
  observations: "Observations recorded",
  reflections: "Reflections recorded",
  dropped: "Observations dropped",
};

/** Container keys a ledger payload may carry its record list under. */
const RECORD_KEYS = ["observations", "reflections", "records", "entries", "items", "dropped"] as const;

/**
 * Derive a record list from a parsed payload. Handles a bare array and the
 * common `{ observations | reflections | … }` container shapes. Returns `[]`
 * when the shape is unrecognised; `isRecognizedRecordsPayload` distinguishes a
 * genuinely empty payload from an unrecognised one so the caller can fall back
 * to the raw body rather than falsely reporting "No records".
 */
function extractRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  const arrays = Object.values(obj).filter(Array.isArray) as unknown[][];
  return arrays.length === 1 ? arrays[0] : [];
}

/** True when `extractRecords` recognises the payload shape (a bare array, a
 * known container key, or a single array-valued property). */
function isRecognizedRecordsPayload(payload: unknown): boolean {
  if (Array.isArray(payload)) return true;
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  if (RECORD_KEYS.some((key) => Array.isArray(obj[key]))) return true;
  return Object.values(obj).filter(Array.isArray).length === 1;
}

/**
 * Count the records a COMPLETE, parseable body carries; `null` when the body
 * does not parse as a complete payload (the caller then omits the count).
 */
function countRecords(body: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null; // truncated / non-JSON body — never report a partial count
  }
  if (Array.isArray(parsed)) return parsed.length;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length;
  }
  const arrays = Object.values(obj).filter(Array.isArray) as unknown[][];
  return arrays.length === 1 ? arrays[0].length : null;
}

/** Render one record's text, never interpreting it. */
function recordText(record: unknown): string {
  if (typeof record === "string") return record;
  if (record && typeof record === "object") {
    const o = record as Record<string, unknown>;
    for (const key of ["content", "text", "observation", "reflection", "summary"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
  }
  return JSON.stringify(record, null, 2);
}

function RecordList({ records, emptyLabel }: { records: unknown[]; emptyLabel: string }) {
  if (records.length === 0) {
    return <div className="px-2 py-1 text-xs text-[var(--text-muted)]">{emptyLabel}</div>;
  }
  return (
    <ul className="m-0 list-none space-y-1 p-0" data-testid="om-entry-records">
      {records.map((record, i) => (
        <li
          key={i}
          data-testid="om-entry-record"
          className="rounded bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words"
        >
          {recordText(record)}
        </li>
      ))}
    </ul>
  );
}

export function OmEntryCard({
  customType,
  body,
  timestamp,
  entryId,
  expanded,
  onToggle,
  payload,
  payloadError,
  payloadLoading,
}: CustomEntryRendererProps): React.ReactElement {
  const t = useT();
  const kind = kindOf(customType);
  const icon = kind ? ICONS[kind] : mdiEyeOutline;
  const label = kind ? t(LABEL_KEY[kind], undefined, LABEL_FALLBACK[kind]) : customType;
  const count = countRecords(body);

  // Expansion content priority: a failed fetch degrades to the stored body
  // (X3/X10); a loading fetch shows a neutral state; a loaded payload shows the
  // discrete records; otherwise fall back to the stored body.
  let bodyContent: React.ReactNode;
  if (payloadError) {
    bodyContent = (
      <pre
        data-testid="om-entry-fallback-body"
        className="m-0 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {body}
      </pre>
    );
  } else if (payloadLoading) {
    bodyContent = (
      <div data-testid="om-entry-loading" className="px-2 py-1 text-xs text-[var(--text-muted)] italic">
        {t("omLoading", undefined, "Loading…")}
      </div>
    );
  } else if (payload !== undefined) {
    bodyContent = isRecognizedRecordsPayload(payload) ? (
      <RecordList records={extractRecords(payload)} emptyLabel={t("omNoRecords", undefined, "No records")} />
    ) : (
      // Unrecognised shape: never claim "No records" for data we simply could
      // not interpret — show the stored body as plain text instead (D4).
      <pre
        data-testid="om-entry-stored-body"
        className="m-0 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {body}
      </pre>
    );
  } else {
    bodyContent = (
      <pre
        data-testid="om-entry-stored-body"
        className="m-0 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
      >
        {body}
      </pre>
    );
  }

  // The expand affordance exists ONLY when the row carries an entryId — a
  // control whose fetch can never fire is a dead control (D6b).
  const headerInner = (
    <>
      <span data-testid="om-entry-icon" data-icon={icon} aria-hidden className="inline-flex text-cyan-400">
        <Icon path={icon} size={0.55} />
      </span>
      <span data-testid="om-entry-label" className="font-medium text-[var(--text-secondary)] break-all">
        {label}
      </span>
      {count !== null && (
        <span
          data-testid="om-entry-count"
          className="ml-1 shrink-0 rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
        >
          {count}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[var(--text-tertiary)]">{new Date(timestamp).toLocaleTimeString()}</span>
      {entryId && (
        <span data-testid="om-entry-chevron" className="shrink-0 text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      )}
    </>
  );

  return (
    <div
      className="my-1 mx-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] overflow-hidden text-xs"
      data-testid="om-entry-card"
      data-om-kind={kind ?? "unknown"}
      data-entry-id={entryId ?? ""}
    >
      {entryId ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={label}
          data-testid="om-entry-toggle"
          aria-label={`${label}: ${expanded ? t("omCollapse", undefined, "Collapse entry") : t("omExpand", undefined, "Expand entry")}`}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-secondary)] cursor-pointer"
        >
          {headerInner}
        </button>
      ) : (
        <div
          data-testid="om-entry-header"
          title={label}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        >
          {headerInner}
        </div>
      )}
      {entryId && expanded && (
        <div className="px-2 pb-2" data-testid="om-entry-body">
          {bodyContent}
        </div>
      )}
    </div>
  );
}
