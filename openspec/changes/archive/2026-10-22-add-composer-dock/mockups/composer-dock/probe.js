/* Board probe. Mirrors tests/e2e/helpers/computed-contrast.ts rules (copied from the
   improve-canvas-html-and-url-ux kit): text contrast < 4.5:1 (3:1 for >= 18.66 px bold
   / 24 px), text < 11 px (< 12 px inside an interactive element), plus a hit-target
   check: an enabled interactive element under 24x24 px. Disabled and aria-hidden
   content is exempt (WCAG 1.4.3). Scans PROPOSED frames only. */
(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  }
  function probeRoot(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (seen.has(el)) continue; seen.add(el);
      if (el.closest(".sr-only,[aria-hidden=true]")) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 600;
      const fg = parse(cs.color); if (!fg) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      const disabled = el.closest(":disabled,[disabled]");
      const bg = bgOf(el); const f = blend({ ...fg, a: fg.a * op }, bg);
      const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = size >= 24 || (size >= 18.66 && bold);
      const txt = n.textContent.trim().slice(0, 40);
      if (!disabled && ratio < (large ? 3 : 4.5)) out.push(`contrast ${ratio.toFixed(2)} "${txt}"`);
      const interactive = el.closest("button,a,label,select,input,summary,[role=meter]");
      if (size < (interactive ? 12 : 11)) out.push(`size ${size}px "${txt}"`);
    }
    for (const el of root.querySelectorAll("button:not(:disabled),a,[tabindex='0']")) {
      if (el.closest(".sr-only")) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
      if (r.width < 24 || r.height < 24) out.push(`target ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 30)}"`);
    }
    return out;
  }
  window.__probeRoot = probeRoot;
  window.__probeAll = () => {
    const res = {};
    for (const s of SCENARIOS) {
      renderScenario(s.id);
      res[s.id] = [...document.querySelectorAll(".frame.prop")].flatMap(probeRoot);
    }
    return res;
  };
})();
