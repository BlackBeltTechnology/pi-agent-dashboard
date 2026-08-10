import type {
  PromptAdapter,
  PromptBus,
  PromptRequest,
  PromptResponse,
} from "./prompt-bus.js";

export interface TuiPromptUi {
  select?: (
    question: string,
    options: string[],
    extra?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  input?: (
    question: string,
    placeholder?: string,
    extra?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  confirm?: (
    question: string,
    message: string,
    extra?: { signal?: AbortSignal },
  ) => Promise<boolean>;
  editor?: (
    question: string,
    prefill?: string,
    extra?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
}

function promptMessage(prompt: PromptRequest): string {
  return typeof prompt.metadata?.message === "string"
    ? prompt.metadata.message
    : "";
}

/** Create the PromptBus adapter that presents supported prompts in Pi's TUI. */
export function createTuiPromptAdapter(
  ui: TuiPromptUi,
  bus: Pick<PromptBus, "respond">,
): PromptAdapter {
  const activeControllers = new Map<string, AbortController>();

  return {
    name: "tui",

    onRequest(prompt) {
      const controller = new AbortController();
      activeControllers.set(prompt.id, controller);

      const present = async (): Promise<void> => {
        try {
          let answer: string | boolean | undefined;

          if (prompt.type === "select" && prompt.options && ui.select) {
            answer = await ui.select(prompt.question, prompt.options, {
              signal: controller.signal,
            });
          } else if (prompt.type === "input" && ui.input) {
            answer = await ui.input(
              prompt.question,
              prompt.defaultValue || "",
              { signal: controller.signal },
            );
          } else if (prompt.type === "confirm" && ui.confirm) {
            answer = await ui.confirm(prompt.question, promptMessage(prompt), {
              signal: controller.signal,
            });
          } else if (prompt.type === "editor" && ui.editor) {
            answer = await ui.editor(
              prompt.question,
              prompt.defaultValue || "",
              { signal: controller.signal },
            );
          } else {
            // There is intentionally no multiselect arm. Pi 0.70 RPC mode's
            // ctx.ui.custom is a no-op and would auto-cancel the dashboard UI.
            return;
          }

          if (!controller.signal.aborted) {
            const answerString = typeof answer === "boolean"
              ? (answer ? "true" : "false")
              : answer;
            bus.respond({
              id: prompt.id,
              answer: answerString ?? undefined,
              cancelled: answerString == null,
              source: "tui",
            });
          }
        } catch {
          if (!controller.signal.aborted) {
            bus.respond({ id: prompt.id, cancelled: true, source: "tui" });
          }
        } finally {
          activeControllers.delete(prompt.id);
        }
      };

      void present();
      return {};
    },

    onResponse(response: PromptResponse) {
      if (response.source !== "tui") {
        const controller = activeControllers.get(response.id);
        if (controller) {
          controller.abort();
          activeControllers.delete(response.id);
        }
      }
    },

    onCancel(id) {
      const controller = activeControllers.get(id);
      if (controller) {
        controller.abort();
        activeControllers.delete(id);
      }
    },
  };
}
