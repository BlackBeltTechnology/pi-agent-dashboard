/**
 * Settings → Diagnostics section.
 *
 * Fetches `/api/doctor` on mount, groups checks by section, renders status
 * pill + name + message + truncated detail per row, and shows the suggestion
 * via `<MarkdownContent>` when present.
 *
 * Toolbar:
 *   [Re-run]            disabled while a fetch is in flight, "Running…" label
 *   [Copy as Markdown]  navigator.clipboard.writeText → textarea-modal fallback
 *   [Copy as Plain]     same fallback path
 *
 * On non-200 / shape mismatch / network failure: renders an inline error
 * block with the HTTP status, a 500-character body excerpt, and an enabled
 * `[Re-run]` button (never blank).
 *
 * See change: doctor-rich-output (tasks 5.2–5.6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import type { DoctorCheck, DoctorReport } from "../../lib/api/doctor-api.js";
import { DoctorFetchError, fetchDoctorReport } from "../../lib/api/doctor-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { resolveServerMessage } from "../../lib/api/server-error.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

type DoctorSection = DoctorCheck["section"];

const SECTION_ORDER: DoctorSection[] = [
  "runtime",
  "pi-tooling",
  "server",
  "tunnel",
  "setup",
  "diagnostics",
];
const SECTION_LABEL: Record<DoctorSection, string> = {
  runtime: "Runtime",
  "pi-tooling": "PI Tooling",
  server: "Server",
  tunnel: "Tunnel",
  setup: "Setup",
  diagnostics: "Diagnostics",
};

function pillClasses(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":
      return "bg-green-900/40 text-green-300";
    case "warning":
      return "bg-yellow-900/40 text-yellow-200";
    case "error":
      return "bg-red-900/40 text-red-300";
  }
}
function pillLabel(status: DoctorCheck["status"]): string {
  return status === "ok" ? "OK" : status === "warning" ? "WARN" : "ERR";
}

function formatPlain(report: DoctorReport): string {
  const lines = ["PI Dashboard Doctor", "═".repeat(50), ""];
  for (const c of report.checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warning" ? "⚠" : "✗";
    lines.push(`  ${icon} ${c.name}`);
    lines.push(`    ${c.message}`);
    if (c.detail) lines.push(`    ${c.detail}`);
    if (c.suggestion && c.status !== "ok") lines.push(`    → ${c.suggestion}`);
  }
  lines.push("", "─".repeat(50));
  lines.push(
    `  ${report.summary.ok} passed, ${report.summary.warnings} warnings, ${report.summary.errors} errors`,
  );
  return lines.join("\n");
}

function formatMarkdown(report: DoctorReport): string {
  const fence = (s: string | undefined) =>
    s
      ? "<code>" +
        String(s)
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\|/g, "\\|")
          .replace(/\r?\n/g, "<br>") +
        "</code>"
      : "";
  const out: string[] = [`# PI Dashboard Doctor`, ""];
  const { ok, warnings, errors } = report.summary;
  out.push(`**Summary:** ${ok} ok · ${warnings} warning(s) · ${errors} error(s)`, "");
  for (const sec of SECTION_ORDER) {
    const rows = report.checks.filter((c) => c.section === sec);
    if (!rows.length) continue;
    out.push(`## ${SECTION_LABEL[sec]}`, "");
    out.push(`| Status | Check | Message | Detail |`, `| --- | --- | --- | --- |`);
    for (const c of rows) {
      const icon = c.status === "ok" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
      const m = c.message.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      out.push(`| ${icon} | ${c.name} | ${m} | ${fence(c.detail)} |`);
    }
    out.push("");
  }
  const nonOk = report.checks.filter((c) => c.status !== "ok" && c.suggestion);
  if (nonOk.length) {
    out.push(`## Remediation`, "");
    for (const c of nonOk) out.push(`- **${c.name}** — ${c.suggestion}`);
    out.push("");
  }
  return out.join("\n");
}

interface Props {
  /** Test-only override for `fetchDoctorReport`. */
  fetcher?: () => Promise<DoctorReport>;
}

