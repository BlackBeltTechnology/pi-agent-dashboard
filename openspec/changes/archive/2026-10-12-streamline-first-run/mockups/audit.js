// Mockup-only WCAG 1.4.3 contrast sweep, loaded when ?audit=1.
// Iterates every scenario x theme x view; writes the summary to document.title.
function contrastFailures() {
const parse = (c) => { let m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p[3]??1]; }
  m = c.match(/color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0]*255,p[1]*255,p[2]*255,p[3]??1]; } return null; };
const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
const blend = (top, bot) => { const a = top[3]; return [top[0]*a+bot[0]*(1-a), top[1]*a+bot[1]*(1-a), top[2]*a+bot[2]*(1-a), 1]; };
const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
  let col = [255,255,255,1]; for (let i = stack.length-1; i >= 0; i--) col = blend(stack[i], col); return col; };
const out = [];
document.querySelectorAll('#main *').forEach((el) => {
  if (el.closest('[hidden]') || el.closest('svg')) return;
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) return;
  const cs = getComputedStyle(el); if (el.disabled || el.closest(':disabled')) return;
  const fg = parse(cs.color); const bg = bgOf(el); const f = blend(fg, bg);
  const L1 = lum(f), L2 = lum(bg); const r = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
  const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
  if (r < (large ? 3 : 4.5)) out.push(`${r.toFixed(2)} ${el.tagName}.${el.className} "${el.textContent.trim().slice(0,40)}"`);
});
return out;
}
(function () {
  const res = [];
  const views = ["landing", "provider"];
  const themesL = [["dark", null], ["light", null], ["dark", "nord"]];
  for (const [theme, pal] of themesL) {
    document.documentElement.dataset.theme = theme;
    if (pal) document.documentElement.dataset.palette = pal; else delete document.documentElement.dataset.palette;
    for (const [id, sc] of Object.entries(SCENARIOS)) {
      for (const v of views) {
        if (v === "provider" && id !== "s1") continue;
        state = { name: "my-first-project", ...sc }; render(); document.querySelectorAll("details").forEach((d) => { d.open = true; });
        document.getElementById("view-landing").hidden = v !== "landing";
        document.getElementById("view-provider").hidden = v !== "provider";
        for (const f of contrastFailures()) res.push(`${pal || theme}/${id}/${v}: ${f}`);
      }
    }
  }
  document.title = res.length ? `AUDIT FAIL ${res.length}` : "AUDIT OK";
  const pre = document.createElement("pre"); pre.id = "audit-out"; pre.textContent = res.join("\n") || "OK"; document.body.appendChild(pre);
})();
