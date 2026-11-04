// GENERIC mock kit — English only, no app names.
// A mock = one PAGE (or flow); a frame = Current | Proposed panes of REAL app components.
// The kit adds only the review layer: numbered rings around any element + reference links.
// Import in a mock as `mock-site/kit` (plugin alias). See change: add-live-component-mock-site.
import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RING_RE, refId } from "../src/mock-site/refs.mjs";

export { refId };
export type Status = "open" | "accepted" | "rejected";
/** One decision per mock page. `by` = who decided (user on the site, agent via `mock-decide`). */
export interface Decision { status: Exclude<Status, "open">; by: "user" | "agent"; note?: string; at: string }

interface FrameBase {
  /** Key word first: "Sessions page - desktop". */
  title: string;
  /** Pane width in px (default 640). Ignored when phone. */
  width?: number;
  /** Render each side in a real 375px iframe so the app's @media rules apply. */
  phone?: boolean;
  /** One-line reason (≤ 120 chars), shown under the title and in the page overview. */
  why?: string;
  /** Today's UI with today's props. Omit for a part that does not exist yet ("New"). */
  current?: ReactNode;
  /** Animate `steps` in one pane (reduced motion: side by side). */
  play?: boolean;
}
/** A frame shows `proposed` (with optional `current`) or a `steps` flow; it must have one of them. */
export type Frame = FrameBase & (
  | { proposed: ReactNode; steps?: Step[] }
  /** States of one flow, drawn instead of clicked: side by side by default. Ring numbers stay unique across steps. */
  | { proposed?: ReactNode; steps: Step[] }
);

/** One state of a flow. Wrap the element whose click leads to the next step in `Tap`. */
export interface Step { label: string; proposed: ReactNode }

/** Default export of `<root>/<id>/mock.tsx`. The id is the directory name. */
export interface Mock {
  title: string;
  /** Screen area, free text. */
  category: string;
  /** The change / ticket it belongs to (optional). */
  change?: string;
  frames: Frame[];
}

const MAX_TIP = 40;
export const MAX_WHY = 120;

/** True inside the animated player: `Tap` pulses instead of showing a static marker. */
export const InPlayer = createContext(false);
/** Marks the click target that leads to the next step (no handler: mocks stay prop-driven). */
export function Tap({ children }: { children: ReactNode }): ReactElement {
  const anim = useContext(InPlayer);
  return <span className={`mk-tap${anim ? " mk-tap-anim" : ""}`}>{children}<span className="mk-tap-dot" aria-hidden /></span>;
}

/** `<id>/<frame>/<side>` of the pane being rendered; rings derive their ref from it. */
export const RefBase = createContext<string | null>(null);
/** Top-level site URL of a ref (never the `?pane=` iframe URL). */
const refUrl = (ref: string): string => `${location.origin}${location.pathname}#${ref}`;

/** Link to a ref: navigates the TOP page (also from a phone iframe) and copies the URL. */
export function RefLink({ to, className, children, title }: { to: string; className?: string; children: ReactNode; title?: string }): ReactElement {
  return (
    <a href={refUrl(to)} target="_top" className={className} title={title ?? `Copy link: #${to}`}
      onClick={() => { void navigator.clipboard?.writeText(refUrl(to)).catch(() => {}); }}>{children}</a>
  );
}

function Ring({ n, tip, kind, block, children }: { n: number | string; tip: string; kind: "bad" | "ok"; block?: boolean; children: ReactNode }): ReactElement {
  // Badge = child of the ring (absolute) -> scrolls natively with the element, no JS, no lag.
  // Tip = body layer (escapes pane clipping), measured on hover, closed on any scroll.
  const el = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!box) return;
    const hide = () => setBox(null);
    addEventListener("scroll", hide, true);
    return () => removeEventListener("scroll", hide, true);
  }, [box]);
  const show = () => { if (el.current) setBox(el.current.getBoundingClientRect()); };
  const below = !!box && box.top < 56;
  const base = useContext(RefBase);
  const okN = RING_RE.test(String(n));
  const ref = base && okN ? `${base}/${n}` : null;
  return (
    <span ref={el} id={ref ? refId(ref) : undefined} className={`mk-ring mk-${kind}${block ? " mk-block" : ""}`} tabIndex={0} aria-label={tip}
      onMouseEnter={show} onFocus={show} onMouseLeave={() => setBox(null)} onBlur={() => setBox(null)}>
      {children}
      {ref ? <RefLink to={ref} className={`mk-ring-n mk-${kind}`}>{String(n)}</RefLink> : <span className={`mk-ring-n mk-${kind}`} aria-hidden>{String(n)}</span>}
      {!okN ? <span className="mk-long">BAD N</span> : tip.length > MAX_TIP ? <span className="mk-long">TIP &gt; {MAX_TIP}</span> : null}
      {box ? createPortal(
        <span className={`mk-tip mk-${kind}${below ? " mk-below" : ""}`} style={{ left: box.left + box.width / 2, top: below ? box.bottom + 12 : box.top - 12 }}>{tip}</span>,
        document.body) : null}
    </span>
  );
}

type RingProps = { n: number | string; tip: string; block?: boolean; children: ReactNode };
/** A problem on the Current side (red). `block` keeps a block / grid cell's layout. */
export const Issue = (p: RingProps): ReactElement => <Ring {...p} kind="bad" />;
/** The fix on the Proposed side (green), numbered like its Issue. */
export const Fix = (p: RingProps): ReactElement => <Ring {...p} kind="ok" />;

/** Every `tip` in a JSX tree — feeds search. */
export function tipsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { node.forEach((n) => tipsOf(n, out)); return out; }
  if (node && typeof node === "object" && "props" in (node as object)) {
    const p = (node as { props: Record<string, unknown> }).props;
    if (typeof p.tip === "string") out.push(p.tip);
    for (const v of Object.values(p)) if (v && typeof v === "object") tipsOf(v, out);
  }
  return out;
}
