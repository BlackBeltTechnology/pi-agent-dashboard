/**
 * A scripted `OAuthLoginFlow` fake that models pi-ai's OWN abort semantics.
 *
 * Why the abort modelling is the whole point: in pi-ai's auth-code flows the
 * outer `signal` only calls `server.cancelWait()`; the code then `await`s a
 * `manualPromise`, and the `finally` that closes the listener is reached only
 * once that promise SETTLES. A host that merely stops waiting on abort
 * deadlocks and leaves the callback port bound. So this fake opens a "listener"
 * when it issues a `manual_code` prompt and closes it in the `finally` of that
 * prompt's `await` — a host that never rejects the pending prompt leaves
 * {@link FakeOAuthFlow.listenerClosed} `false`, which is exactly the assertion
 * test-plan X4 makes.
 *
 * Timers go through `setTimeout`, so the whole fake cooperates with
 * `vi.useFakeTimers()`.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D1, test-plan task 3.1).
 */

import type {
  LoginEvent,
  LoginInteraction,
  LoginPrompt,
  OAuthCredential,
  OAuthLoginFlow,
} from "../../auth/pi-oauth-types.js";

/** What the fake can be told to do, in order. */
export type FakeStep =
  | { kind: "notify"; event: LoginEvent | ((ctx: FakeCtx) => LoginEvent) }
  /**
   * Ask the host a question and wait for the answer. `then` splices further
   * steps after the answer — keyed by the answer, or `"*"` for a catch-all —
   * which is how the codex `select` and copilot `text` presets branch.
   *
   * `continueOnAbort` models pi-ai's raced prompt (the callback won, so the
   * prompt's own signal aborted): the flow keeps going instead of failing.
   */
  | {
      kind: "prompt";
      prompt: LoginPrompt;
      then?: Record<string, FakeStep[]>;
      continueOnAbort?: boolean;
    }
  /** Plain timer — deliberately NOT abort-aware, so a script can model "the
   * flow resolves shortly AFTER the host aborted it" (test-plan X6). */
  | { kind: "wait"; ms: number }
  /** Never settles (abortable only through the outer signal). */
  | { kind: "hang" }
  | { kind: "resolve"; credential?: OAuthCredential }
  | { kind: "reject"; message: string; afterMs?: number };

interface FakeCtx {
  /** Answers accepted so far, in prompt order. */
  answers: string[];
  /** The most recent answer, or undefined before the first prompt. */
  lastAnswer: string | undefined;
}

export interface FakeOAuthFlow extends OAuthLoginFlow {
  /** The interaction the adapter handed in (once login started). */
  interaction: LoginInteraction | undefined;
  /** Prompts the fake issued, in order. */
  promptsSeen: LoginPrompt[];
  /** Answers the host supplied, in order. */
  answers: string[];
  /** The flow controller's signal was aborted. */
  aborted: boolean;
  /**
   * A `manual_code` prompt's "listener" closed — i.e. the pending prompt
   * settled. Stays `false` under a host that only stops waiting on abort.
   */
  listenerClosed: boolean;
  /** This fake's currently open prompt listeners. */
  openListeners: number;
  /** Resolves once `login()` settled (either way). */
  settled: Promise<void>;
}

// ── Global open-listener accounting (test-plan P2) ───────────────────────────

let totalOpenListeners = 0;

/** Open prompt "listeners" across every fake — must return to 0 after pruning. */
export function totalOpenListenerCount(): number {
  return totalOpenListeners;
}

/** Reset the global counter between tests. */
export function resetFakeFlows(): void {
  totalOpenListeners = 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A plain timer; not tied to the signal. */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Never settles; rejects with pi-ai's string only if the controller aborts. */
function hang(signal: AbortSignal): Promise<void> {
  return new Promise<void>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("Login cancelled")), {
      once: true,
    });
  });
}

function defaultCredential(): OAuthCredential {
  return {
    type: "oauth",
    refresh: "fake-refresh",
    access: "fake-access",
    expires: Date.now() + 60 * 60 * 1000,
  };
}

// ── The fake ─────────────────────────────────────────────────────────────────

/**
 * Build a scripted fake flow. The step list is consumed in order; `prompt`
 * steps that carry `then` splice a branch after their answer.
 */
