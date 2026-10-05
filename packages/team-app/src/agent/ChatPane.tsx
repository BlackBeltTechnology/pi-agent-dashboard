/**
 * Conversation (A7): ensure → ticketed socket → headless state → `ChatView` +
 * `CommandInput`. States: ensuring (spawn / resume), ready, busy, reconnecting,
 * stale, archived, retired / unassigned (read-only), ensure errors with Retry.
 * See change: add-team-plugin (D10).
 */
import { useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { ChatView, CommandInput, type ToolContext } from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import { type ReactNode, useEffect, useState } from "react";
import { ApiError } from "../api/client.js";
import type { Agent, Conversation, Target } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { agentPath, useNav, withProject } from "../shell/nav.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { StatusEl } from "../team/AgentCard.js";
import { ConfirmDialog, TextDialog } from "../ui/dialogs.js";
import { Icon } from "../ui/icons.js";
import { MenuButton, type MenuEntry } from "../ui/menu.js";
import { useToast } from "../ui/toast.js";
import { ChatProviders } from "./chat-providers.js";
import { useTeamChat } from "./chat-session.js";

type EnsureState =
  | { kind: "ensuring" }
  | { kind: "ready"; sessionId: string }
  | { kind: "error"; code: string };

export interface ChatPaneProps {
  agent: Agent;
  conv: Conversation;
  target: Target;
  readOnlyReason: "retired" | "unassigned" | "full" | null;
  onChanged(): void;
}

function ErrorBanner({ code, onRetry }: { code: string; onRetry(): void }) {
  const t = useT();
  const known = code === "spawn_timeout" || code === "guard_unavailable";
  const title = known ? t(`cv.${code}` as never) : code === "conversation_unrecoverable" ? t("cv.unrecoverable") : t("grid.error");
  const detail = known ? t(`cv.${code}Detail` as never) : code === "conversation_unrecoverable" ? t("cv.unrecoverableDetail") : t("grid.errorDetail");
  return (
    <div className="callout callout-error" role="alert">
      <Icon name="alert" className="ic sm" />
      <div className="grow">
        <p><strong>{title}</strong></p>
        <p>{detail}</p>
      </div>
      {code === "conversation_unrecoverable" ? null : (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <Icon name="refresh" className="ic sm" />
          {t("cv.retry")}
        </button>
      )}
    </div>
  );
}

function ChatBody({ sessionId, agent }: { sessionId: string; agent: Agent }) {
  const host = useAppHost();
  const t = useT();
  const chat = useTeamChat(host, sessionId);
  const toolContext: ToolContext = { sessionId, session: chat.state };
  const streaming = (chat.state as { status?: string }).status === "streaming";
  return (
    <>
      {chat.status === "reconnecting" ? (
        <div className="callout callout-warning" role="status">
          <Icon name="warning" className="ic sm" />
          <div className="grow">
            <p><strong>{t("cv.reconnect")}</strong></p>
            <p>{t("cv.reconnectDetail")}</p>
          </div>
        </div>
      ) : null}
      <div className="transcript" data-testid="transcript" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ChatView sessionId={sessionId} state={chat.state} toolContext={toolContext} onAbort={chat.abort} />
      </div>
      <div className="composer">
        <CommandInput
          commands={[]}
          sessionId={sessionId}
          sessionStatus={streaming ? "streaming" : "idle"}
          disabled={chat.status !== "connected"}
          onSend={(text) => chat.sendPrompt(text)}
          onAbort={chat.abort}
        />
        <p className="composer-hint">
          <Icon name="shield" className="ic sm" />
          {t("cv.hint")}
        </p>
      </div>
      <span className="sr-only">{agent.name}</span>
    </>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function ChatPane({ agent, conv, target, readOnlyReason, onChanged }: ChatPaneProps) {
  const t = useT();
  const host = useAppHost();
  const nav = useNav();
  const { toast } = useToast();
  const { api } = useEffectiveTarget();
  const [ensure, setEnsure] = useState<EnsureState>({ kind: "ensuring" });
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const blocked = !!readOnlyReason || conv.archived;
  const wasSleeping = conv.status === "sleeping";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    setEnsure({ kind: "ensuring" });
    api
      .ensure(agent.key, target, conv.id)
      .then((r) => !cancelled && setEnsure({ kind: "ready", sessionId: r.sessionId }))
      .catch((e) => !cancelled && setEnsure({ kind: "error", code: e instanceof ApiError ? e.code : "error" }));
    return () => {
      cancelled = true;
    };
  }, [api, agent.key, target, conv.id, blocked, attempt]);

  const restoreConv = async () => {
    try {
      await api.patchConversation(agent.key, target, conv.id, { archived: false });
      toast(t("toast.restoredConv"));
      onChanged();
      nav.navigate(withProject(agentPath(agent.key, conv.id), target));
    } catch (e) {
      toast(e instanceof ApiError && e.code === "conversation_limit" ? t("cv.limit", { max: 50 }) : t("grid.error"));
    }
  };
  const restart = async () => {
    await api.restart(agent.key, target, conv.id);
    toast(t("toast.restarted"));
    onChanged();
    setAttempt((n) => n + 1);
  };

  const items: MenuEntry[] = [];
  if (conv.personaStale && !blocked) items.push({ id: "restart", label: <><Icon name="refresh" className="ic sm" />{t("menu.restart")}</>, onSelect: () => void restart() });
  items.push({ id: "rename", label: <><Icon name="edit" className="ic sm" />{t("menu.rename")}</>, onSelect: () => setDialog("rename") });
  if (host.capabilities.dashboard && ensure.kind === "ready") {
    const sid = ensure.sessionId;
    items.push({ id: "open-dash", label: <><Icon name="openExt" className="ic sm" />{t("menu.openDash")}</>, onSelect: () => host.openSession(sid) });
  }
  if (conv.archived) items.push({ id: "restore", label: <><Icon name="reset" className="ic sm" />{t("menu.restore")}</>, onSelect: () => void restoreConv() });
  else
    items.push({
      id: "archive",
      label: <><Icon name="archive" className="ic sm" />{t("menu.archive")}</>,
      onSelect: () => {
        void api.patchConversation(agent.key, target, conv.id, { archived: true }).then(() => {
          toast(t("toast.archived"));
          onChanged();
          nav.toAgent(agent.key, target);
        });
      },
    });
  items.push("sep", { id: "delete", danger: true, label: <><Icon name="trash" className="ic sm" />{t("menu.deleteConv")}</>, onSelect: () => setDialog("delete") });

  const banners: ReactNode[] = [];
  if (readOnlyReason)
    banners.push(
      <div key="ro" className="callout callout-warning" role="status">
        <Icon name="warning" className="ic sm" />
        <div className="grow"><p>{t(`cv.readOnly.${readOnlyReason}` as never)}</p></div>
      </div>,
    );
  if (conv.archived)
    banners.push(
      <div key="ar" className="callout callout-info">
        <Icon name="archive" className="ic sm" />
        <div className="grow"><p>{t("cv.archivedBanner")}</p></div>
        {readOnlyReason ? null : (
          <button type="button" className="btn btn-secondary" onClick={() => void restoreConv()}>
            <Icon name="reset" className="ic sm" />
            {t("menu.restore")}
          </button>
        )}
      </div>,
    );
  if (conv.personaStale && !blocked)
    banners.push(
      <div key="st" className="callout callout-info">
        <Icon name="info" className="ic sm" />
        <div className="grow"><p>{t("cv.stale")}</p></div>
        <button type="button" className="btn btn-secondary" onClick={() => void restart()}>
          <Icon name="refresh" className="ic sm" />
          {t("cv.restart")}
        </button>
      </div>,
    );
  if (ensure.kind === "error" && !blocked) banners.push(<ErrorBanner key="er" code={ensure.code} onRetry={() => setAttempt((n) => n + 1)} />);

  return (
    <section className="chat-pane" aria-label={conv.title}>
      <div className="chat-head">
        <button type="button" className="back-link list-back" onClick={() => nav.toAgent(agent.key, target)}>
          <Icon name="back" className="ic sm" />
          {t("cv.backList")}
        </button>
        <div className="chat-title">
          <h2 className="conv-heading">{conv.title}</h2>
          <span className="convo-meta">
            <StatusEl status={ensure.kind === "ensuring" && !blocked ? "sleeping" : conv.status} />
            <span className="chip model hide-sm">{agent.model || t("model.default")}</span>
          </span>
        </div>
        <MenuButton label={t("cv.convMenu", { title: conv.title })} items={items} testId="conv-menu" />
      </div>
      <div className="convo-banners">{banners}</div>
      {blocked ? (
        <div className="transcript" data-testid="transcript"><p className="hint chat-empty">{t("cv.startHint", { name: agent.name })}</p></div>
      ) : ensure.kind === "ensuring" ? (
        <div className="transcript" data-testid="transcript">
          <p className="thinking" role="status" style={{ marginTop: "2rem" }}>
            <span className="shape shape-busy" aria-hidden="true" />
            {t(wasSleeping ? "cv.resume" : "cv.spawn")}
          </p>
        </div>
      ) : ensure.kind === "ready" ? (
        host.mode === "standalone" ? (
          <ChatProviders apiBase=""><ChatBody sessionId={ensure.sessionId} agent={agent} /></ChatProviders>
        ) : (
          <ChatBody sessionId={ensure.sessionId} agent={agent} />
        )
      ) : (
        <div className="transcript" data-testid="transcript" />
      )}
      {dialog === "rename" ? (
        <TextDialog
          title={t("dlg.rename.title")}
          label={t("dlg.rename.label")}
          hint={t("dlg.rename.hint")}
          initial={conv.title}
          okLabel={t("dlg.rename.ok")}
          validate={(v) => [...v.trim()].length >= 1 && [...v].length <= 80}
          errorText={t("err.title_invalid")}
          onOk={(v) => void api.patchConversation(agent.key, target, conv.id, { title: v.trim() }).then(() => { toast(t("toast.renamed")); onChanged(); })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={t("dlg.deleteConv.title", { title: conv.title })}
          body={<p>{t("dlg.deleteConv.body")}</p>}
          okLabel={t("dlg.deleteConv.ok")}
          destructive
          onOk={() => void api.deleteConversation(agent.key, target, conv.id).then(() => { toast(t("toast.deletedConv")); onChanged(); nav.toAgent(agent.key, target); })}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
