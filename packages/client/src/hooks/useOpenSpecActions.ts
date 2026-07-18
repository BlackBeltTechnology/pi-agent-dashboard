/**
 * OpenSpec action callbacks extracted from App.tsx.
 *
 * After overlay-url-routing: `handleReadArtifact` navigates to the URL-driven
 * preview route instead of mutating `previewState`. The previous
 * `navigate`/`settingsMatch`/`tunnelSetupMatch` "auto-close-before-set" hack
 * is gone — browser history handles unwind naturally.
 */
import { useCallback } from "react";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildOpenSpecPreviewUrl } from "../lib/nav/route-builders.js";

export interface OpenSpecActionDeps {
  send: (msg: any) => void;
  openspecMap: Map<string, OpenSpecData>;
  /** wouter navigate — push the preview URL onto history. */
  navigate: (to: string) => void;
}

export function useOpenSpecActions(deps: OpenSpecActionDeps) {
  const { send, navigate } = deps;

  const handleOpenSpecRefresh = useCallback((cwd: string) => {
    send({ type: "openspec_refresh", cwd });
  }, [send]);

  const handleBulkArchive = useCallback((cwd: string) => {
    send({ type: "openspec_bulk_archive", cwd });
  }, [send]);

  const handleReadArtifact = useCallback((cwd: string, changeName: string, artifactId: string) => {
    navigate(buildOpenSpecPreviewUrl(cwd, changeName, artifactId));
  }, [navigate]);

  const handleAttachProposal = useCallback((sessionId: string, changeName: string) => {
    send({ type: "attach_proposal", sessionId, changeName });
  }, [send]);

  const handleDetachProposal = useCallback((sessionId: string) => {
    send({ type: "detach_proposal", sessionId });
  }, [send]);

  // Accept / dismiss a suggested proposal replacement. `accept` attaches the
  // committed `changeName` (server clears pending); dismiss records the
  // rejection. See change: replace-proposal-dialog-with-race-handling.
  const handleReplaceProposal = useCallback((sessionId: string, accept: boolean, changeName: string) => {
    const normalizedChangeName = changeName.trim();
    if (!sessionId || !normalizedChangeName) return;
    send({ type: accept ? "accept_replace_proposal" : "dismiss_replace_proposal", sessionId, changeName: normalizedChangeName });
  }, [send]);

  return {
    handleOpenSpecRefresh, handleBulkArchive, handleReadArtifact,
    handleAttachProposal, handleDetachProposal, handleReplaceProposal,
  };
}
