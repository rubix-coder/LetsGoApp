// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderInline, renderMd, wikilinks, wordCount } from "./md";

describe("markdown renderer", () => {
  it("renders the note shapes from the design: headings, lists, code, quote", () => {
    const html = renderMd("# Graphs note\n\n## Traversals\n- **BFS** — queue\n\n1. Dijkstra `O(E log V)`\n\n> Redo topo-sort.");
    expect(html).toContain("<h1>Graphs note</h1>");
    expect(html).toContain("<h2>Traversals</h2>");
    expect(html).toContain("<li><strong>BFS</strong> — queue</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<code>O(E log V)</code>");
    expect(html).toContain("<blockquote>Redo topo-sort.</blockquote>");
  });

  it("turns [[wikilinks]] into clickable spans and lists them", () => {
    const src = "Prep for [[DSA practice — graphs]].";
    expect(renderMd(src)).toContain('data-link="DSA practice — graphs"');
    expect(wikilinks(src)).toEqual(["DSA practice — graphs"]);
  });

  it("escapes raw HTML so notes cannot inject markup", () => {
    const html = renderMd("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("counts words", () => {
    expect(wordCount("one two  three\nfour")).toBe(4);
    expect(wordCount("   ")).toBe(0);
  });

  it("renders underscore emphasis, images and bare-url autolinks", () => {
    expect(renderInline("_soft_ and __hard__")).toBe("<em>soft</em> and <strong>hard</strong>");
    expect(renderInline("![diagram](d.png)")).toContain('<img alt="diagram" src="d.png"');
    expect(renderInline("see https://x.com now")).toContain('<a href="https://x.com" target="_blank" rel="noopener">https://x.com</a>');
    // A markdown link's URL must not be autolinked a second time.
    const link = renderInline("[home](https://x.com)");
    expect(link).toBe('<a href="https://x.com" target="_blank" rel="noopener">home</a>');
  });

  it("nests indented lists and renders task checkboxes", () => {
    const html = renderMd("- a\n  - b\n- c");
    expect(html).toContain("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
    const todos = renderMd("- [ ] open\n- [x] done");
    expect(todos).toContain('<li class="md-task"><span class="md-check" aria-hidden="true"></span>open</li>');
    expect(todos).toContain('md-check md-check-done');
  });

  it("renders fenced code, rules, deep headings and merged blockquotes", () => {
    expect(renderMd("```js\nconst x=1;\n```")).toContain('<pre class="md-code"><code>const x=1;</code></pre>');
    expect(renderMd("above\n\n---\n\nbelow")).toContain('<hr class="md-hr" />');
    expect(renderMd("#### Small")).toContain("<h4>Small</h4>");
    expect(renderMd("> one\n> two")).toContain("<blockquote>one<br>two</blockquote>");
  });
});

describe("task metadata rendering", () => {
  it("renders the field tail dimmed, after the title", () => {
    const html = renderMd("- [ ] Ship it !P0 #work ~90m @id(a7x2)\n");
    expect(html).toContain("Ship it");
    expect(html).toContain('<span class="md-meta">!P0 #work ~90m @id(a7x2)</span>');
  });

  it("leaves a plain task line exactly as before", () => {
    const html = renderMd("- [ ] Just a task\n");
    expect(html).toContain("Just a task");
    expect(html).not.toContain("md-meta");
  });
});
