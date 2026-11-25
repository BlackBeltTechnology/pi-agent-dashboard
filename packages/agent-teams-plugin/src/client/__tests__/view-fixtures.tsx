/**
 * Fixtures and render helpers of the Team view L1 tests: builders for members,
 * tasks and mail, a `snap()` with sensible defaults, and `renderHost` which wraps
 * the tree in the real `UiPrimitiveProvider` with a fake `ui:confirm-dialog`.
 * See change: add-agent-teams-ui.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { UiConfirmDialogProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SnapshotMail, SnapshotMember, SnapshotTask } from "../../shared/snapshot.js";
import type { MemberStatus, TaskStatus } from "../../shared/types.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { makeSnapshot } from "./fixtures.js";

export const member = (name: string, status: MemberStatus = "idle", over: Partial<SnapshotMember> = {}): SnapshotMember => ({ name, cwd: "/ws/lead", status, ...over });

export const task = (id: string, status: TaskStatus = "pending", over: Partial<SnapshotTask> = {}): SnapshotTask => ({
  id,
  title: `Task ${id}`,
  description: `Description of ${id}`,
  status,
  blockedBy: [],
  blocked: false,
  createdBy: "lead",
  createdAt: 0,
  ...over,
});

export const mail = (id: number, over: Partial<SnapshotMail> = {}): SnapshotMail => ({
  id,
  from: "alice",
  to: "lead",
  kind: "message",
  text: `text ${id}`,
  truncated: false,
  priority: "normal",
  wake: true,
  createdAt: Date.UTC(2026, 0, 1, 10, id % 60),
  ackedAt: Date.UTC(2026, 0, 1, 10, id % 60, 5),
  ...over,
});

/** A full snapshot; `members` / `tasks` / `mail` replace the defaults when given. */
export function snap(over: Partial<TeamUiSnapshot> = {}): TeamUiSnapshot {
  const base = makeSnapshot({ rev: 1 });
  return {
    ...base,
    name: "Team A",
    leadCwd: "/ws/lead",
    members: [member("alice", "busy", { sessionId: "S-alice", role: "dev" }), member("bob", "idle", { sessionId: "S-bob" })],
    tasks: [task("1", "completed"), task("2", "in_progress", { owner: "alice" }), task("3", "pending", { blockedBy: ["2"], blocked: true })],
    mail: [mail(1), mail(2, { from: "lead", to: "alice" })],
    mailTotal: 2,
    ...over,
  };
}

export interface FakeConfirm {
  messages: string[];
}

/** Render inside the real primitive provider with a fake `ui:confirm-dialog` (Cancel/Confirm buttons). */
export function renderHost(el: ReactElement, log: FakeConfirm = { messages: [] }) {
  const Confirm = ({ message, confirmLabel, onConfirm, onCancel }: UiConfirmDialogProps) => {
    log.messages.push(message);
    return (
      <div role="alertdialog" aria-label="Confirm" data-testid="confirm-dialog">
        <p>{message}</p>
        <button type="button" data-testid="confirm-ok" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" data-testid="confirm-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  };
  const wrap = (node: ReactElement) => withUiPrimitiveProvider({ "ui:confirm-dialog": Confirm as never }, node);
  const view = render(wrap(el));
  return { ...view, rerender: (node: ReactElement) => view.rerender(wrap(node)) };
}
