// GENERIC mock site shell — English only, no app names.
// Sidebar (search + categories, newest first) | frames: Current | Proposed side by side.
// Accept / Reject per MOCK PAGE -> POST /__mock/decide -> <mockDir>/decision.json (git-visible).
// Only open mocks are listed unless "Show accepted / rejected". See change: add-live-component-mock-site.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { tipsOf, type Frame, type Mock, type Status, type Decision, RefBase, RefLink, refId, InPlayer, MAX_WHY } from "./kit.tsx";
import { MOCK_CONFIG } from "virtual:mock-site/config";
import { MOCKS as LOADED, ERRORS } from "virtual:mock-site/mocks";

type M = Mock & { id: string };
const ALL: M[] = LOADED.map(({ id, mock }) => ({ ...mock, id }));
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const frameText = (m: M, f: Frame) => fold([m.id, m.title, m.category, m.change ?? "", f.title, f.why ?? "", ...(f.steps ?? []).map((s) => s.label),
  ...tipsOf([f.current, f.proposed, ...(f.steps ?? []).map((s) => s.proposed)])].join(" "));
/** Frames that declare both `steps` and panes: steps win, reported as a problem. */
const STEP_PROBLEMS = ALL.flatMap((m) => m.frames.flatMap((f, i) => (f.steps?.length && (f.current !== undefined || f.proposed !== undefined)
  ? [`${m.id} frame ${i + 1}: steps and current/proposed both set (steps shown)`] : [])));
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
            {f.phone ? <PhonePane spec={`${base}/step-${k + 1}`} /> : <div className="mk-canvas">{s.proposed}</div>}
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
    <div className="mk-player" style={{ width: phone ? 375 : f.width ?? 320 }}>
      <div className="mk-canvas mk-stage">
        <InPlayer.Provider value={true}>
          {steps.map((s, i) => <div key={i} className={`mk-scene${i === k ? " on" : ""}`} aria-hidden={i !== k} inert={i !== k}>{phone ? <PhonePane spec={`${base}/step-${i + 1}`} /> : s.proposed}</div>)}
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
  f.phone ? <PhonePane spec={`${m.id}/${i + 1}/${side}`} /> : <RefBase.Provider value={`${m.id}/${i + 1}/${side}`}><div className="mk-canvas">{side === "current" ? f.current : f.proposed}</div></RefBase.Provider>;

