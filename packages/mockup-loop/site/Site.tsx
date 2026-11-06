// GENERIC mock site shell — English only, no app names.
// Sidebar (search + categories, newest first) | frames: Current | Proposed side by side.
// Decisions per MOCK PAGE are READ-ONLY here: written by the `mock-decide` CLI to
// <mockDir>/decision.json, refreshed live. Only open mocks are listed unless
// "Show accepted / rejected". Fixture-backed and scripted panes run in their own
// isolated same-origin document (`?pane=`). See change: add-live-component-mock-site,
// add-mock-site-exact-env.
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { tipsOf, type Frame, type Mock, type Status, type Decision, RefBase, RefLink, refId, InPlayer, MAX_WHY, paneContent } from "./kit.tsx";
import { frameworkProblem } from "../src/mock-site/frameworks.mjs";
import { MOCK_CONFIG } from "virtual:mock-site/config";
import { MOCKS as LOADED, ERRORS } from "virtual:mock-site/mocks";

type M = Mock & { id: string };
const ALL: M[] = LOADED.map(({ id, mock }) => ({ ...mock, id }));
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const frameText = (m: M, f: Frame) => fold([m.id, m.title, m.category, m.change ?? "", f.title, f.why ?? "", ...(f.steps ?? []).map((s) => s.label),
  ...tipsOf([f.current, f.proposed, ...(f.steps ?? []).map((s) => s.proposed)])].join(" "));
/** `script` + `steps`: script wins; `steps` + panes: steps win. Both reported as problems. */
const STEP_PROBLEMS = ALL.flatMap((m) => m.frames.flatMap((f, i) => (f.script?.length && f.steps?.length
  ? [`${m.id} frame ${i + 1}: script and steps both set (script runs)`]
  : !f.script?.length && f.steps?.length && (f.current !== undefined || f.proposed !== undefined)
    ? [`${m.id} frame ${i + 1}: steps and current/proposed both set (steps shown)`] : [])));
const FW_PROBLEMS = ALL.flatMap((m) => { const p = frameworkProblem(m.framework); return p ? [`${m.id}: ${p}`] : []; });
const scripted = (f: Frame | undefined) => !!f?.script?.length;
/** A pane needs its own document: phone viewport, fixtures, or a script. */
const fixturesOf = (m: M, f: Frame) => f.fixtures ?? m.fixtures;
const isolated = (m: M, f: Frame) => !!f.phone || !!fixturesOf(m, f) || scripted(f);
const drives = (f: Frame, side: "current" | "proposed") => scripted(f) && ((f.side ?? "proposed") === "both" || (f.side ?? "proposed") === side);
const letter = (k: number) => String.fromCharCode(97 + k);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

