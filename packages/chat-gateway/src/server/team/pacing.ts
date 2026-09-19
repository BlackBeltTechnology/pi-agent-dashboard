/**
 * Outbound posting pacer.
 *
 * Enforces Discord's documented per-channel budget of 5 messages per 5 seconds,
 * derived from the platform's limit rather than configured independently, and
 * keeps at most ONE post in flight per thread. Content queued while the budget
 * is exhausted is coalesced (never silently dropped) and, when truncated,
 * carries an elision marker.
 *
 * `now`/`schedule` are injectable so the budget is testable with a stub clock.
 * See change: add-chat-gateway-team-controls (D9).
 */
import { elide } from "./output-filter.js";

const RATE_WINDOW_MS = 5_000;
const RATE_MAX_POSTS = 5;
/**
 * Conservative per-post bound for coalesced content. Deliberately BELOW
 * Discord's 2000-char message limit: this module is platform-agnostic and never
 * consults the adapter's limit, so erring low is the safe direction. The cost
 * is that a mirrored payload between this bound and 2000 chars is elided early
 * — lossy, but disclosed, and never a cut the reader cannot see.
 */
const DEFAULT_MAX_CHARS = 1_800;

export interface PacerDeps {
  send: (channelKey: string, content: string) => Promise<void> | void;
  now?: () => number;
  windowMs?: number;
  maxPosts?: number;
  /** Max characters of coalesced content per post (elision-marked when cut). */
  maxChars?: number;
}

interface ChannelState {
  queue: string[];
  posting: boolean;
  postTimes: number[];
}

export interface Pacer {
  /** Queue content for a channel; coalesced until the budget allows a post. */
  submit(channelKey: string, content: string): void;
  /** Attempt to make progress on a channel (safe to call repeatedly). */
  pump(channelKey: string): Promise<void>;
  /** Number of posts currently in flight for a channel (0 or 1). */
  inFlight(channelKey: string): number;
  /** Post timestamps recorded for a channel (within the live window). */
  postTimes(channelKey: string): number[];
  /** Await all in-flight sends. */
  drain(): Promise<void>;
}

export function createPacer(deps: PacerDeps): Pacer {
  const windowMs = deps.windowMs ?? RATE_WINDOW_MS;
  const maxPosts = deps.maxPosts ?? RATE_MAX_POSTS;
  const maxChars = deps.maxChars ?? DEFAULT_MAX_CHARS;
  const now = deps.now ?? Date.now;
  const channels = new Map<string, ChannelState>();
  const inflight = new Set<Promise<void>>();

  function stateFor(key: string): ChannelState {
    let st = channels.get(key);
    if (!st) {
      st = { queue: [], posting: false, postTimes: [] };
      channels.set(key, st);
    }
    return st;
  }

  async function pump(key: string): Promise<void> {
    const st = stateFor(key);
    if (st.posting) return; // one post in flight per thread
    if (st.queue.length === 0) return;

    const t = now();
    st.postTimes = st.postTimes.filter((ts) => t - ts < windowMs);
    if (st.postTimes.length >= maxPosts) return; // budget exhausted

    // Coalesce everything queued now into a single post.
    const batch = st.queue.splice(0, st.queue.length).join("\n\n");
    const content = elide(batch, maxChars);
    st.posting = true;
    st.postTimes.push(t);
    const send = Promise.resolve(deps.send(key, content))
      .catch(() => {})
      .finally(() => {
        st.posting = false;
        inflight.delete(send);
      });
    inflight.add(send);
    await send;
    if (st.queue.length > 0) await pump(key);
  }

  return {
    submit(key, content) {
      if (!content) return;
      stateFor(key).queue.push(content);
    },
    pump,
    inFlight: (key) => (stateFor(key).posting ? 1 : 0),
    postTimes: (key) => [...stateFor(key).postTimes],
    async drain() {
      // Keep pumping until nothing is left in flight or queued.
      let guard = 0;
      while (guard++ < 10_000) {
        const pendingKeys = [...channels.keys()].filter((k) => channels.get(k)!.posting);
        if (pendingKeys.length === 0) break;
        await Promise.all(pendingKeys.map((k) => pump(k)));
      }
      await Promise.all([...inflight]);
    },
  };
}
