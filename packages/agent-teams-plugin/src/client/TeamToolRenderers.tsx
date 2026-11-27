/**
 * TeamToolRenderers — lazy `tool-renderer` module (design D5; task 8.3): four
 * exported family components (lifecycle, message, task, shutdown) over ONE
 * data-driven body keyed by `TOOL_FAMILIES`. Output states: running ("waiting for the
 * result" + input summary), elided (input summary + result text + note), error
 * (known sentence + code, or "Unexpected error (<code>)" with the code verbatim),
 * success (per-tool facts from VALIDATED `toolDetails`), and the input + result
 * fallback for missing, foreign or malformed details — never blank. All agent text
 * (task titles, messages, reasons, results) is plain React text; no links, no
 * markdown, no HTML. The only link is the Team view link built from the route table.
 * See change: add-agent-teams-ui.
 */
import { SettingsNotice } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ReactElement, ReactNode } from "react";
import { Link } from "wouter";
import type { CoreTeamOp } from "../shared/protocol.js";
import { useLazyT } from "./lazy-i18n.js";
import { PillView } from "./pill.js";
import { LINKBTN } from "./recipes.js";
import { teamViewPath } from "./routes.js";
import { memberStatusEntry, taskStatusEntry, URGENT_MARKER } from "./status-map.js";
import { parseToolDetails, type ToolView } from "./tool-details.js";
import { TOOL_FAMILIES } from "./tool-families.js";
import { TOOL_TABLES } from "./tool-i18n.js";

const PLAIN = "whitespace-pre-wrap [overflow-wrap:anywhere]";
type Translate = ReturnType<typeof useLazyT>;

export interface TeamToolProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  status?: "running" | "complete" | "error" | "elided";
  result?: string;
  toolDetails?: Record<string, unknown>;
}

const isTeamOp = (name: string): name is CoreTeamOp => Object.hasOwn(TOOL_FAMILIES, name);

function Fact({ k, children }: { k: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap gap-x-1.5">
      <dt className="text-[var(--text-secondary)]">{k}</dt>
      <dd className="m-0 min-w-0 text-[var(--text-primary)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function InputSummary({ input }: { input: Record<string, unknown> }): ReactElement {
  const t = useLazyT(TOOL_TABLES);
  const source = input !== null && typeof input === "object" ? input : {};
  const keys = Object.keys(source).slice(0, 6);
  if (keys.length === 0) return <p className="m-0 text-[var(--text-secondary)]">{t("tool.noInput")}</p>;
  return (
    <dl className="m-0 flex flex-col gap-0.5" data-testid="team-tool-input">
      {keys.map((k) => {
        const v = source[k];
        return (
          <Fact key={k} k={k}>
            <span className={PLAIN}>{typeof v === "string" ? v.slice(0, 160) : JSON.stringify(v)?.slice(0, 160)}</span>
          </Fact>
        );
      })}
    </dl>
  );
}

function Fallback({ input, result, note }: { input: Record<string, unknown>; result?: string; note?: string }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5" data-testid="team-tool-fallback">
      {note ? <p className="m-0 text-[var(--text-secondary)]">{note}</p> : null}
      <InputSummary input={input} />
      {result ? (
        <pre tabIndex={0} className={`${PLAIN} focus-ring m-0 max-h-[240px] overflow-auto rounded bg-[var(--bg-code)] p-2 font-mono text-[11px] text-[var(--text-secondary)]`} data-testid="team-tool-result">
          {result}
        </pre>
      ) : null}
    </div>
  );
}

function ErrorBody({ code }: { code: string }): ReactElement {
  const t = useLazyT(TOOL_TABLES);
  const key = `error.${code}`;
  const sentence = t(key) !== key ? t(key) : undefined;
  return (
    <SettingsNotice tone="error" details={code} testId="team-tool-error">
      {sentence !== undefined ? (
        <>
          <span className="font-semibold">{t("tool.errorTitle")}</span> {sentence} <span className="font-mono text-[11px]">{code}</span>
        </>
      ) : (
        <span className="font-semibold">{t("tool.errorUnexpected", { code })}</span>
      )}
    </SettingsNotice>
  );
}

function TeamLink({ sessionId }: { sessionId: string }): ReactElement | null {
  const t = useLazyT(TOOL_TABLES);
  if (!sessionId) return null;
  return (
    <Link href={teamViewPath(sessionId)} className={LINKBTN} data-testid="team-tool-open-team">
      {t("tool.openTeam")}
    </Link>
  );
}