/** One frame: header, `why`, then Current | Proposed panes or its steps. */
function FrameView({ m, f, i, reducedMotion }: { m: M; f: Frame; i: number; reducedMotion: boolean }): ReactElement {
  const w = f.phone ? 375 : f.width ?? 640;
  const ref = `${m.id}/${i + 1}`;
  return (
    <article id={refId(ref)} className="mk-frame">
      <div className="mk-fh">
        <RefLink to={ref} className="mk-fn">{i + 1}</RefLink>
        <span className="mk-ft">{f.title}</span>
        <RefLink to={ref} className="mk-ref">#{ref}</RefLink>
      </div>
      {f.why ? <Why why={f.why} /> : null}
      {f.steps?.length ? <StepsPane f={f} n={i + 1} base={ref} reducedMotion={reducedMotion} /> : (
        <div className="mk-pair">
          {f.current !== undefined ? <div className="mk-pane" id={refId(`${ref}/current`)} style={{ width: w }}><RefLink to={`${ref}/current`} className="mk-lab mk-bad">Current</RefLink>{pane(m, i, f, "current")}</div> : null}
          <div className="mk-pane" id={refId(`${ref}/proposed`)} style={{ width: w }}><RefLink to={`${ref}/proposed`} className="mk-lab mk-ok">{f.current === undefined ? "New" : "Proposed"}</RefLink>{pane(m, i, f, "proposed")}</div>
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

/** Content of `<side>` or `<side>/step-<k>` of a frame (undefined = no such pane). */
function paneNode(f: Frame | undefined, side: string | undefined, step: string | undefined): ReactNode {
  if (!f) return undefined;
  if (step === undefined) return side === "current" ? f.current : side === "proposed" ? f.proposed : undefined;
  if (side !== "proposed" || !/^step-[1-9]\d*$/.test(step)) return undefined;
  return f.steps?.[Number(step.slice(5)) - 1]?.proposed;
}
/** `?pane=<id>/<frame>/<side>[/step-<k>]` renders one pane only — the phone iframe. */
const PANE = new URLSearchParams(location.search).get("pane");
function PaneOnly({ spec }: { spec: string }): ReactElement {
  const [id, n, side, step] = spec.split("/");
  const idx = /^[1-9]\d*$/.test(n ?? "") ? Number(n) - 1 : -1;
  const f = ALL.find((m) => m.id === id)?.frames[idx];
  useEffect(() => {
    const apply = () => applyTheme(storedTheme());
    apply(); addEventListener("storage", apply); dark.addEventListener("change", apply);
    document.body.classList.add("mk-pane-only");
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
  }, [spec]);
  const node = paneNode(f, side, step);
  if (node === undefined) return <div className="mk-error">No such pane: {spec}</div>;
  return <RefBase.Provider value={spec}><div className="mk-canvas">{node}</div></RefBase.Provider>;
}
function PhonePane({ spec }: { spec: string }): ReactElement {
  // Start at the last height seen this session (else 240) with a loading line: no blank flash, no jump.
  const key = `mk-h:${spec}`;
  const [h, setH] = useState(() => Number(sessionStorage.getItem(key)) || 240);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.mkPane !== spec) return;
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-pane="${CSS.escape(spec)}"]`);
      if (frame && e.source === frame.contentWindow) { setH(e.data.h); setLoaded(true); sessionStorage.setItem(key, String(e.data.h)); }
    };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, [spec, key]);
  return (
    <div className="mk-phone-wrap">
      <iframe className="mk-phone" data-pane={spec} title={spec} src={`?pane=${encodeURIComponent(spec)}`} style={{ width: 375, height: h }} />
      {loaded ? null : <div className="mk-phone-load">Loading phone view…</div>}
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

type DecisionsReply = { decisions: Record<string, Decision>; canDecide: boolean; warnings: string[]; errors: string[] };

function Shell(): ReactElement {
  const [q, setQ] = useState("");
  const [hash, setHash] = useState(() => location.hash.slice(1));
  const [theme, setTheme] = useState(storedTheme);
  const [state, setState] = useState<DecisionsReply>({ decisions: {}, canDecide: false, warnings: [], errors: [] });
  const [showClosed, setShowClosed] = useState(false);

  const load = () => { void fetch("/__mock/decisions").then((r) => r.json()).then(setState).catch(() => {}); };
  useEffect(() => { load(); import.meta.hot?.on("mock:decisions", load); }, []);
  useEffect(() => { const on = () => setHash(location.hash.slice(1)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  useEffect(() => {
    applyTheme(theme); localStorage.setItem("mk-theme", theme);
    const on = () => applyTheme(theme); dark.addEventListener("change", on); return () => dark.removeEventListener("change", on);
  }, [theme]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "/" && document.activeElement?.id !== "mk-q") { e.preventDefault(); document.getElementById("mk-q")?.focus(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  const decide = async (id: string, status: Status) => {
    setState((s) => {
      const decisions = { ...s.decisions };
      if (status === "open") delete decisions[id]; else decisions[id] = { status, by: "user", at: new Date().toISOString() };
      return { ...s, decisions };
    });
    // Optimistic; a refused write (403/400/…) or network error reconciles from the files.
    const res = await fetch("/__mock/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }).catch(() => null);
    if (!res?.ok) load();
  };
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
        const frame = k < parts.length ? el.querySelector<HTMLIFrameElement>("iframe.mk-phone") : null;
        if (frame && parts.length === 4 && (await findInFrame(frame, parts.join("/")))) return;
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
  const problems = [...ERRORS, ...STEP_PROBLEMS, ...state.warnings];
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
          {selected && !q.trim() && state.canDecide ? (
            <span className="mk-actions">
              {statusOf(selected) === "open" ? (
                <>
                  <button type="button" className="mk-btn mk-accept" onClick={() => decide(selected.id, "accepted")}>Accept page</button>
                  <button type="button" className="mk-btn mk-reject" onClick={() => decide(selected.id, "rejected")}>Reject page</button>
                </>
              ) : (
                <button type="button" className="mk-btn" onClick={() => decide(selected.id, "open")}>Reopen ({statusOf(selected)})</button>
              )}
            </span>
          ) : null}
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
            {!q.trim() ? <Overview m={m} /> : null}
            {frames.map(({ f, i }) => <FrameView key={i} m={m} f={f} i={i} reducedMotion={reducedMotion} />)}
          </section>
        ))}
      </main>
    </div>
  );
}
