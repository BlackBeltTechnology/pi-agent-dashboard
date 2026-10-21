/* Contrast + size probe for this board. Mirrors tests/e2e/helpers/computed-contrast.ts
   text rules (4.5:1, 3:1 for ≥ 24 px or ≥ 18.66 px bold; < 11 px text, < 12 px inside an
   interactive element) and ADDS the WCAG 1.4.11 non-text rule this audit is about:
   every svg icon and spinner arc must reach 3:1 against its composited backdrop.
   Colours are resolved through a 1×1 canvas so oklch()/color-mix() values compare
   correctly. API: __probeRoot(el) → string[]; __probeCol(el) → string[]. */
(() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (s) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  function bgOf(el) {
    const st = [];
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { st.push(c); if (c[3] >= 1) break; } }
    let base = rgba(getComputedStyle(document.documentElement).backgroundColor); if (base[3] < 1) base = [255, 255, 255, 1];
    for (let i = st.length - 1; i >= 0; i--) base = over(st[i], base);
    return base;
  }
  const label = (el) => (el.closest("[aria-label]")?.getAttribute("aria-label") && el.textContent.trim() === "" ? "" : "") + (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 32);
  function probeRoot(root) {
    const out = [];
    const seen = new Set();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (seen.has(el)) continue; seen.add(el);
      const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (el.closest(".rh,.tag,.ratios")) continue;
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 600;
      const bg = bgOf(el), fg = over(rgba(cs.color), bg), r = ratio(fg, bg);
      const large = size >= 24 || (size >= 18.66 && bold);
      const t = n.textContent.trim().slice(0, 32);
      if (r < (large ? 3 : 4.5)) out.push(`text ${r.toFixed(2)}:1 "${t}"`);
      const inter = el.closest("button,a,label,select,input,summary");
      if (size < (inter ? 12 : 11)) out.push(`size ${size}px${inter ? " (control)" : ""} "${t}"`);
    }
    for (const svg of root.querySelectorAll("svg")) {
      if (svg.closest(".rh,.tag,.ratios,.hd .chev,.hd .path,.hd .tool,.git")) continue;
      const bg = bgOf(svg), fg = over(rgba(getComputedStyle(svg).color), bg), r = ratio(fg, bg);
      if (r < 3) out.push(`icon ${r.toFixed(2)}:1 ${(svg.parentElement.closest("[class]")?.getAttribute("class") || "svg").split(" ")[0]} "${label(svg.parentElement)}"`);
    }
    for (const sp of root.querySelectorAll(".ab-spin,.spin,.spin2")) {
      const bg = bgOf(sp), fg = over(rgba(getComputedStyle(sp).borderTopColor), bg), r = ratio(fg, bg);
      if (r < 3) out.push(`spinner ${r.toFixed(2)}:1`);
    }
    return out;
  }
  window.__probeRoot = probeRoot;
})();