function TaskLine({ id, title }: { id: string; title: string }): ReactElement {
  return (
    <div className={`${PLAIN} text-[var(--text-primary)]`}>
      <span className="font-mono font-semibold">#{id}</span> {title}
    </div>
  );
}

const countsLine = (t: Translate, tasks: Record<string, number>): string =>
  Object.entries(tasks)
    .map(([k, n]) => `${n} ${t(taskStatusEntry(k).textKey).toLowerCase()}`)
    .join(" · ");

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one flat switch over the closed set of 11 ops, each arm a small fragment of JSX — splitting it only adds indirection
function Success({ view, input, sessionId }: { view: ToolView; input: Record<string, unknown>; sessionId: string }): ReactElement {
  const t = useLazyT(TOOL_TABLES);
  switch (view.op) {
    case "TeammateSpawn": {
      const m = view.member;
      const e = memberStatusEntry(m.status);
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${PLAIN} text-sm font-semibold text-[var(--text-primary)]`}>{m.name}</span>
            {m.role ? <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] [overflow-wrap:anywhere]">{m.role}</span> : null}
            <PillView entry={e} label={t(e.textKey)} status={m.status} />
          </div>
          <div className="font-mono text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.model ?? t("tool.inheritsModel")}</div>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    }
    case "TeamCreate":
      return (
        <div className="flex flex-col gap-1">
          <dl className="m-0 flex flex-col gap-0.5">
            <Fact k={t("tool.team")}>
              <span className={PLAIN}>{view.team.name}</span>
            </Fact>
            <Fact k={t("tool.mode")}>{view.team.mode}</Fact>
            <Fact k={t("tool.upTo")}>{t("tool.teammates", { n: view.team.maxTeammates })}</Fact>
          </dl>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    case "TeamStatus":
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(view.members).map(([s, n]) => {
              const e = memberStatusEntry(s);
              return (
                <span key={s} className="inline-flex items-center gap-1">
                  <PillView entry={e} label={t(e.textKey)} status={s} />
                  <span className="text-[var(--text-secondary)]">×{n}</span>
                </span>
              );
            })}
          </div>
          <p className="m-0 text-[var(--text-primary)]">{t("tool.tasks", { summary: countsLine(t, view.tasks) })}</p>
          <TeamLink sessionId={sessionId} />
        </div>
      );
    case "TeamDelete":
      return (
        <p className="m-0 text-[var(--text-primary)]">
          {view.force ? t("tool.teamClosedForced") : t("tool.teamClosed")} <TeamLink sessionId={sessionId} />
        </p>
      );
    case "SendMessage": {
      const to = view.to ?? (typeof input.to === "string" ? input.to : "");
      const queued = view.delivery === "queued";
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[var(--text-secondary)]">{t("tool.to")}</span>
            <span className={`${PLAIN} font-semibold text-[var(--text-primary)]`}>{to === "*" || to === "all" ? t("tool.everyone") : to}</span>
            {input.priority === "urgent" ? <PillView entry={URGENT_MARKER} label={t("tool.urgent")} status="urgent" /> : null}
            <PillView entry={{ glyph: queued ? "◐" : "✓", textKey: "", pill: queued ? "warn" : "success" }} label={queued ? t("tool.queued") : t("tool.delivered")} status={view.delivery} />
          </div>
          <p tabIndex={0} className={`${PLAIN} focus-ring m-0 max-h-[30vh] overflow-y-auto rounded bg-[var(--bg-tertiary)] p-2 text-[var(--text-primary)]`}>
            {typeof input.message === "string" ? input.message : ""}
          </p>
        </div>
      );
    }
    case "TaskCreate":
      return (
        <div className="flex flex-col gap-1">
          <TaskLine id={view.task.id} title={view.task.title} />
          <div className={`${PLAIN} text-[var(--text-secondary)]`}>
            {view.task.owner ? t("tool.assignedTo", { owner: view.task.owner }) : t("tool.unassigned")}
            {view.task.blockedBy.length > 0 ? ` · ${t("tool.waitsFor", { ids: view.task.blockedBy.map((b) => `#${b}`).join(", ") })}` : ""}
          </div>
        </div>
      );
    case "TaskList":
      return (
        <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-1 overflow-y-auto p-0" data-testid="team-tool-tasks">
          {view.tasks.map((task) => {
            const e = taskStatusEntry(task.status);
            return (
              <li key={task.id} className="flex flex-wrap items-baseline gap-x-1.5">
                <span aria-hidden="true">{e.glyph}</span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">#{task.id}</span>
                <span className={`${PLAIN} min-w-0 text-[var(--text-primary)]`}>{task.title}</span>
                <span className={`${PLAIN} text-[var(--text-secondary)]`}>
                  {t(e.textKey)}
                  {task.owner ? ` · ${task.owner}` : ""}
                  {task.claimable ? ` · ${t("tool.claimable")}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      );
    case "TaskGet": {
      const e = taskStatusEntry(view.task.status);
      return (
        <div className="flex flex-col gap-1">
          <TaskLine id={view.task.id} title={view.task.title} />
          <div className={`${PLAIN} text-[var(--text-secondary)]`}>
            {t(e.textKey)}
            {view.task.owner ? ` · ${view.task.owner}` : ""}
            {view.task.blockedBy.length > 0 ? ` · ${t("tool.waitsFor", { ids: view.task.blockedBy.map((b) => `#${b}`).join(", ") })}` : ""}
          </div>
          <p tabIndex={0} className={`${PLAIN} focus-ring m-0 max-h-[30vh] overflow-y-auto text-[var(--text-primary)]`}>
            {view.task.description}
          </p>
        </div>
      );
    }
    case "TaskUpdate": {
      const from = taskStatusEntry(view.task.from);
      const to = taskStatusEntry(view.task.to);
      return (
        <div className="flex flex-col gap-1">
          <TaskLine id={view.task.id} title={view.task.title} />
          <div className="text-[var(--text-primary)]">
            {t(from.textKey)} <span aria-hidden="true">→</span>
            <span className="sr-only">{t("tool.changedTo")}</span> {t(to.textKey)}
            {view.task.owner ? <span className={`${PLAIN} text-[var(--text-secondary)]`}> · {view.task.owner}</span> : null}
          </div>
        </div>
      );
    }
    case "ShutdownRequest":
      return (
        <div className="flex flex-col gap-1">
          <div className={`${PLAIN} text-[var(--text-primary)]`}>{t("tool.askedShutdown", { name: String(input.to ?? "") })}</div>
          {input.reason ? <p className={`${PLAIN} m-0 text-[var(--text-secondary)]`}>{t("tool.reason", { reason: String(input.reason) })}</p> : null}
          <p className="m-0 text-[var(--text-secondary)]">{t("tool.shutdownNote")}</p>
        </div>
      );
    case "ShutdownResponse":
      return (
        <div className="flex flex-col gap-1">
          <PillView entry={{ glyph: view.approve ? "✓" : "✕", textKey: "", pill: view.approve ? "success" : "warn" }} label={view.approve ? t("tool.approved") : t("tool.rejected")} status={view.approve ? "approve" : "reject"} />
          {input.reason ? <p className={`${PLAIN} m-0 text-[var(--text-primary)]`}>{String(input.reason)}</p> : null}
        </div>
      );
  }
}

/** The shared body: never blank, never throws on malformed props. */
function TeamToolBody({ toolName, toolInput, sessionId, status, result, toolDetails }: TeamToolProps): ReactElement {
  const t = useLazyT(TOOL_TABLES);
  const input = toolInput !== null && typeof toolInput === "object" ? toolInput : {};
  if (!isTeamOp(toolName)) return <Fallback input={input} result={result} />;
  if (status === "running") {
    return (
      <div className="flex flex-col gap-1.5" data-testid="team-tool-running">
        <div>
          <PillView entry={{ glyph: "●", textKey: "", pill: "info" }} label={t("tool.waiting")} status="running" pulse />
        </div>
        <InputSummary input={input} />
      </div>
    );
  }
  if (status === "elided") return <Fallback input={input} result={result} note={t("tool.elided")} />;
  const parsed = parseToolDetails(toolName, toolDetails);
  if (status === "error") {
    const code = parsed?.kind === "error" ? parsed.code : typeof toolDetails?.error === "string" && toolDetails.error !== "" ? toolDetails.error : (result?.split(":")[0]?.trim() || "unknown");
    return <ErrorBody code={code} />;
  }
  if (!parsed) return <Fallback input={input} result={result} />;
  if (parsed.kind === "error") return <ErrorBody code={parsed.code} />;
  return <Success view={parsed.view} input={input} sessionId={sessionId} />;
}

export function TeamLifecycleToolRenderer(props: TeamToolProps): ReactElement {
  return <TeamToolBody {...props} />;
}
export function TeamMessageToolRenderer(props: TeamToolProps): ReactElement {
  return <TeamToolBody {...props} />;
}
export function TeamTaskToolRenderer(props: TeamToolProps): ReactElement {
  return <TeamToolBody {...props} />;
}
export function TeamShutdownToolRenderer(props: TeamToolProps): ReactElement {
  return <TeamToolBody {...props} />;
}
