// GENERIC mock site shell — English only, no app names.
// Sidebar (search + categories, newest first) | frames: Current | Proposed side by side.
// Accept / Reject per MOCK PAGE -> POST /__mock/decide -> <mockDir>/decision.json (git-visible).
// Only open mocks are listed unless "Show accepted / rejected". See change: add-live-component-mock-site.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { tipsOf, type Frame, type Mock, type Status, type Decision, RefBase, RefLink, refId } from "./kit.tsx";
import { MOCK_CONFIG } from "virtual:mock-site/config";
import { MOCKS as LOADED, ERRORS } from "virtual:mock-site/mocks";

type M = Mock & { id: string };
const ALL: M[] = LOADED.map(({ id, mock }) => ({ ...mock, id }));
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const frameText = (m: M, f: Frame) => fold([m.id, m.title, m.category, m.change ?? "", f.title, ...tipsOf([f.current, f.proposed])].join(" "));
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

/** `?pane=<id>/<frame>/<side>` renders one pane only — the phone iframe. */
const PANE = new URLSearchParams(location.search).get("pane");
function PaneOnly({ spec }: { spec: string }): ReactElement {
  const [id, n, side] = spec.split("/");
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
  if (!f || (side !== "current" && side !== "proposed")) return <div className="mk-error">No such pane: {spec}</div>;
  return <RefBase.Provider value={spec}><div className="mk-canvas">{side === "current" ? f.current : f.proposed}</div></RefBase.Provider>;
}
function PhonePane({ spec }: { spec: string }): ReactElement {
  const [h, setH] = useState(160);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.mkPane !== spec) return;
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[data-pane="${CSS.escape(spec)}"]`);
      if (frame && e.source === frame.contentWindow) setH(e.data.h);
    };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, [spec]);
  return <iframe className="mk-phone" data-pane={spec} title={spec} src={`?pane=${encodeURIComponent(spec)}`} style={{ width: 375, height: h }} />;
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

  useEffect(() => {
    const load = () => fetch("/__mock/decisions").then((r) => r.json()).then(setState).catch(() => {});
    load(); import.meta.hot?.on("mock:decisions", load);
  }, []);
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
    await fetch("/__mock/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
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
  const problems = [...ERRORS, ...state.warnings];

  const pane = (m: M, i: number, f: Frame, side: "current" | "proposed") =>
    f.phone ? <PhonePane spec={`${m.id}/${i + 1}/${side}`} /> : <RefBase.Provider value={`${m.id}/${i + 1}/${side}`}><div className="mk-canvas">{side === "current" ? f.current : f.proposed}</div></RefBase.Provider>;

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
        {shown.length === 0 ? <p className="mk-empty">{q.trim() ? "No match." : "Nothing open. All mocks are decided."}</p> : null}
        {shown.map(({ m, frames }) => (
          <section key={m.id} className="mk-change">
            <header className={`mk-ch mk-st-${statusOf(m)}`}>
              <div>
                <h1>{m.title} <RefLink to={m.id} className="mk-ref">#{m.id}</RefLink></h1>
                <div className="mk-meta">{m.id.slice(0, 10)} - {m.category}{m.change ? <> - <code>{m.change}</code></> : null} - {m.frames.length} frames - <span className={`mk-pill mk-${statusOf(m)}`}><span className="d" />{statusOf(m)}</span>{decOf(m) ? <span className="mk-by"> by {decOf(m)!.by}</span> : null}</div>
                {decOf(m)?.note ? <p className="mk-note">{decOf(m)!.note}</p> : null}
              </div>
            </header>
            {frames.map(({ f, i }) => {
              const w = f.phone ? 375 : f.width ?? 640;
              const ref = `${m.id}/${i + 1}`;
              return (
                <article key={i} id={refId(ref)} className="mk-frame">
                  <div className="mk-fh">
                    <RefLink to={ref} className="mk-fn">{i + 1}</RefLink>
                    <span className="mk-ft">{f.title}</span>
                    <RefLink to={ref} className="mk-ref">#{ref}</RefLink>
                  </div>
                  <div className="mk-pair">
                    {f.current !== undefined ? <div className="mk-pane" id={refId(`${ref}/current`)} style={{ width: w }}><RefLink to={`${ref}/current`} className="mk-lab mk-bad">Current</RefLink>{pane(m, i, f, "current")}</div> : null}
                    <div className="mk-pane" id={refId(`${ref}/proposed`)} style={{ width: w }}><RefLink to={`${ref}/proposed`} className="mk-lab mk-ok">{f.current === undefined ? "New" : "Proposed"}</RefLink>{pane(m, i, f, "proposed")}</div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}
