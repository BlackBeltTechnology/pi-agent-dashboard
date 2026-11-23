/**
 * Opt-in provider for transcript link pre-confirmation (design D1/D2 of rich-chat-links).
 *
 * Mounted by `ChatView` ONLY when its `transcriptLinks` prop is set (the dashboard `App`), around the message list
 * and never around `FilePreviewHost`. Everything that depends on it — the file-type icon slot, `data-link-state`,
 * batching — is therefore transcript-only; with no provider above, `FileLink` renders exactly as before.
 *
 * It owns one shared `IntersectionObserver` and adapts the framework-free {@link LinkResolutionStore}:
 *  - `useLinkResolution` registers a link once it is settled AND in view, and subscribes it to its key;
 *  - a bump of `toolCompletions` (a tool call of `sessionId` finished — live `tool_execution_end` or the
 *    stale-tool reconcile both land in the reducer) drops that session's cached states;
 *  - the `LINK_GRANTS_CHANGED_EVENT` window event drops everything.
 *
 * See change: rich-chat-links.
 */
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  LINK_GRANTS_CHANGED_EVENT,
  type LinkEntry,
  type LinkRequest,
  type LinkResolutionStore,
  makeLinkKey,
  sharedLinkResolutionStore,
} from "../../lib/chat/link-resolution-store.js";

type VisibilityHandler = (visible: boolean) => void;

interface LinkResolutionApi {
  store: LinkResolutionStore;
  /** Observe `el`; `onChange` fires on every enter/leave. Returns the cleanup. */
  observe: (el: Element, onChange: VisibilityHandler) => () => void;
}

const LinkResolutionContext = createContext<LinkResolutionApi | null>(null);

interface ProviderProps {
  children: ReactNode;
  /** Defaults to the app-wide store; tests inject their own. */
  store?: LinkResolutionStore;
  /** The transcript's session: its cached states are dropped when `toolCompletions` grows. */
  sessionId?: string;
  /** Monotonic count of finished tool calls in the transcript's session. */
  toolCompletions?: number;
}

export function LinkResolutionProvider({ children, store = sharedLinkResolutionStore, sessionId, toolCompletions }: ProviderProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const handlers = useRef(new Map<Element, VisibilityHandler>());

  const observe = useCallback((el: Element, onChange: VisibilityHandler) => {
    // No IntersectionObserver (very old / test environments): treat the link as in view rather than never resolving it.
    if (typeof IntersectionObserver === "undefined") {
      onChange(true);
      return () => onChange(false);
    }
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        for (const e of entries) handlers.current.get(e.target)?.(e.isIntersecting);
      });
    }
    handlers.current.set(el, onChange);
    observerRef.current.observe(el);
    return () => {
      handlers.current.delete(el);
      observerRef.current?.unobserve(el);
      onChange(false);
    };
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  // A later tool call of this session may have created / deleted / renamed files. Skip the mount value.
  const lastCompletions = useRef(toolCompletions);
  useEffect(() => {
    if (toolCompletions === lastCompletions.current) return;
    lastCompletions.current = toolCompletions;
    if (sessionId) store.invalidateSession(sessionId);
  }, [toolCompletions, sessionId, store]);

  useEffect(() => {
    const onGrants = () => store.invalidateAll();
    window.addEventListener(LINK_GRANTS_CHANGED_EVENT, onGrants);
    return () => window.removeEventListener(LINK_GRANTS_CHANGED_EVENT, onGrants);
  }, [store]);

  const api = useMemo<LinkResolutionApi>(() => ({ store, observe }), [store, observe]);
  return <LinkResolutionContext.Provider value={api}>{children}</LinkResolutionContext.Provider>;
}

/**
 * `LinkResolutionProvider` when `enabled`, else a pass-through. Lets `ChatView` switch the feature on with one prop
 * without re-indenting its JSX; `enabled` is constant for a surface (only the dashboard `App` sets it).
 */
export function TranscriptLinkScope({ enabled, children, ...rest }: ProviderProps & { enabled?: boolean }) {
  return enabled ? <LinkResolutionProvider {...rest}>{children}</LinkResolutionProvider> : <>{children}</>;
}

/** What a link tells the store about itself. Absent `sessionId` / `cwd` means "nothing to resolve against". */
interface LinkSubject {
  sessionId?: string;
  cwd?: string;
  mention: string;
  toolCwd?: string;
  reRooted?: string;
  /** No running tool and not streaming text. */
  settled: boolean;
  ref: RefObject<Element | null>;
}

interface LinkResolution {
  /** True when a `LinkResolutionProvider` is above: the link is on the dashboard transcript. */
  active: boolean;
  /** The pre-confirmed state, or `undefined` while unknown. */
  entry: LinkEntry | undefined;
}

const NO_SUBSCRIBE = () => () => {};
const NO_ENTRY = () => undefined;

/**
 * Subscribe a transcript link to its pre-confirmed state and register it for resolution once settled and in view.
 * Outside a provider it is inert (`active: false`) so non-transcript surfaces render as before.
 */
export function useLinkResolution({ sessionId, cwd, mention, toolCwd, reRooted, settled, ref }: LinkSubject): LinkResolution {
  const api = useContext(LinkResolutionContext);
  const key = api && sessionId && cwd ? makeLinkKey(sessionId, toolCwd, mention, reRooted) : null;
  const store = api?.store;

  const [subscribe, getSnapshot] = useMemo(
    () => (store && key ? ([(cb: () => void) => store.subscribe(key, cb), () => store.getSnapshot(key)] as const) : ([NO_SUBSCRIBE, NO_ENTRY] as const)),
    [store, key],
  );
  const entry = useSyncExternalStore(subscribe, getSnapshot, NO_ENTRY);

  useEffect(() => {
    const el = ref.current;
    if (!api || !key || !el || !settled || !sessionId || !cwd) return;
    const req: LinkRequest = { key, sessionId, cwd, mention, ...(toolCwd ? { toolCwd } : {}), ...(reRooted ? { reRooted } : {}) };
    let registered = false;
    const stop = api.observe(el, (visible) => {
      if (visible && !registered) {
        registered = true;
        api.store.register(req);
      } else if (!visible && registered) {
        registered = false;
        api.store.unregister(key);
      }
    });
    return stop;
  }, [api, key, settled, sessionId, cwd, mention, toolCwd, reRooted, ref]);

  return { active: api !== null, entry };
}
