import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

const mockFetchChangedFiles = vi.fn();
const mockCommitFiles = vi.fn();
const mockDraft = vi.fn();

vi.mock("../../lib/git/git-api.js", () => ({
  fetchChangedFiles: (...a: any[]) => mockFetchChangedFiles(...a),
  commitFiles: (...a: any[]) => mockCommitFiles(...a),
  draftCommitMessage: (...a: any[]) => mockDraft(...a),
}));

import { CommitDialog } from "../worktree/CommitDialog.js";

afterEach(() => cleanup());

const files = [
  { path: "a.ts", state: "unstaged", additions: 3, deletions: 1 },
  { path: "b.ts", state: "staged", additions: 5, deletions: 0 },
  { path: "c.ts", state: "untracked" },
];

describe("CommitDialog", () => {
  beforeEach(() => {
    mockFetchChangedFiles.mockResolvedValue(files);
    mockCommitFiles.mockReset();
    mockDraft.mockReset();
  });

  const submitBtn = () => screen.getByTestId("commit-submit") as HTMLButtonElement;

  it("lists changed files and pre-selects all", async () => {
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("commit-file-list")).toBeTruthy());
    expect((screen.getByTestId("commit-file-a.ts") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("commit-file-b.ts") as HTMLInputElement).checked).toBe(true);
  });

  it("commit is disabled until ≥1 file + subject", async () => {
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    // all files selected, but no subject → disabled
    expect(submitBtn().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("commit-subject"), { target: { value: "feat: x" } });
    expect(submitBtn().disabled).toBe(false);
  });

  it("select-none disables commit", async () => {
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    fireEvent.change(screen.getByTestId("commit-subject"), { target: { value: "feat: x" } });
    fireEvent.click(screen.getByTestId("commit-select-all")); // toggles to none
    expect(submitBtn().disabled).toBe(true);
  });

  it("commits selected files and reports the short hash", async () => {
    mockCommitFiles.mockResolvedValue({ ok: true, data: { commitHash: "abcdef1234567890", subject: "feat: x" } });
    const onCommitted = vi.fn();
    const onClose = vi.fn();
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={onClose} onCommitted={onCommitted} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    fireEvent.change(screen.getByTestId("commit-subject"), { target: { value: "feat: x" } });
    fireEvent.click(screen.getByTestId("commit-submit"));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith("abcdef1", "/repo"));
    expect(mockCommitFiles).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", message: "feat: x" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("AI draft fills subject and body", async () => {
    mockDraft.mockResolvedValue({ message: "feat: add x\n\nsome body", source: "fork-subagent" });
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    fireEvent.click(screen.getByTestId("commit-ai-draft"));
    await waitFor(() => expect((screen.getByTestId("commit-subject") as HTMLInputElement).value).toBe("feat: add x"));
    expect((screen.getByTestId("commit-body") as HTMLTextAreaElement).value).toBe("some body");
  });

  it("AI draft unavailable shows a note (empty message)", async () => {
    mockDraft.mockResolvedValue({ message: "", source: "stub" });
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    fireEvent.click(screen.getByTestId("commit-ai-draft"));
    await waitFor(() => expect(screen.getByTestId("commit-draft-unavailable")).toBeTruthy());
  });

  it("surfaces a commit error", async () => {
    mockCommitFiles.mockResolvedValue({ ok: false, code: "commit-failed", error: "hook rejected" });
    render(<CommitDialog cwd="/repo" sessionId="s1" onClose={() => {}} />);
    await waitFor(() => screen.getByTestId("commit-file-list"));
    fireEvent.change(screen.getByTestId("commit-subject"), { target: { value: "feat: x" } });
    fireEvent.click(screen.getByTestId("commit-submit"));
    await waitFor(() => expect(screen.getByTestId("commit-error").textContent).toContain("hook rejected"));
  });
});
