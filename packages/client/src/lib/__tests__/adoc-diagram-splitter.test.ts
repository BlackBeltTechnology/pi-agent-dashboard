import { describe, expect, it } from "vitest";
import { splitAdocDiagramSegments } from "../preview/adoc-diagram-splitter.js";

describe("splitAdocDiagramSegments", () => {
  it("E11: segment splitter classification: mixed HTML with mermaid, plantuml, @startuml, bare, prose", () => {
    const html = `
<div class="paragraph">
<p>Some prose before.</p>
</div>
<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-mermaid" data-lang="mermaid">graph TD;
  A--&gt;B;</code></pre>
</div>
</div>
<div class="listingblock">
<div class="content">
<pre class="highlight"><code class="language-plantuml" data-lang="plantuml">@startuml
Bob -&gt; Alice : hello
@enduml</code></pre>
</div>
</div>
<div class="listingblock">
<div class="content">
<pre>@startuml
Alice -&gt; Bob : reply
@enduml</pre>
</div>
</div>
<div class="listingblock">
<div class="content">
<pre>just some bare listing</pre>
</div>
</div>
<div class="paragraph">
<p>End prose.</p>
</div>
`;

    const segments = splitAdocDiagramSegments(html);
    const diagrams = segments.filter((s) => s.kind === "diagram");
    expect(diagrams).toHaveLength(3);

    // 1. mermaid
    expect(diagrams[0]).toMatchObject({
      kind: "diagram",
      type: "mermaid",
      source: "graph TD;\n  A-->B;",
    });

    // 2. plantuml via [source,plantuml]
    expect(diagrams[1]).toMatchObject({
      kind: "diagram",
      type: "plantuml",
      source: "@startuml\nBob -> Alice : hello\n@enduml",
    });

    // 3. plantuml via @startuml sentinel in bare listing
    expect(diagrams[2]).toMatchObject({
      kind: "diagram",
      type: "plantuml",
      source: "@startuml\nAlice -> Bob : reply\n@enduml",
    });

    // Bare listing block stays raw
    const bareSeg = segments.find(
      (s) => s.kind === "raw" && s.html.includes("just some bare listing"),
    );
    expect(bareSeg).toBeDefined();

    // Prose stays raw
    const proseSeg = segments.find(
      (s) => s.kind === "raw" && s.html.includes("Some prose before."),
    );
    expect(proseSeg).toBeDefined();
  });

  it("E12: bare style block yields zero diagram segments", () => {
    // Asciidoctor drops bare [mermaid] style name in secure mode, emitting plain pre
    const html = `
<div class="listingblock">
<div class="content">
<pre>graph LR;
  C--&gt;D;</pre>
</div>
</div>
`;
    const segments = splitAdocDiagramSegments(html);
    const diagrams = segments.filter((s) => s.kind === "diagram");
    expect(diagrams).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("raw");
  });

  it("E13: class-attribute fallback detection without data-lang", () => {
    const html = `
<div class="listingblock">
<div class="content">
<pre><code class="language-plantuml">class Foo</code></pre>
</div>
</div>
`;
    const segments = splitAdocDiagramSegments(html);
    const diagrams = segments.filter((s) => s.kind === "diagram");
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]).toMatchObject({
      kind: "diagram",
      type: "plantuml",
      source: "class Foo",
    });
  });
});
