// Spike D: endpoint-only retention past cap + flushSync full-span mount on copy.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

const params = new URLSearchParams(location.search);
const N = Number(params.get("n") ?? 1000);
const CAP = Number(params.get("cap") ?? 40);
const MODE = params.get("mode") ?? "endpoints"; // endpoints | clear (today's behavior)
const NO_SEL_EVENT = params.get("noSel") === "1";
const LIVE = params.get("live") === "1" || params.get("live") === "2";
const LIVE_PERSIST = params.get("live") === "1";
const MEASURE_COPY_ROWS = params.get("measureCopy") === "1"; // attach measureElement to copy-only rows?

type Span = { min: number; max: number };
const w = window as any;
w.__log = [];

// Dashboard-like rows: header, paragraphs, a Prism-ish code block of token spans, sometimes tiny separator.
function rowKind(i: number) {
  return i % 7 === 3 ? "sep" : i % 5 === 1 ? "tool" : "msg";
}
function Row({ i }: { i: number }) {
  const kind = rowKind(i);
  if (kind === "sep") return <div className="sep">ROW-{i}-START sep ROW-{i}-END</div>;
  const lines = kind === "tool" ? 30 : 4;
  return (
    <div className="row">
      <div className="hdr">ROW-{i}-START <b>{kind}</b> #{i}</div>
      <p>Lorem ipsum <em>dolor</em> sit amet, consectetur adipiscing elit, sed do eiusmod tempor {i}.</p>
      <pre>
        {Array.from({ length: lines }, (_, l) => (
          <div key={l}>
            {Array.from({ length: 8 }, (_, t) => (
              <span key={t} className={`tok t${t}`}>tok{t} </span>
            ))}
          </div>
        ))}
      </pre>
      <div className="ftr">ROW-{i}-END</div>
    </div>
  );
}

function rowOf(container: HTMLElement, node: Node | null): number | null {
  if (!node || !container.contains(node)) return null;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const r = el?.closest("[data-index]");
  return r ? Number(r.getAttribute("data-index")) : null;
}

function App() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<Span | null>(null);
  const copySpanRef = useRef<Span | null>(null);
  const [, bump] = useState(0);

  const virtualizer = useVirtualizer({
    count: N,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rowKind(i) === "sep" ? 24 : rowKind(i) === "tool" ? 560 : 160),
    overscan: 6,
    rangeExtractor: (range) => {
      const set = new Set(defaultRangeExtractor(range));
      let s = spanRef.current;
      if (LIVE) {
        const el = document.getElementById("scroller");
        const sel = getSelection();
        if (el && sel && sel.rangeCount && !sel.isCollapsed) {
          const r = sel.getRangeAt(0);
          const a = rowOf(el, r.startContainer), b = rowOf(el, r.endContainer);
          if (a != null || b != null) {
            const lo = Math.min(a ?? b!, b ?? a!), hi = Math.max(a ?? b!, b ?? a!);
            s = s ? { min: Math.min(s.min, lo), max: Math.max(s.max, hi) } : { min: lo, max: hi };
            if (LIVE_PERSIST) spanRef.current = s; // so copy sees it too
          }
        }
      }
      if (s) {
        if (s.max - s.min + 1 <= CAP) for (let i = s.min; i <= s.max; i++) set.add(i);
        else { set.add(s.min); set.add(s.max); } // endpoints-only past cap
      }
      const c = copySpanRef.current;
      if (c) for (let i = c.min; i <= c.max; i++) set.add(i);
      return [...set].filter((i) => i >= 0 && i < range.count).sort((a, b) => a - b);
    },
  });
  w.__virt = virtualizer;

  useEffect(() => {
    const onSel = () => {
      const el = scrollRef.current!;
      const sel = getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { spanRef.current = null; return; }
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer) && !el.contains(r.endContainer) && !r.intersectsNode(el)) { spanRef.current = null; return; }
      const a = rowOf(el, r.startContainer) ?? 0;
      const b = rowOf(el, r.endContainer) ?? N - 1;
      const span = { min: Math.min(a, b), max: Math.max(a, b) };
      if (MODE === "clear" && span.max - span.min + 1 > CAP) { sel.removeAllRanges(); spanRef.current = null; return; }
      spanRef.current = span;
    };
    if (!NO_SEL_EVENT) document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const onCopy = useCallback((e: React.ClipboardEvent) => {
    w.__reactOnCopyFired = true;
    if (params.get("decline") === "1") { e.preventDefault(); return; }
    const sel = getSelection();
    const span = spanRef.current;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !span) return;
    const t0 = performance.now();
    const mountedBefore = scrollRef.current!.querySelectorAll("[data-index]").length;
    flushSync(() => { copySpanRef.current = span; bump((x) => x + 1); });
    const t1 = performance.now();
    const mountedDuring = scrollRef.current!.querySelectorAll("[data-index]").length;
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    const text = frag.textContent ?? "";
    const t2 = performance.now();
    flushSync(() => { copySpanRef.current = null; bump((x) => x + 1); });
    const t3 = performance.now();
    const missing: number[] = [];
    for (let i = span.min; i <= span.max; i++) if (!text.includes(`ROW-${i}-END`) && !text.includes(`ROW-${i}-START`)) missing.push(i);
    const ends = [...text.matchAll(/ROW-(\d+)-END/g)].map((m) => Number(m[1]));
    const ordered = ends.every((v, k) => k === 0 || v === ends[k - 1] + 1);
    w.__copy = { ordered, ends: ends.length,
      span, mountedBefore, mountedDuring, textLen: text.length, missingRows: missing.length, missingSample: missing.slice(0, 10),
      mountMs: +(t1 - t0).toFixed(1), cloneMs: +(t2 - t1).toFixed(1), releaseMs: +(t3 - t2).toFixed(1), totalMs: +(t3 - t0).toFixed(1),
      selStillAlive: !getSelection()!.isCollapsed,
    };
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }, []);

  const items = virtualizer.getVirtualItems();
  const copyOnly = copySpanRef.current;
  return (
    <>
    <div id="before" style={{ padding: 8 }}>BEFORE-TEXT sidebar</div>
    <textarea id="ta" style={{ position: "fixed", right: 0, top: 0, width: 200, height: 40 }} />
    <div ref={scrollRef} id="scroller" onCopy={onCopy} style={{ height: params.get("h") ?? "100vh", overflowY: "auto", overflowAnchor: "none" }}>
      <div style={{ position: "relative", width: "100%", height: virtualizer.getTotalSize() }}>
        {items.map((vi) => {
          const s = spanRef.current;
          const isCopyOnly = !!copyOnly && !MEASURE_COPY_ROWS && vi.index !== s?.min && vi.index !== s?.max &&
            !(defaultRangeExtractor({ ...virtualizer.range!, overscan: 6, count: N } as any).includes(vi.index));
          return (
            <div key={vi.key} data-index={vi.index} data-row-key={vi.key}
              ref={isCopyOnly ? undefined : virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
              <Row i={vi.index} />
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
