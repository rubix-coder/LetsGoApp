/* Derives interactive graphs from the app's own data for the Mindmap plugin's
   "from notes" mode. Four lenses share one node/edge model so a single canvas
   renders them all:
     - notes:   folder → note → subpage hierarchy + [[wikilink]] cross-edges,
                with per-node insights (open-task rollup, completion, recency).
     - tasks:   root task → subtask tree, status-coloured, completion rings.
     - web:     the wikilink web alone, hubs pulled to the centre (rings by degree).
     - outline: one note's headings/bullets as a radial mind map.
   All layout is deterministic (no physics) so it is unit-testable. */

import { STATUS_VAR, type Note, type NoteFolder, type Task, type TaskStatus } from "./types";
import { wikilinks } from "./md";
import { parseBlocks } from "./noteBlocks";

const COL_W = 210;
const ROW_H = 70;
const PAD = 34;
export const NODE_W = 168;
export const NODE_H = 48;

/** Layout density: 1 = cozy (original spacing), <1 = compact. Floors keep
    nodes from overlapping no matter how small the factor — measured against
    the WIDEST rendered card ("lg" folder/root nodes reach ~188×54px, more
    than the NODE_W×NODE_H the layout math nominally assumes). */
export type Density = number;
const MAX_NODE_W = 188;
const MAX_NODE_H = 54;
const colW = (d: Density) => Math.max(MAX_NODE_W + 14, Math.round(COL_W * d));
const rowH = (d: Density) => Math.max(MAX_NODE_H + 8, Math.round(ROW_H * d));
const DAY = 86_400_000;

export type NodeKind = "folder" | "note" | "task" | "topic";
export type NodeFlag = "orphan" | "hub" | "stale" | "due";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Border / icon accent. */
  accent: string;
  /** Small count chip (open tasks, links…). */
  badge?: number;
  /** 0–1 completion fraction → a small ring. */
  ring?: number;
  /** 0–1 recency → node brightness (1 = just touched). */
  heat?: number;
  size: "sm" | "md" | "lg";
  flags: NodeFlag[];
  /** One-line subtitle under the label. */
  meta?: string;
  noteId?: string;
  taskId?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "child" | "link";
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  stats: { label: string; value: number }[];
}

function finalize(nodes: GraphNode[], edges: GraphEdge[], stats: Graph["stats"]): Graph {
  // Normalize: radial layouts place nodes around a fixed centre, which can
  // push coordinates negative (or leave a big dead margin) — shift so the
  // top-left node sits at PAD and the fit/zoom controls frame it correctly.
  if (nodes.length) {
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    for (const n of nodes) { n.x += PAD - minX; n.y += PAD - minY; }
  }
  const width = Math.max(MAX_NODE_W + PAD * 2, ...nodes.map((n) => n.x + MAX_NODE_W + PAD));
  const height = Math.max(MAX_NODE_H + PAD * 2, ...nodes.map((n) => n.y + MAX_NODE_H + PAD));
  return { nodes, edges, width, height, stats };
}

/* ————— notes lens ————— */

