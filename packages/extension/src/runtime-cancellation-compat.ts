const SESSION_PATCH = Symbol.for("pi-dashboard.runtime-cancellation.session-patch");
const AGENT_PATCH = Symbol.for("pi-dashboard.runtime-cancellation.agent-patch");
const TOOL_PATCH = Symbol.for("pi-dashboard.runtime-cancellation.tool-patch");

export const TOOL_ABORT_GRACE_MS = 2_000;

interface ToolLike {
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (...args: unknown[]) => unknown,
  ) => Promise<unknown>;
  [TOOL_PATCH]?: true;
  [key: PropertyKey]: unknown;
}

interface AgentLike {
  state: { tools: ToolLike[] };
  prompt: (...args: unknown[]) => Promise<unknown>;
  continue: (...args: unknown[]) => Promise<unknown>;
  [AGENT_PATCH]?: true;
}

interface SessionLike {
  agent: AgentLike;
  abortRetry(): void;
  bindExtensions(bindings: { abortHandler?: () => void; [key: string]: unknown }): Promise<unknown>;
}

interface SessionConstructor {
  prototype: SessionLike & { [SESSION_PATCH]?: true };
}

export interface RuntimeCancellationCompatOptions {
  toolAbortGraceMs?: number;
}

/**
 * Compatibility boundary for pi versions whose TUI abort handler only aborts
 * the active Agent. Uses exported runtime classes and never rewrites pi files.
 */
export function installRuntimeCancellationCompat(
  AgentSession: SessionConstructor,
  options: RuntimeCancellationCompatOptions = {},
): void {
  const prototype = AgentSession.prototype;
  if (prototype[SESSION_PATCH]) return;

  const originalBind = prototype.bindExtensions;
  const graceMs = options.toolAbortGraceMs ?? TOOL_ABORT_GRACE_MS;

  prototype.bindExtensions = function bindExtensionsWithCancellation(bindings) {
    patchAgentTools(this.agent, graceMs);
    const originalAbort = bindings.abortHandler;
    const nextBindings = originalAbort
      ? {
          ...bindings,
          abortHandler: () => {
            this.abortRetry();
            originalAbort();
          },
        }
      : bindings;
    return originalBind.call(this, nextBindings);
  };
  Object.defineProperty(prototype, SESSION_PATCH, { value: true });
}

function patchAgentTools(agent: AgentLike, graceMs: number): void {
  if (agent[AGENT_PATCH]) return;

  agent.prompt = wrapRun(agent, agent.prompt, graceMs);
  agent.continue = wrapRun(agent, agent.continue, graceMs);
  Object.defineProperty(agent, AGENT_PATCH, { value: true });
}

function wrapRun(
  agent: AgentLike,
  run: (...args: unknown[]) => Promise<unknown>,
  graceMs: number,
): (...args: unknown[]) => Promise<unknown> {
  return function runWithBoundedTools(this: AgentLike, ...args: unknown[]) {
    agent.state.tools = agent.state.tools.map((tool) => wrapTool(tool, graceMs));
    return run.apply(this, args);
  };
}

function wrapTool(tool: ToolLike, graceMs: number): ToolLike {
  if (tool[TOOL_PATCH]) return tool;

  const originalExecute = tool.execute;
  const wrapped: ToolLike = {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      let acceptingUpdates = true;
      const guardedUpdate = onUpdate
        ? (...args: unknown[]) => {
            if (acceptingUpdates) return onUpdate(...args);
          }
        : undefined;

      const execution = Promise.resolve().then(() =>
        originalExecute.call(tool, toolCallId, params, signal, guardedUpdate),
      );

      try {
        return await settleAfterAbort(execution, signal, graceMs, () => {
          acceptingUpdates = false;
        });
      } finally {
        acceptingUpdates = false;
      }
    },
  };
  Object.defineProperty(wrapped, TOOL_PATCH, { value: true });
  return wrapped;
}

function settleAfterAbort<T>(
  execution: Promise<T>,
  signal: AbortSignal | undefined,
  graceMs: number,
  onDetach: () => void,
): Promise<T> {
  if (!signal) return execution;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      if (timer || settled) return;
      timer = setTimeout(() => {
        finish(() => {
          onDetach();
          const error = new Error("Tool execution did not settle after abort grace period");
          error.name = "AbortError";
          reject(error);
        });
      }, graceMs);
    };

    execution.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );

    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
