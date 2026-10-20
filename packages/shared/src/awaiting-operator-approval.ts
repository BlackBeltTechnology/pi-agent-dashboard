/**
 * Shared attention predicate: a session is blocked on an operator approval when
 * either a file-access prompt (agent path gate) or a supervised tool-approval
 * prompt is pending. Every `awaitingFileAccess` consumer reads this instead of
 * the single flag. See change: add-supervised-tool-approval (D16).
 */
export function awaitingOperatorApproval(
  session: { awaitingFileAccess?: boolean; awaitingToolApproval?: boolean } | null | undefined,
): boolean {
  return session?.awaitingFileAccess === true || session?.awaitingToolApproval === true;
}