export function buildNotesGraph(
  folders: readonly NoteFolder[],
  notes: readonly Note[],
  tasks: readonly Task[],
  now = Date.now(),
  density: Density = 1,
): Graph {
  const CW = colW(density), RH = rowH(density);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const childrenOf = (folderId: string, parentId: string | undefined) =>
    notes.filter((n) => n.folderId === folderId && (n.parentId ?? undefined) === (parentId ?? undefined));

  const linkedTasks = (title: string) => tasks.filter((t) => (t.description ?? "").includes(`[[${title}]]`));
  const openCount = (title: string) => linkedTasks(title).filter((t) => t.status !== "done" && t.status !== "skipped").length;

  const noteByTitle = new Map(notes.map((n) => [n.title, n]));
  const outLinks = (n: Note) => [...new Set(wikilinks(n.body))].filter((t) => { const tn = noteByTitle.get(t); return tn && tn.id !== n.id; });
  const inDeg = new Map<string, number>();
  for (const n of notes) for (const t of outLinks(n)) inDeg.set(noteByTitle.get(t)!.id, (inDeg.get(noteByTitle.get(t)!.id) ?? 0) + 1);
  const degreeOf = (n: Note) => outLinks(n).length + (inDeg.get(n.id) ?? 0);
  const maxUpdated = Math.max(1, ...notes.map((n) => n.updatedAt ?? 0));

  let orphans = 0;
  let row = 0;
  function place(n: Note, depth: number): { row: number; open: number } {
    const own = openCount(n.title);
    const kids = childrenOf(n.folderId, n.id);
    let r: number;
    let subOpen = own;
    if (kids.length === 0) { r = row++; }
    else {
      const rs = kids.map((k) => place(k, depth + 1));
      r = (rs[0].row + rs[rs.length - 1].row) / 2;
      subOpen += rs.reduce((a, b) => a + b.open, 0);
    }
    const linked = linkedTasks(n.title);
    const doneLinked = linked.filter((t) => t.status === "done").length;
    const deg = degreeOf(n);
    const flags: NodeFlag[] = [];
    if (deg === 0 && kids.length === 0 && !n.parentId) { flags.push("orphan"); orphans++; }
    if (deg >= 4) flags.push("hub");
    if (now - (n.updatedAt ?? 0) > 30 * DAY) flags.push("stale");
    if (linked.some((t) => t.deadline && t.status !== "done" && t.deadline - now < 3 * DAY)) flags.push("due");
    nodes.push({
      id: `note:${n.id}`, label: n.title || "Untitled", kind: "note", noteId: n.id,
      x: PAD + depth * CW, y: PAD + r * RH,
      accent: kids.length ? "var(--accent-mid)" : "var(--st-done)",
      badge: subOpen || undefined,
      ring: linked.length ? doneLinked / linked.length : undefined,
      heat: (n.updatedAt ?? 0) / maxUpdated,
      size: deg >= 4 ? "lg" : kids.length ? "md" : "sm",
      flags,
      meta: [deg ? `${deg} link${deg > 1 ? "s" : ""}` : "", linked.length ? `${linked.length} task${linked.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || undefined,
    });
    for (const k of kids) edges.push({ id: `c:${n.id}:${k.id}`, from: `note:${n.id}`, to: `note:${k.id}`, kind: "child" });
    return { row: r, open: subOpen };
  }

  for (const f of folders) {
    const roots = childrenOf(f.id, undefined);
    if (roots.length === 0) continue;
    const rs = roots.map((rn) => place(rn, 1));
    const fr = (rs[0].row + rs[rs.length - 1].row) / 2;
    nodes.push({
      id: `folder:${f.id}`, label: f.name, kind: "folder",
      x: PAD, y: PAD + fr * RH, accent: "var(--color-accent)",
      badge: rs.reduce((a, b) => a + b.open, 0) || undefined, size: "lg", flags: [],
    });
    for (const rn of roots) edges.push({ id: `c:${f.id}:${rn.id}`, from: `folder:${f.id}`, to: `note:${rn.id}`, kind: "child" });
    row += 1;
  }

  let links = 0;
  for (const n of notes) for (const t of outLinks(n)) {
    edges.push({ id: `l:${n.id}:${noteByTitle.get(t)!.id}`, from: `note:${n.id}`, to: `note:${noteByTitle.get(t)!.id}`, kind: "link" });
    links++;
  }
  const openTotal = notes.reduce((a, n) => a + openCount(n.title), 0);
  return finalize(nodes, edges, [
    { label: "notes", value: notes.length },
    { label: "links", value: links },
    { label: "open tasks", value: openTotal },
    { label: "orphans", value: orphans },
  ]);
}

/* ————— tasks lens ————— */

export function buildTaskGraph(tasks: readonly Task[], now = Date.now(), density: Density = 1): Graph {
  const CW = colW(density), RH = rowH(density);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const childrenOf = (id: string | undefined) => tasks.filter((t) => (t.parentId ?? undefined) === (id ?? undefined));
  const accentFor = (s: TaskStatus) => STATUS_VAR[s];

  // Root subtrees flow into column BANDS instead of one endless strip — a
  // long task list used to force fit-zoom down to ~30% to see anything;
  // wrapping keeps the canvas near the viewport's aspect so it reads at
  // (or near) 100%.
  let row = 0;
  let xOffset = 0;
  let bandMaxDepth = 0;
  const bandRows = Math.max(6, Math.ceil(Math.sqrt(tasks.length) * 1.7));
  function place(t: Task, depth: number): number {
    bandMaxDepth = Math.max(bandMaxDepth, depth);
    const kids = childrenOf(t.id);
    let r: number;
    if (kids.length === 0) r = row++;
    else { const rs = kids.map((k) => place(k, depth + 1)); r = (rs[0] + rs[rs.length - 1]) / 2; }
    const doneKids = kids.filter((k) => k.status === "done").length;
    const flags: NodeFlag[] = [];
    if (t.deadline && t.status !== "done" && t.deadline - now < 3 * DAY) flags.push("due");
    nodes.push({
      id: `task:${t.id}`, label: t.title || "Untitled", kind: "task", taskId: t.id,
      x: PAD + xOffset + depth * CW, y: PAD + r * RH, accent: accentFor(t.status),
      ring: kids.length ? doneKids / kids.length : t.status === "done" ? 1 : undefined,
      badge: kids.length || undefined, size: kids.length ? "md" : "sm", flags,
      meta: t.estimateMin ? `~${t.estimateMin}m` : undefined,
    });
    for (const k of kids) edges.push({ id: `c:${t.id}:${k.id}`, from: `task:${t.id}`, to: `task:${k.id}`, kind: "child" });
    return r;
  }
  for (const rootTask of childrenOf(undefined)) {
    place(rootTask, 0);
    row += 1;
    if (row >= bandRows) { xOffset += (bandMaxDepth + 1) * CW + 32; row = 0; bandMaxDepth = 0; }
  }

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  const done = tasks.filter((t) => t.status === "done").length;
  return finalize(nodes, edges, [
    { label: "tasks", value: tasks.length },
    { label: "open", value: open },
    { label: "done", value: done },
  ]);
}

/* ————— web lens: wikilink graph, hubs centred, rings by degree ————— */

export function buildWebGraph(notes: readonly Note[], density: Density = 1): Graph {
  const noteByTitle = new Map(notes.map((n) => [n.title, n]));
  const links = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b); };
  for (const n of notes) for (const t of new Set(wikilinks(n.body))) {
    const tn = noteByTitle.get(t);
    if (tn && tn.id !== n.id) { add(n.id, tn.id); add(tn.id, n.id); }
  }
  // Only notes that participate in the web (degree > 0); isolated notes clutter it.
  const connected = notes.filter((n) => (links.get(n.id)?.size ?? 0) > 0);
  const maxUpdated = Math.max(1, ...notes.map((n) => n.updatedAt ?? 0));
  const byDegDesc = [...connected].sort((a, b) => (links.get(b.id)!.size) - (links.get(a.id)!.size));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  // Concentric rings: the top hub in the centre, the rest spread on rings whose
  // size grows outward. Deterministic angular placement keeps it stable.
  const cx = 520, cy = 380;
  byDegDesc.forEach((n, i) => {
    const ring = i === 0 ? 0 : Math.ceil(Math.sqrt(i));
    const radius = ring * Math.max(140, Math.round(165 * density));
    const perRing = Math.max(1, ring * 6);
    const idxInRing = i === 0 ? 0 : i - (ring - 1) * (ring - 1);
    const angle = (idxInRing / perRing) * Math.PI * 2;
    const deg = links.get(n.id)!.size;
    nodes.push({
      id: `note:${n.id}`, label: n.title || "Untitled", kind: "note", noteId: n.id,
      x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius,
      accent: "var(--accent-mid)", badge: deg || undefined,
      heat: (n.updatedAt ?? 0) / maxUpdated, size: deg >= 4 ? "lg" : deg >= 2 ? "md" : "sm",
      flags: deg >= 4 ? ["hub"] : [], meta: `${deg} link${deg > 1 ? "s" : ""}`,
    });
    seen.add(n.id);
  });
  for (const n of connected) for (const other of links.get(n.id)!) {
    if (n.id < other && seen.has(other)) edges.push({ id: `l:${n.id}:${other}`, from: `note:${n.id}`, to: `note:${other}`, kind: "link" });
  }
  return finalize(nodes, edges, [
    { label: "linked notes", value: connected.length },
    { label: "connections", value: edges.length },
    { label: "isolated", value: notes.length - connected.length },
  ]);
}

/* ————— outline lens: one note's headings/bullets as a radial map ————— */

export function buildOutlineGraph(note: Note | undefined, density: Density = 1): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (!note) return finalize(nodes, edges, []);

  const blocks = parseBlocks(note.body);
  // level: title 0, h1 1, h2 2, h3 3; a list item sits under its SECTION
  // (deepest heading so far) plus its own indent — NOT under the previous
  // list item, which used to turn every flat list into a one-node-per-ring
  // chain ("- a\n- b\n- c" rendered as a→b→c instead of three siblings).
  interface Item { id: string; label: string; level: number; parent: string; }
  const items: Item[] = [];
  const stack: { id: string; level: number }[] = [{ id: `topic:${note.id}`, level: 0 }];
  let seq = 0;
  let sectionLevel = 0; // deepest heading seen so far (title = 0)
  const headingLevel = (t: string) => ({ h1: 1, h2: 2, h3: 3 } as Record<string, number>)[t];
  blocks.forEach((b) => {
    const hl = headingLevel(b.type);
    let level: number | undefined;
    let label = b.text;
    if (hl) { level = hl; sectionLevel = hl; }
    else if (b.type === "ul" || b.type === "ol" || b.type === "todo" || b.type === "todo-done") level = sectionLevel + 1 + (b.indent ?? 0);
    if (level === undefined || !label.trim()) return;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    // An H1 that just repeats the note's title (the usual "# Title" first
    // line) would render as a twin card next to the root — merge it into the
    // root instead, so its children hang directly off the title node.
    if (hl === 1 && label.trim().toLowerCase() === (note.title || "").trim().toLowerCase()) {
      stack.push({ id: `topic:${note.id}`, level });
      return;
    }
    const parent = stack[stack.length - 1].id;
    const id = `topic:${note.id}:${seq++}`;
    items.push({ id, label, level, parent });
    stack.push({ id, level });
  });

  // Sector radial tree: the root sits centre; every subtree owns an angular
  // sector proportional to its leaf count, so children render NEXT TO their
  // parent (short edges, no criss-cross). Rings exist only for levels that
  // actually have items (an unused level would push everything outward), and
  // each ring's radius grows until its tightest angular gap clears a node
  // width — no overlap by construction, compact when the outline is small.
  const cx = 520, cy = 360;
  const rootId = `topic:${note.id}`;
  nodes.push({ id: rootId, label: note.title || "Untitled", kind: "topic", x: cx, y: cy, accent: "var(--color-accent)", size: "lg", flags: [] });

  const kidsOf = (pid: string) => items.filter((it) => it.parent === pid);
  const weightMemo = new Map<string, number>();
  const weight = (id: string): number => {
    const memo = weightMemo.get(id);
    if (memo !== undefined) return memo;
    const kids = kidsOf(id);
    const w = kids.length === 0 ? 1 : kids.reduce((s, k) => s + weight(k.id), 0);
    weightMemo.set(id, w);
    return w;
  };
  const angleOf = new Map<string, number>();
  const assign = (pid: string, a0: number, a1: number) => {
    const kids = kidsOf(pid);
    const total = kids.reduce((s, k) => s + weight(k.id), 0) || 1;
    let a = a0;
    for (const k of kids) {
      const span = ((a1 - a0) * weight(k.id)) / total;
      angleOf.set(k.id, a + span / 2);
      assign(k.id, a, a + span);
      a += span;
    }
  };
  assign(rootId, -Math.PI / 2, Math.PI * 1.5);

  const levels = [...new Set(items.map((it) => it.level))].sort((a, b) => a - b);
  const ringOf = new Map(levels.map((lv, i) => [lv, i + 1]));
  const byRing = new Map<number, Item[]>();
  for (const it of items) {
    const r = ringOf.get(it.level)!;
    (byRing.get(r) ?? byRing.set(r, []).get(r)!).push(it);
  }
  // Root/heading cards render up to MAX_NODE_W wide — the first ring and the
  // tightest angular gap must clear that, not the nominal NODE_W.
  const step = Math.max(MAX_NODE_W + 14, Math.round(210 * density));
  const minGapPx = MAX_NODE_W + 26;
  byRing.forEach((ringItems, ring) => {
    const angles = ringItems.map((it) => angleOf.get(it.id)!).sort((a, b) => a - b);
    let gapMin = Math.PI * 2;
    for (let i = 1; i < angles.length; i++) gapMin = Math.min(gapMin, angles[i] - angles[i - 1]);
    if (angles.length > 1) gapMin = Math.min(gapMin, angles[0] + Math.PI * 2 - angles[angles.length - 1]);
    const needed = angles.length > 1 ? minGapPx / gapMin : 0;
    const radius = Math.max(ring * step, Math.min(needed, ring * step * 4));
    for (const it of ringItems) {
      const angle = angleOf.get(it.id)!;
      nodes.push({ id: it.id, label: it.label, kind: "topic", x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, accent: "var(--accent-mid)", size: ring <= 1 ? "md" : "sm", flags: [] });
    }
  });
  for (const it of items) {
    edges.push({ id: `c:${it.parent}:${it.id}`, from: it.parent, to: it.id, kind: "child" });
  }
  return finalize(nodes, edges, [
    { label: "topics", value: items.length },
    { label: "depth", value: Math.max(0, ...items.map((i) => i.level)) },
  ]);
}