export function createFakeOAuthFlow(
  steps: FakeStep[],
  opts: { name?: string } = {},
): FakeOAuthFlow {
  let resolveSettled: () => void = () => {};

  const flow: FakeOAuthFlow = {
    name: opts.name ?? "Fake OAuth",
    login: async (interaction: LoginInteraction): Promise<OAuthCredential> => {
      try {
        const credential = await runLogin(interaction);
        return credential;
      } finally {
        resolveSettled();
      }
    },
    interaction: undefined,
    promptsSeen: [],
    answers: [],
    aborted: false,
    listenerClosed: false,
    openListeners: 0,
    settled: Promise.resolve(),
  };

  flow.settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  async function runLogin(interaction: LoginInteraction): Promise<OAuthCredential> {
    flow.interaction = interaction;
    if (interaction.signal.aborted) flow.aborted = true;
    else {
      interaction.signal.addEventListener("abort", () => {
        flow.aborted = true;
      });
    }

    const queue: FakeStep[] = [...steps];
    const ctx: FakeCtx = { answers: [], lastAnswer: undefined };

    while (queue.length > 0) {
      const step = queue.shift() as FakeStep;

      switch (step.kind) {
        case "notify": {
          interaction.notify(
            typeof step.event === "function" ? step.event(ctx) : step.event,
          );
          break;
        }
        case "wait": {
          await sleep(step.ms);
          break;
        }
        case "hang": {
          await hang(interaction.signal);
          break;
        }
        case "resolve": {
          return step.credential ?? defaultCredential();
        }
        case "reject": {
          if (step.afterMs !== undefined) {
            await sleep(step.afterMs);
          }
          throw new Error(step.message);
        }
        case "prompt": {
          flow.promptsSeen.push(step.prompt);
          const openedListener = step.prompt.type === "manual_code";
          if (openedListener) {
            flow.openListeners += 1;
            totalOpenListeners += 1;
          }
          let answer: string | undefined;
          try {
            answer = await interaction.prompt(step.prompt);
            flow.answers.push(answer);
            ctx.answers.push(answer);
            ctx.lastAnswer = answer;
          } catch (err) {
            if (!step.continueOnAbort) throw err;
          } finally {
            if (openedListener) {
              flow.openListeners -= 1;
              totalOpenListeners -= 1;
              // pi-ai's `finally`: the listener closes only after the pending
              // manualPromise settled — i.e. after the host rejected it.
              flow.listenerClosed = true;
            }
          }
          if (step.then !== undefined) {
            const branch = (answer !== undefined ? step.then[answer] : undefined) ??
              step.then["*"];
            if (branch !== undefined) queue.unshift(...branch);
          }
          break;
        }
      }
    }
    return defaultCredential();
  }

  return flow;
}

// ── Provider presets ─────────────────────────────────────────────────────────

/** `notify auth_url` then `prompt manual_code`, back-to-back (pi-ai's race). */
export function anthropicFlow(): FakeOAuthFlow {
  return createFakeOAuthFlow(
    [
      {
        kind: "notify",
        event: {
          type: "auth_url",
          url: "https://claude.ai/oauth/authorize?code=true&state=fake-state",
        },
      },
      {
        kind: "prompt",
        prompt: {
          type: "manual_code",
          message: "Paste the authorization code",
          placeholder: "code or full redirect URL",
        },
      },
      { kind: "resolve" },
    ],
    { name: "Anthropic (Claude Pro/Max)" },
  );
}

/** A leading `progress`, then `auth_url` + `manual_code` (single-slot union trap). */
export function openrouterFlow(): FakeOAuthFlow {
  return createFakeOAuthFlow(
    [
      { kind: "notify", event: { type: "progress", message: "Waiting for authorization" } },
      { kind: "notify", event: { type: "auth_url", url: "https://openrouter.ai/auth?code_challenge=x" } },
      {
        kind: "prompt",
        prompt: { type: "manual_code", message: "Paste the authorization code" },
      },
      { kind: "resolve" },
    ],
    { name: "OpenRouter OAuth" },
  );
}

/** `select` between the browser and device-code methods. */
export function codexFlow(): FakeOAuthFlow {
  return createFakeOAuthFlow(
    [
      {
        kind: "prompt",
        prompt: {
          type: "select",
          message: "How do you want to sign in?",
          options: [
            { id: "browser", label: "Sign in with browser" },
            { id: "device_code", label: "Device code login" },
          ],
        },
        then: {
          browser: [
            { kind: "notify", event: { type: "auth_url", url: "https://auth.openai.com/oauth/authorize?x=1" } },
            {
              kind: "prompt",
              prompt: { type: "manual_code", message: "Paste the redirect URL" },
            },
            { kind: "resolve" },
          ],
          device_code: [
            {
              kind: "notify",
              event: {
                type: "device_code",
                userCode: "CODEX-1234",
                verificationUri: "https://auth.openai.com/activate",
                intervalSeconds: 5,
                expiresInSeconds: 900,
              },
            },
            { kind: "wait", ms: 50 },
            { kind: "resolve" },
          ],
        },
      },
    ],
    { name: "OpenAI (ChatGPT Plus/Pro)" },
  );
}

/** `text` (enterprise domain) then `device_code` on the answered host. */
export function githubCopilotFlow(): FakeOAuthFlow {
  return createFakeOAuthFlow(
    [
      {
        kind: "prompt",
        prompt: {
          type: "text",
          message: "GitHub Enterprise URL/domain",
          placeholder: "blank for github.com",
        },
        then: {
          "*": [
            {
              kind: "notify",
              event: (ctx) => {
                const domain = ctx.lastAnswer ? ctx.lastAnswer : "github.com";
                return {
                  type: "device_code",
                  userCode: "ABCD-1234",
                  verificationUri: `https://${domain}/login/device`,
                  intervalSeconds: 5,
                  expiresInSeconds: 900,
                };
              },
            },
            { kind: "wait", ms: 50 },
            { kind: "resolve" },
          ],
        },
      },
    ],
    { name: "GitHub Copilot" },
  );
}

/** Pure device-code polling, no prompt: the mid-poll cancel case (X5). */
export function deviceCodeFlow(opts: { expiresInSeconds?: number } = {}): FakeOAuthFlow {
  return createFakeOAuthFlow(
    [
      {
        kind: "notify",
        event: {
          type: "device_code",
          userCode: "XAI-9999",
          verificationUri: "https://auth.x.ai/activate",
          intervalSeconds: 5,
          ...(opts.expiresInSeconds === undefined
            ? {}
            : { expiresInSeconds: opts.expiresInSeconds }),
        },
      },
      { kind: "hang" },
    ],
    { name: "xAI (Grok/X subscription)" },
  );
}