export function DiagnosticsSection({ fetcher }: Props = {}) {
  const fetch = fetcher ?? fetchDoctorReport;
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<{ status: number | null; excerpt: string; message: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [copyModalText, setCopyModalText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await fetch();
      if (mountedRef.current) setReport(r);
    } catch (err) {
      if (!mountedRef.current) return;
      setReport(null);
      if (err instanceof DoctorFetchError) {
        setError({ status: err.status, excerpt: err.bodyExcerpt, message: err.message });
      } else {
        const e = err instanceof Error ? err : new Error(String(err));
        setError({ status: null, excerpt: "", message: e.message });
      }
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [fetch, running]);

  // Switch windowsGitSource then re-run diagnostics. Takes effect for newly
  // spawned sessions. /api/config is PUT (matches SettingsPanel); check the
  // response + body success and surface failures. See change:
  // embed-git-bash-on-windows.
  const switchGitSource = useCallback(async (value: "host" | "bundled") => {
    try {
      const res = await window.fetch(`${getApiBase()}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowsGitSource: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) {
        const msg = body?.error || `HTTP ${res.status}`;
        setError({ status: res.status, excerpt: "", message: i18nT("err.setGitSource", { detail: msg }, "Failed to set git source: {detail}") });
        return;
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError({ status: null, excerpt: "", message: i18nT("err.setGitSource", { detail: e.message }, "Failed to set git source: {detail}") });
      return;
    }
    await run();
  }, [run]);

  // Initial load
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyTo = useCallback(async (text: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setToast("Copied to clipboard.");
        setTimeout(() => setToast(null), 3000);
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      setCopyModalText(text);
    }
  }, []);

  const handleCopyMd = useCallback(async () => {
    if (!report) return;
    await copyTo(formatMarkdown(report));
  }, [report, copyTo]);

  const handleCopyPlain = useCallback(async () => {
    if (!report) return;
    await copyTo(formatPlain(report));
  }, [report, copyTo]);

  const sections = useMemo(() => {
    if (!report) return [];
    return SECTION_ORDER.map((sec) => ({
      sec,
      rows: report.checks.filter((c) => c.section === sec),
    })).filter((g) => g.rows.length > 0);
  }, [report]);

  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-slate-200 mb-2">{i18nT("doctor.diagnostics", undefined, "Diagnostics")}</h2>
      <p className="text-sm text-slate-400 mb-3">
        {i18nT("connection.diagnosesTheServerYouReConnected", undefined, "Diagnoses the server you're connected to. Local installation issues are best diagnosed\n        from the Electron app's Help → Doctor menu.")}
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50 disabled:cursor-progress"
          data-testid="diagnostics-rerun"
        >
          {running ? "Running…" : "Re-run"}
        </button>
        <button
          type="button"
          onClick={() => void handleCopyMd()}
          className="px-3 py-1.5 text-sm rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
          data-testid="diagnostics-copy-md"
        >
          {i18nT("common.copyAsMarkdown", undefined, "Copy as Markdown")}
        </button>
        <button
          type="button"
          onClick={() => void handleCopyPlain()}
          className="px-3 py-1.5 text-sm rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
          data-testid="diagnostics-copy-plain"
        >
          {i18nT("common.copyAsPlain", undefined, "Copy as Plain")}
        </button>
        {report?.generatedAt ? (
          <span className="text-xs text-slate-500 ml-auto">
            {new Date(report.generatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {toast ? (
        <div className="mb-3 text-xs text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded">{toast}</div>
      ) : null}

      {error ? (
        <div
          className="mb-4 p-3 rounded bg-red-950/40 border border-red-900 text-red-200 text-sm"
          data-testid="diagnostics-error"
        >
          <div className="font-semibold mb-1">
            {i18nT("doctor.doctorFetchFailed", undefined, "Doctor fetch failed")}{error.status != null ? ` (HTTP ${error.status})` : ""}
          </div>
          <div className="text-xs text-red-300 mb-1">{error.message}</div>
          {error.excerpt ? (
            <pre className="text-[11px] text-red-300/80 whitespace-pre-wrap break-words max-h-48 overflow-auto">
              {error.excerpt}
            </pre>
          ) : null}
        </div>
      ) : null}

      {!report && !error && !running ? (
        <div className="text-sm text-slate-500">{i18nT("common.noReportYet", undefined, "No report yet.")}</div>
      ) : null}

      {report ? (
        <>
          <div className="mb-3 text-sm text-slate-300">
            <span className="text-green-400">{report.summary.ok} ok</span> ·{" "}
            <span className="text-yellow-300">{report.summary.warnings} warning(s)</span> ·{" "}
            <span className="text-red-300">{report.summary.errors} error(s)</span>
          </div>
          {sections.map(({ sec, rows }) => (
            <div key={sec} className="mb-4" data-testid={`diagnostics-section-${sec}`}>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                {SECTION_LABEL[sec]}
              </h3>
              <div className="rounded border border-slate-800 divide-y divide-slate-800">
                {rows.map((c, i) => (
                  <div key={`${c.name}-${i}`} className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${pillClasses(c.status)}`}
                      >
                        {pillLabel(c.status)}
                      </span>
                      <span className="text-sm font-semibold text-slate-100">{c.name}</span>
                    </div>
                    <div className="text-sm text-slate-300">
                      {resolveServerMessage({ code: c.code, vars: c.vars, message: c.message })}
                    </div>
                    {c.detail ? (
                      <pre className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap break-words font-mono max-h-32 overflow-auto">
                        {c.detail}
                      </pre>
                    ) : null}
                    {c.status !== "ok" && c.suggestion ? (
                      <div className="mt-2 px-3 py-2 border-l-2 border-yellow-600 bg-stone-900/40 rounded-r text-xs text-yellow-100">
                        <MarkdownContent content={c.suggestion} />
                      </div>
                    ) : null}
                    {c.name === "git source" ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void switchGitSource("host")}
                          className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
                          data-testid="git-source-switch-host"
                        >
                          {i18nT("common.switchToHost", undefined, "Switch to host")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void switchGitSource("bundled")}
                          className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
                          data-testid="git-source-switch-bundled"
                        >
                          {i18nT("common.switchToBundled", undefined, "Switch to bundled")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {copyModalText !== null ? (
        <CopyFallbackModal text={copyModalText} onClose={() => setCopyModalText(null)} />
      ) : null}
    </section>
  );
}

function CopyFallbackModal({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <DialogPortal>
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]"
        onClick={onClose}
        data-testid="diagnostics-copy-modal"
      >
        <div
          className="bg-slate-900 border border-slate-700 rounded-lg p-4 max-w-2xl w-full mx-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm text-slate-200 mb-2">
            {i18nT("common.yourBrowserBlockedClipboardAccessPres", undefined, "Your browser blocked clipboard access — press Ctrl/Cmd+C to copy.")}
          </div>
          <textarea
            ref={ref}
            readOnly
            value={text}
            rows={16}
            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-100"
          />
          <div className="mt-3 text-right">
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded bg-slate-700 text-slate-200 hover:bg-slate-600"
              onClick={onClose}
            >
              {i18nT("common.close", undefined, "Close")}
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
