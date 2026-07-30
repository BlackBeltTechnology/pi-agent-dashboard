import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

let active;
const parentPid = Number.parseInt(process.env.PI_DASHBOARD_NESTED_PARENT_PID ?? "", 10);

// Detached children are outside the parent process group. Exit when Force
// Stop removes the owner so an inference worker cannot outlive its session.
if (Number.isSafeInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 500).unref();
}

process.on("message", async (message) => {
  if (message?.type === "abort") {
    await active?.abort();
    return;
  }
  if (message?.type !== "start" || active) return;

  const { request } = message;
  try {
    const { session } = await createAgentSession({
      cwd: request.cwd,
      sessionManager: SessionManager.inMemory(request.cwd),
      ...(request.model ? { model: request.model } : {}),
      ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
      ...(request.tools ? { tools: request.tools } : {}),
    });
    active = session;
    process.send?.({
      type: "event",
      runId: request.runId,
      event: { type: "worker_ready", sessionId: session.sessionManager.getSessionId() },
    });
    let output = "";
    let activeTools = 0;
    let toolHeartbeat;
    const refreshToolHeartbeat = () => {
      if (activeTools > 0 && !toolHeartbeat) {
        toolHeartbeat = setInterval(() => {
          process.send?.({
            type: "event",
            runId: request.runId,
            event: { type: "worker_active_tool" },
          });
        }, 20_000);
      }
      if (activeTools === 0 && toolHeartbeat) {
        clearInterval(toolHeartbeat);
        toolHeartbeat = undefined;
      }
    };
    const unsubscribe = session.subscribe((event) => {
      process.send?.({ type: "event", runId: request.runId, event });
      if (event.type === "tool_execution_start") {
        activeTools += 1;
        refreshToolHeartbeat();
      }
      if (event.type === "tool_execution_end") {
        activeTools = Math.max(0, activeTools - 1);
        refreshToolHeartbeat();
      }
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        output += event.assistantMessageEvent.delta ?? "";
      }
    });
    try {
      await session.prompt(request.prompt);
      process.send?.({ type: "result", runId: request.runId, result: output.trim() }, () => process.exit(0));
    } finally {
      if (toolHeartbeat) clearInterval(toolHeartbeat);
      unsubscribe();
      session.dispose();
      active = undefined;
    }
  } catch (error) {
    process.send?.(
      {
        type: "error",
        runId: request.runId,
        error: error instanceof Error ? error.message : String(error),
      },
      () => process.exit(1),
    );
  }
});