/** Steps side by side: each card is a ref target `<id>/<n>/proposed/step-<k>`. */
function Strip({ f, base, n }: { f: Frame; base: string; n: number }): ReactElement {
  return (
    <div className="mk-strip">
      {f.steps!.map((s, k) => (
        <div key={k} className="mk-step-wrap">
          {k > 0 ? <span className="mk-arrow" aria-hidden>→</span> : null}
          <div className="mk-step" id={refId(`${base}/step-${k + 1}`)} style={{ width: f.phone ? 375 : f.width ?? 300 }}>
            <RefLink to={`${base}/step-${k + 1}`} className="mk-step-l"><b>{n}{letter(k)}</b> {s.label}</RefLink>
            {f.phone ? <PaneFrame spec={`${base}/step-${k + 1}`} phone /> : <div className="mk-canvas">{paneContent(f, s.proposed)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Steps animated in one pane: 2.5 s per step, Pause/Play, one dot per step. */
function Player({ f, n, base }: { f: Frame; n: number; base: string }): ReactElement {
  const steps = f.steps!;
  const phone = !!f.phone;
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setK((x) => (x + 1) % steps.length), 2500);
    return () => clearInterval(t);
  }, [playing, steps.length]);
  return (
    <div className="mk-player" style={{ width: phone ? undefined : f.width ?? 320 }}>
      <div className={`mk-canvas mk-stage${phone ? " mk-stage-phone" : ""}`}>
        <InPlayer.Provider value={true}>
          {steps.map((s, i) => <div key={i} className={`mk-scene${i === k ? " on" : ""}`} aria-hidden={i !== k} inert={i !== k}>{phone ? <PaneFrame spec={`${base}/step-${i + 1}`} phone /> : paneContent(f, s.proposed)}</div>)}
        </InPlayer.Provider>
      </div>
      <div className="mk-dots">
        <button type="button" className="mk-btn mk-pp" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        {steps.map((s, i) => <button key={i} type="button" className={`mk-dot${i === k ? " on" : ""}`} aria-label={`Step ${n}${letter(i)} ${s.label}`} onClick={() => { setK(i); setPlaying(false); }} />)}
        <span className="mk-dot-l">{n}{letter(k)} {steps[k].label}</span>
      </div>
    </div>
  );
}
/** Page overview: one caption card per frame, linking to `#<id>/<n>`. */
function Overview({ m }: { m: M }): ReactElement {
  return (
    <nav className="mk-ov" aria-label="Frames">
      {m.frames.map((f, i) => (
        <a key={i} href={`#${m.id}/${i + 1}`} className="mk-ov-card">
          <span className="mk-ov-n">{i + 1}</span>
          <span className="mk-ov-b">
            <b>{f.title}</b>
            {f.why ? <span className="mk-ov-why">{f.why}</span> : null}
            <span className="mk-ov-chips"><Chips f={f} /></span>
          </span>
        </a>
      ))}
    </nav>
  );
}
function Chips({ f }: { f: Frame }): ReactElement {
  const phone = f.phone ? <span className="mk-chip">phone</span> : null;
  if (f.script?.length) return <><span className="mk-chip mk-chip-ok">{f.script.length}-step script</span>{phone}</>;
  if (f.steps?.length) return <><span className="mk-chip mk-chip-ok">{f.steps.length} steps{f.play ? " \u00b7 animated" : ""}</span>{phone}</>;
  return (
    <>
      {f.current !== undefined ? <span className="mk-chip">Current</span> : null}
      <span className="mk-chip mk-chip-ok">{f.current === undefined ? "New" : "Proposed"}</span>
      {phone}
    </>
  );
}
const Why = ({ why }: { why: string }): ReactElement => (
  <p className="mk-why">{why}{why.length > MAX_WHY ? <span className="mk-long mk-long-inline">WHY &gt; {MAX_WHY}</span> : null}</p>
);
/** A `steps` frame: strip by default, player when `play` (reduced motion: strip). */
function StepsPane({ f, n, base, reducedMotion }: { f: Frame; n: number; base: string; reducedMotion: boolean }): ReactElement {
  const side = `${base}/proposed`;
  return (
    <div className="mk-pair">
      <div className="mk-pane mk-pane-steps" id={refId(side)}>
        <RefLink to={side} className="mk-lab mk-ok">{f.steps!.length} steps</RefLink>
        <RefBase.Provider value={side}>
          {f.play && !reducedMotion ? <Player f={f} n={n} base={side} /> : <Strip f={f} base={side} n={n} />}
        </RefBase.Provider>
      </div>
    </div>
  );
}
const pane = (m: M, i: number, f: Frame, side: "current" | "proposed") =>
  isolated(m, f) ? <PaneFrame spec={`${m.id}/${i + 1}/${side}`} phone={!!f.phone} width={f.width} lazy={!f.phone} scripted={drives(f, side)} />
    : <RefBase.Provider value={`${m.id}/${i + 1}/${side}`}><div className="mk-canvas">{paneContent(f, side === "current" ? f.current : f.proposed)}</div></RefBase.Provider>;

/** Reduced motion: one live pane per step, paused right after it (ids `<id>/<n>/<side>/step-<k>`). */
function ScriptStrip({ m, f, n, side }: { m: M; f: Frame; n: number; side: "current" | "proposed" }): ReactElement {
  const base = `${m.id}/${n}/${side}`;
  return (
    <div className="mk-strip">
      {f.script!.map((s, k) => (
        <div key={k} className="mk-step-wrap">
          {k > 0 ? <span className="mk-arrow" aria-hidden>→</span> : null}
          <div className="mk-step" id={refId(`${base}/step-${k + 1}`)}>
            <RefLink to={`${base}/step-${k + 1}`} className="mk-step-l"><b>{n}{letter(k)}</b> {s.say}</RefLink>
            <PaneFrame spec={`${base}/step-${k + 1}`} phone={!!f.phone} width={f.width} lazy={!f.phone} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One frame: header, `why`, then Current | Proposed panes, its script, or its steps. */
function FrameView({ m, f, i, reducedMotion }: { m: M; f: Frame; i: number; reducedMotion: boolean }): ReactElement {
  const w = f.phone ? 375 : f.width ?? 640;
  const ref = `${m.id}/${i + 1}`;
  const side = (s: "current" | "proposed") => {
    const label = s === "current" ? "Current" : f.current === undefined ? "New" : "Proposed";
    const strip = reducedMotion && drives(f, s);
    return (
      <div className={`mk-pane${strip ? " mk-pane-steps" : ""}`} id={refId(`${ref}/${s}`)} style={strip ? undefined : { width: w }}>
        <RefLink to={`${ref}/${s}`} className={`mk-lab ${s === "current" ? "mk-bad" : "mk-ok"}`}>{label}</RefLink>
        {strip ? <ScriptStrip m={m} f={f} n={i + 1} side={s} /> : pane(m, i, f, s)}
      </div>
    );
  };
  return (
    <article id={refId(ref)} className="mk-frame">
      <div className="mk-fh">
        <RefLink to={ref} className="mk-fn">{i + 1}</RefLink>
        <span className="mk-ft">{f.title}</span>
        <RefLink to={ref} className="mk-ref">#{ref}</RefLink>
      </div>
      {f.why ? <Why why={f.why} /> : null}
      {!scripted(f) && f.steps?.length ? <StepsPane f={f} n={i + 1} base={ref} reducedMotion={reducedMotion} /> : (
        <div className="mk-pair">
          {f.current !== undefined ? side("current") : null}
          {side("proposed")}
        </div>
      )}
    </article>
  );
}
function useReducedMotion(): boolean {
  const [r, setR] = useState(reduced.matches);
  useEffect(() => { const on = () => setR(reduced.matches); reduced.addEventListener("change", on); return () => reduced.removeEventListener("change", on); }, []);
  return r;
}
const matches = (text: string, q: string) => fold(q).split(/\s+/).filter(Boolean).every((w) => text.includes(w));

type Theme = { id: string; label: string; attrs?: Record<string, string | null>; system?: { dark: string; light: string } };
const THEMES = MOCK_CONFIG.themes as Theme[];
const dark = matchMedia("(prefers-color-scheme: dark)");
function applyTheme(t: string) {
  let th = THEMES.find((x) => x.id === t) ?? THEMES[0];
  if (th.system) th = THEMES.find((x) => x.id === (dark.matches ? th.system!.dark : th.system!.light)) ?? th;
  if (!th.attrs) return;
  for (const [k, v] of Object.entries(th.attrs)) {
    if (v === null) document.documentElement.removeAttribute(k); else document.documentElement.setAttribute(k, v);
  }
}
const storedTheme = () => { const t = localStorage.getItem("mk-theme"); return THEMES.some((x) => x.id === t) ? t! : THEMES[0].id; };

/** Content of `<side>` or `<side>/step-<k>` of a frame (undefined = no such pane). Script frames: either side. */
function paneNode(f: Frame | undefined, side: string | undefined, step: string | undefined): ReactNode {
  if (!f) return undefined;
  const sideNode = side === "current" ? f.current : side === "proposed" ? f.proposed : undefined;
  if (step === undefined) return sideNode;
  if (!/^step-[1-9]\d*$/.test(step)) return undefined;
  const k = Number(step.slice(5));
  if (f.script?.length) return k <= f.script.length ? sideNode : undefined;
  if (side !== "proposed") return undefined;
  return f.steps?.[k - 1]?.proposed;
}
/** `?pane=<id>/<frame>/<side>[/step-<k>]` renders one pane only, in its own document. */
const PANE = new URLSearchParams(location.search).get("pane");
function PaneOnly({ spec }: { spec: string }): ReactElement {
  const [id, n, side, step] = spec.split("/");
  const idx = /^[1-9]\d*$/.test(n ?? "") ? Number(n) - 1 : -1;
  const m = ALL.find((x) => x.id === id);
  const f = m?.frames[idx];
  const node = paneNode(f, side, step);
  const runtime = !!m && !!f && node !== undefined && (!!fixturesOf(m, f) || scripted(f) || f.clockAt !== undefined);
  const [ready, setReady] = useState(!runtime);
  const [gen, setGen] = useState(0);
  const committed = useRef<(() => void) | null>(null);
  useEffect(() => { committed.current?.(); committed.current = null; }, [gen]);
  useEffect(() => {
    const apply = () => applyTheme(storedTheme());
    apply(); addEventListener("storage", apply); dark.addEventListener("change", apply);
    document.body.classList.add("mk-pane-only", f?.phone ? "mk-pane-phone" : "mk-pane-wide");
    const post = () => parent.postMessage({ mkPane: spec, h: document.documentElement.scrollHeight }, location.origin);
    const ro = new ResizeObserver(post); ro.observe(document.body);
    // Parent asks where a ring sits (deep link to a ring inside this iframe).
    const onMsg = (e: MessageEvent) => {
      if (e.source !== parent || e.origin !== location.origin || typeof e.data?.mkFind !== "string") return;
      const el = document.getElementById(refId(e.data.mkFind));
      if (!el) return;
      parent.postMessage({ mkFound: e.data.mkFind, top: el.getBoundingClientRect().top + scrollY }, location.origin);
      el.classList.remove("mk-hit"); void el.offsetWidth; el.classList.add("mk-hit");
    };
    addEventListener("message", onMsg);
    return () => { removeEventListener("storage", apply); dark.removeEventListener("change", apply); removeEventListener("message", onMsg); ro.disconnect(); };
  }, [spec, f?.phone]);
  useEffect(() => {
    if (!runtime || !m || !f) return;
    void import("./pane-runtime.ts").then(({ startPane }) => startPane({
      spec, fixtures: fixturesOf(m, f), script: f.script, clockAt: f.clockAt, loop: f.loop,
      driven: side === "current" || side === "proposed" ? drives(f, side) : false,
      step: step ? Number(step.slice(5)) : undefined,
      ready: () => setReady(true),
      remount: () => new Promise<void>((r) => { committed.current = r; setGen((g) => g + 1); }),
    }));
    // once per document: the runtime owns the loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (m && frameworkProblem(m.framework)) return <div className="mk-error">{frameworkProblem(m.framework)}</div>;
  if (!f || node === undefined) return <div className="mk-error">No such pane: {spec}</div>;
  if (!ready) return <div className="mk-pane-load">Loading pane…</div>;
  // Rings inside a step pane keep the side's base (`<id>/<n>/<side>/<ring>`).
  return <RefBase.Provider value={spec.replace(/\/step-\d+$/, "")}><div className="mk-canvas" key={gen}>{paneContent(f, node)}</div></RefBase.Provider>;
}

type Health = { completed: number; failed: number; error?: string };
/** An isolated pane: same-origin iframe sized to its content; lazy panes mount when scrolled near. */
function PaneFrame({ spec, phone = false, width, lazy = false, scripted: isScripted = false }: { spec: string; phone?: boolean; width?: number; lazy?: boolean; scripted?: boolean }): ReactElement {
  // Start at the last height seen this session (else 240) with a loading line: no blank flash, no jump.
  const key = `mk-h:${spec}`;
  const [h, setH] = useState(() => Number(sessionStorage.getItem(key)) || 240);
  const [loaded, setLoaded] = useState(false);
  const [near, setNear] = useState(!lazy);
  const [health, setHealth] = useState<Health | null>(null);
  const [paused, setPaused] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (near || !wrap.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "600px 0px" });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      if (e.data?.mkPane === spec) { setH(e.data.h); setLoaded(true); sessionStorage.setItem(key, String(e.data.h)); }
      if (e.data?.mkHealth === spec) setHealth({ completed: e.data.completed, failed: e.data.failed, error: e.data.error });
    };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, [spec, key]);
  const togglePause = () => { const p = !paused; setPaused(p); frame.current?.contentWindow?.postMessage({ mkPause: p }, location.origin); };
  return (
    <div className="mk-phone-wrap" ref={wrap}>
      {near ? <iframe ref={frame} className={`mk-iso${phone ? " mk-phone" : ""}`} data-pane={spec} title={spec} src={`?pane=${encodeURIComponent(spec)}`} style={{ width: phone ? 375 : width ?? 640, height: h }} />
        : <div className="mk-iso-ph" style={{ width: phone ? 377 : (width ?? 640) + 2, height: h + 2 }} />}
      {loaded ? null : <div className="mk-phone-load">{phone ? "Loading phone view…" : "Loading pane…"}</div>}
      {isScripted ? (
        <div className="mk-health" data-pane-health={spec}>
          <button type="button" className="mk-btn mk-pp" onClick={togglePause}>{paused ? "Play" : "Pause"}</button>
          <span>loops: {health?.completed ?? 0} completed, {health?.failed ?? 0} failed</span>
          {health?.error ? <span className="mk-health-err">{health.error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Scroll a ring inside a phone iframe into view (parent <-> iframe handshake). */
function findInFrame(frame: HTMLIFrameElement, ref: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let timer = 0;
    const done = (ok: boolean) => { clearInterval(timer); removeEventListener("message", on); resolve(ok); };
    const on = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin || e.data?.mkFound !== ref) return;
      const top = frame.getBoundingClientRect().top + scrollY + e.data.top;
      scrollTo({ top: Math.max(0, top - innerHeight / 2) });
      done(true);
    };
    addEventListener("message", on);
    const ask = () => { if (Date.now() - t0 > 3000) return done(false); frame.contentWindow?.postMessage({ mkFind: ref }, location.origin); };
    ask(); timer = window.setInterval(ask, 150);
  });
}

export function Site(): ReactElement {
  return PANE ? <PaneOnly spec={PANE} /> : <Shell />;
}

type DecisionsReply = { decisions: Record<string, Decision>; warnings: string[]; errors: string[] };
/** Missing fixtures reported by panes: mock id -> "METHOD path" -> pane specs. */
type Missing = Record<string, Record<string, string[]>>;

function Shell(): ReactElement {
  const [q, setQ] = useState("");
  const [hash, setHash] = useState(() => location.hash.slice(1));
  const [theme, setTheme] = useState(storedTheme);
  const [state, setState] = useState<DecisionsReply>({ decisions: {}, warnings: [], errors: [] });
  const [missing, setMissing] = useState<Missing>({});
  const [showClosed, setShowClosed] = useState(false);

  const load = () => { void fetch("/__mock/decisions").then((r) => r.json()).then(setState).catch(() => {}); };
  useEffect(() => { load(); import.meta.hot?.on("mock:decisions", load); }, []);
  useEffect(() => { const on = () => setHash(location.hash.slice(1)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || typeof e.data?.mkMissing !== "string") return;
      const spec: string = e.data.mkMissing;
      const [id] = spec.split("/");
      const what = `${String(e.data.method)} ${String(e.data.path)}`;
      setMissing((cur) => {
        const specs = cur[id]?.[what] ?? [];
        return specs.includes(spec) ? cur : { ...cur, [id]: { ...cur[id], [what]: [...specs, spec] } };
      });
    };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, []);
  useEffect(() => {
    applyTheme(theme); localStorage.setItem("mk-theme", theme);
    const on = () => applyTheme(theme); dark.addEventListener("change", on); return () => dark.removeEventListener("change", on);
  }, [theme]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.id !== "mk-q") { e.preventDefault(); document.getElementById("mk-q")?.focus(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  const decOf = (m: M): Decision | undefined => state.decisions[m.id];
  const statusOf = (m: M): Status => decOf(m)?.status ?? "open";

  const listed = ALL.filter((m) => showClosed || statusOf(m) === "open");
  const [hid] = hash.split("/");
  // The opened page stays shown after a decision (and deep links open decided pages) until navigation.
  const selected = ALL.find((m) => m.id === hid) ?? listed[0];
  useEffect(() => {
    // deepest existing part wins: ring > side > frame; rings inside phone iframes via handshake
    const parts = hash.split("/");
    const t = setTimeout(async () => {
      for (let k = parts.length; k > 1; k--) {
        const el = document.getElementById(refId(parts.slice(0, k).join("/")));
        if (!el) continue;
        if (k < parts.length && parts.length === 4 && el.querySelector(".mk-iso-ph, iframe.mk-iso")) {
          el.scrollIntoView({ block: "center" }); // mounts a lazy pane
          await new Promise((r) => setTimeout(r, 100));
          const frame = el.querySelector<HTMLIFrameElement>("iframe.mk-iso");
          if (frame && (await findInFrame(frame, parts.join("/")))) return;
        }
        el.scrollIntoView({ block: "center" });
        el.classList.remove("mk-hit"); void el.offsetWidth; el.classList.add("mk-hit");
        return;
      }
      if (parts.length === 1) scrollTo(0, 0);
    }, 50);
    return () => clearTimeout(t);
  }, [hash]);

  const hits = useMemo(() => (q.trim() ? listed.map((m) => ({ m, frames: m.frames.map((f, i) => ({ f, i })).filter(({ f }) => matches(frameText(m, f), q)) })).filter((h) => h.frames.length) : []), [q, listed]);
  const shown = q.trim() ? hits : selected ? [{ m: selected, frames: selected.frames.map((f, i) => ({ f, i })) }] : [];
  const categories = [...new Set(listed.map((m) => m.category))];
  const problems = [...ERRORS, ...STEP_PROBLEMS, ...FW_PROBLEMS, ...state.warnings];
  const reducedMotion = useReducedMotion();

  return (
    <div className="mk-site">
      <aside className="mk-side">
        <div className="mk-brand">{MOCK_CONFIG.title}</div>
        <input id="mk-q" className="mk-q" type="search" placeholder="Search... (/)" aria-label="Search mocks" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        {categories.map((c) => (
          <div key={c}>
            <div className="mk-sec">{c}</div>
            {listed.filter((m) => m.category === c).map((m) => (
              <a key={m.id} href={`#${m.id}`} className={`mk-item${m.id === selected?.id && !q.trim() ? " on" : ""}`} onClick={() => setQ("")}>
                <span className="mk-it">{m.title}</span>
                <span className="mk-im">{m.id.slice(0, 10)} - {m.frames.length} frames - <span className={`mk-pill mk-${statusOf(m)}`}><span className="d" />{statusOf(m)}</span></span>
              </a>
            ))}
          </div>
        ))}
        <label className="mk-closed"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show accepted / rejected</label>
        {problems.length ? <ul className="mk-problems" aria-label="Mock problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      </aside>
      <main className="mk-main">
        <div className="mk-bar">
          <span className="mk-sp" />
          <span className="mk-theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>{t.label}</button>
            ))}
          </span>
        </div>
        {ALL.length === 0 ? (
          <div className="mk-empty mk-none"><b>No mocks yet</b><p>Create <code>mockups/&lt;yyyy-mm-dd-slug&gt;/mock.tsx</code> (or <code>openspec/changes/&lt;change&gt;/mockups/&lt;id&gt;/mock.tsx</code>).</p></div>
        ) : shown.length === 0 ? <p className="mk-empty">{q.trim() ? "No match." : "Nothing open. All mocks are decided."}</p> : null}
        {shown.map(({ m, frames }) => (
          <section key={m.id} className="mk-change">
            <header className={`mk-ch mk-st-${statusOf(m)}`}>
              <div>
                <h1>{m.title} <RefLink to={m.id} className="mk-ref">#{m.id}</RefLink></h1>
                <div className="mk-meta">{m.id.slice(0, 10)} - {m.category}{m.change ? <> - <code>{m.change}</code></> : null} - {m.frames.length} frames - <span className={`mk-pill mk-${statusOf(m)}`}><span className="d" />{statusOf(m)}</span>{decOf(m) ? <span className="mk-by"> by {decOf(m)!.by}</span> : null}</div>
                {decOf(m)?.note ? <p className="mk-note">{decOf(m)!.note}</p> : null}
              </div>
            </header>
            {missing[m.id] ? (
              <section className="mk-missing" aria-label="Missing fixtures">
                <b>Missing fixtures</b>
                <ul>{Object.entries(missing[m.id]).map(([what, specs]) => (
                  <li key={what}><code>{what}</code> {specs.map((s) => <RefLink key={s} to={s} className="mk-ref">#{s}</RefLink>)}</li>
                ))}</ul>
              </section>
            ) : null}
            {frameworkProblem(m.framework) ? <div className="mk-error">{frameworkProblem(m.framework)}</div> : <>
              {!q.trim() ? <Overview m={m} /> : null}
              {frames.map(({ f, i }) => <FrameView key={i} m={m} f={f} i={i} reducedMotion={reducedMotion} />)}
            </>}
          </section>
        ))}
      </main>
    </div>
  );
}
