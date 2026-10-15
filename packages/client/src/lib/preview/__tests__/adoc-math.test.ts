import katex from "katex";
import { describe, expect, it } from "vitest";
import { hasAdocMath, renderAdocMath } from "../adoc-math.js";

describe("renderAdocMath", () => {
  it("renders inline \\(...\\) latexmath with KaTeX", () => {
    const out = renderAdocMath("<p>Given \\(n \\cdot \\lambda\\) events</p>", katex);
    expect(out).toContain('class="katex"');
    expect(out).not.toContain("\\(");
    expect(out).toContain("<p>Given ");
  });

  it("renders a \\[...\\] stem block in display mode", () => {
    const out = renderAdocMath('<div class="stemblock"><div class="content">\\[C = n \\cdot c\\]</div></div>', katex);
    expect(out).toContain("katex-display");
  });

  it("decodes HTML entities before handing TeX to KaTeX", () => {
    const out = renderAdocMath("<p>\\(a &lt; b\\)</p>", katex);
    expect(out).toContain('class="katex"');
    expect(out).not.toContain("&amp;lt;");
  });

  it("leaves math-like text inside <pre>/<code> untouched", () => {
    const html = '<pre class="highlight"><code>re = /\\(x\\)/</code></pre><p>ok</p>';
    expect(renderAdocMath(html, katex)).toBe(html);
  });

  it("does not throw on invalid TeX", () => {
    expect(() => renderAdocMath("<p>\\(\\frac{\\)</p>", katex)).not.toThrow();
  });

  it("hasAdocMath detects delimiters", () => {
    expect(hasAdocMath("<p>\\(x\\)</p>")).toBe(true);
    expect(hasAdocMath("<p>plain</p>")).toBe(false);
  });

  // See change: sanitize-untrusted-rendered-content (test-plan E17).
  it("#E17 rewrites math only in text nodes outside pre/code — never attributes", () => {
    const html =
      '<a title="see \\(x\\)">l</a><pre><code>\\(y\\)</code></pre><p>\\(z\\) and \\(a <em>b</em>\\)</p>';
    const out = renderAdocMath(html, katex);
    const tpl = document.createElement("template");
    tpl.innerHTML = out;
    expect(tpl.content.querySelector("a")?.getAttribute("title")).toBe("see \\(x\\)");
    expect(tpl.content.querySelector("pre code")?.textContent).toBe("\\(y\\)");
    expect(tpl.content.querySelectorAll(".katex").length).toBe(1);
    expect(tpl.content.querySelector("p")?.textContent).toContain("\\(a b\\)");
    expect(new DOMParser().parseFromString(out, "text/html").querySelector("parsererror")).toBeNull();
  });
});
