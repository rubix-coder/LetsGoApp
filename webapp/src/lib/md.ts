/* Tiny markdown renderer for notes: headings, bold/italic (both * and _),
   inline code, nested lists, task checkboxes, fenced code, blockquotes,
   callouts, horizontal rules, images, autolinks and [[wikilinks]]. Escapes
   HTML first; output is safe to inject. */

import { splitMetaTail } from "./taskMeta";
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape first, then mark up — patterns run on already-escaped content.
    Order matters: images before links, links before autolinks and wikilinks,
    bold before italic. Exported so the block editor can render a single block's
    inline text without re-parsing. */
export function renderInline(s: string): string {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" loading="lazy" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[\[([^\]]+)\]\]/g, '<a class="wikilink" data-link="$1">$1</a>')
    // Bare URL → link, but only when it starts a token (never inside an href=" ").
    .replace(/(^|\s)(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

interface ListLine {
  indent: number;
  ordered: boolean;
  task?: "open" | "done";
  content: string;
}

/** A single list line ("  - [x] done") → its shape, or null if not a list. */
function parseListLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!m) return null;
  const indent = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
  const ordered = /\d/.test(m[2]);
  const rest = m[3];
  const task = /^\[ \]\s+/.test(rest) ? "open" : /^\[[xX]\]\s+/.test(rest) ? "done" : undefined;
  const content = task ? rest.replace(/^\[[ xX]\]\s+/, "") : rest;
  return { indent, ordered, task, content };
}

/** Render a run of list lines to nested <ul>/<ol>, indentation deciding depth.
    A deeper item nests inside the previous item's still-open <li>. */
function renderListGroup(items: ListLine[]): string {
  const parts: string[] = [];
  const openLists: boolean[] = []; // ordered? per open list; depth = length - 1
  let liOpen = false;
  const closeLi = () => { if (liOpen) { parts.push("</li>"); liOpen = false; } };

  for (const it of items) {
    const target = it.indent;
    while (openLists.length - 1 > target) {
      closeLi();
      parts.push(openLists.pop() ? "</ol>" : "</ul>");
      parts.push("</li>");
      liOpen = false;
    }
    if (openLists.length - 1 === target) {
      closeLi();
      if (openLists[target] !== it.ordered) {
        parts.push(openLists.pop() ? "</ol>" : "</ul>");
        parts.push(it.ordered ? "<ol>" : "<ul>");
        openLists.push(it.ordered);
      }
    } else {
      while (openLists.length - 1 < target) {
        parts.push(it.ordered ? "<ol>" : "<ul>");
        openLists.push(it.ordered);
        if (openLists.length - 1 < target) { parts.push("<li>"); liOpen = true; }
      }
    }
    if (it.task) {
      // Field tokens render dimmed after the title, so a rendered note stays
      // readable once its task lines carry metadata.
      const { text, tail } = splitMetaTail(it.content);
      const body = renderInline(text) + (tail ? `<span class="md-meta">${esc(tail)}</span>` : "");
      parts.push(`<li class="md-task"><span class="md-check${it.task === "done" ? " md-check-done" : ""}" aria-hidden="true">${it.task === "done" ? "✓" : ""}</span>${body}`);
    } else {
      parts.push(`<li>${renderInline(it.content)}`);
    }
    liOpen = true;
  }
  while (openLists.length) {
    closeLi();
    parts.push(openLists.pop() ? "</ol>" : "</ul>");
    if (openLists.length) { parts.push("</li>"); liOpen = false; }
  }
  return parts.join("");
}

/** A callout line: `[!kind] text` (already stripped of its leading `>`). */
const CALLOUT_INLINE = /^\[!(\w+)\]\s?(.*)$/;

export function renderMd(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { out.push(`<p>${para.map(renderInline).join("<br>")}</p>`); para = []; }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // consume the closing fence
      out.push(`<pre class="md-code"><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); out.push('<hr class="md-hr" />'); i++; continue; }

    if (parseListLine(line)) {
      flushPara();
      const group: ListLine[] = [];
      let ll: ListLine | null;
      while (i < lines.length && (ll = parseListLine(lines[i]))) { group.push(ll); i++; }
      out.push(renderListGroup(group));
      continue;
    }

    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      const qlines: string[] = [];
      let callout: string | null = null;
      while (i < lines.length) {
        const qm = /^>\s?(.*)$/.exec(lines[i]);
        if (!qm) break;
        const c = qlines.length === 0 ? CALLOUT_INLINE.exec(qm[1]) : null;
        if (c) { callout = c[1].toLowerCase(); qlines.push(c[2]); }
        else qlines.push(qm[1]);
        i++;
      }
      const inner = qlines.map(renderInline).join("<br>");
      out.push(callout ? `<div class="callout callout-${callout}">${inner}</div>` : `<blockquote>${inner}</blockquote>`);
      continue;
    }

    if (line.trim() === "") { flushPara(); i++; continue; }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

export function wordCount(src: string): number {
  const words = src.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Titles referenced as [[...]] inside a text. */
export function wikilinks(src: string): string[] {
  return [...src.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}
