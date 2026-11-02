interface ModelState {
  model?: string;
  thinkingLevel?: string;
}

/** Live session metadata wins over historical model selections from replay. */
export function currentModelState(
  session: (ModelState & { status?: string }) | undefined,
  transcript: ModelState,
): ModelState {
  // Ended/archived rows are disk metadata, not a live bridge snapshot.
  if (session?.status === "ended") {
    return {
      model: transcript.model ?? session.model,
      thinkingLevel: transcript.thinkingLevel ?? session.thinkingLevel,
    };
  }
  return {
    model: session?.model ?? transcript.model,
    thinkingLevel: session?.thinkingLevel ?? transcript.thinkingLevel,
  };
}
