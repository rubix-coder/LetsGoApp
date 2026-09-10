import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { nav, useMobile, useRoute } from "../lib/router";
import { MobileHeader } from "../shell/AppShell";
import { BookCard } from "./library/BookCard";
import { BookEditor } from "./library/BookEditor";
import { ImportCsv } from "./library/ImportCsv";
import { ScanMode } from "./library/ScanMode";
import { WishlistAdd } from "./library/WishlistAdd";
import { autoResolveBook, resolveSummary } from "../lib/bookLookup";
import { webRescueBook } from "../lib/bookWebRescue";
import { httpBookGateway } from "../lib/bookApi";
import { hasClaudeKey, httpWebRescueGateway } from "../lib/claudeApi";
import { clearBookApiIssue, recordResolveReport, setBookApiIssue } from "../lib/bookApiHealth";
import {
  bookFacets, BOOK_GROUPS, EMPTY_QUERY, filterBooks, groupBooks, unresolvedBooks,
  type BookGroup, type BookQuery, type BookSort,
} from "../lib/bookFilter";
import { duplicateCount } from "../lib/books";
import { ExportMenu } from "./library/ExportMenu";
import { BOOK_STATUS_LABEL, type Book, type BookStatus } from "../lib/types";
import { readStickyView, useStickyView, writeStickyView } from "../lib/viewMemory";
import { BookList } from "./library/BookList";
import { Seg } from "../components/ui";
import { IBook, IScan, IUpload, IX } from "../components/Icons";

const STATUS_TABS: { id: BookStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  // Second, not last: the wishlist is the tab you open standing in a shop,
  // which is the most time-critical thing this screen does.
  { id: "wishlist", label: "Wishlist" },
  { id: "unread", label: "Unread" },
  { id: "reading", label: "Reading" },
  { id: "read", label: "Read" },
  { id: "dnf", label: "DNF" },
];

const LAYOUT_KEY = "lg:libraryLayout";
const GROUP_KEY = "lg:libraryGroup";
const STATUS_KEY = "lg:libraryStatus";
const LAYOUTS = ["covers", "list"] as const;
const GROUP_IDS = BOOK_GROUPS.map((g) => g.id);

const STATUS_IDS = STATUS_TABS.map((t) => t.id);

/** The status tab is a display preference like layout and grouping, so it
    sticks per-device rather than resetting to "All" every visit. It rides in
    the query object rather than its own state, so it reads through
    lib/viewMemory by hand instead of via the hook. */
function storedStatus(): BookStatus | "all" {
  return readStickyView(STATUS_KEY, STATUS_IDS, "all") as BookStatus | "all";
}

const SORTS: { id: BookSort; label: string }[] = [
  { id: "added", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "rating", label: "Rating" },
  { id: "finished", label: "Recently finished" },
  { id: "year", label: "Year published" },
];

export function LibraryScreen() {
  const { state, dispatch } = useStore();
  const mobile = useMobile();
  const route = useRoute();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<BookQuery>(() => ({ ...EMPTY_QUERY, status: storedStatus() }));
  // Held here rather than in App's EditorProvider: a task is reachable from
  // six surfaces, a book only from this screen.
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [wishlisting, setWishlisting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveNote, setResolveNote] = useState("");

  /* A display preference, so localStorage rather than the synced vault —
     the same split the mindmap density and list column widths already use.

     The default differs by screen: a phone fits about four covers at a time,
     which is a poor way to find anything in a few hundred books, so mobile
     starts in the list. An explicit choice always wins over the default. */
  const [layout, chooseLayout] = useStickyView(LAYOUT_KEY, LAYOUTS, () => (
    window.matchMedia("(max-width: 800px)").matches ? "list" : "covers"
  ));

  // Collapsed by default: on a phone the point of the panel is that the
  // controls inside it are the ones you set once.
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Grouping is a display preference like the layout, so it lives in
     localStorage rather than the synced vault — how you like to look at the
     shelf is a property of the screen you are looking at it on. */
  const [group, chooseGroup] = useStickyView(GROUP_KEY, GROUP_IDS, "none");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Anchor for shift-click range selection.
  const lastPickedRef = useRef<string | null>(null);

  /** Heals the books a scan captured but never filled in. Sequential and
      paced: Open Library and Google both rate-limit per IP, and a burst of
      400 parallel requests would be throttled into failure.

      Strategy switching (ISBN miss → title search) happens inside
      autoResolveBook — it is the app's job, never advice printed at the
      user. Auth/quota trouble is flagged in Settings → Library where it is
      fixable; here every miss reads the same: add it manually. */
  async function resolveUnfilled() {
    setResolving(true);
    setResolveNote("");
    let filled = 0;
    let webFilled = 0;
    let notFound = 0;
    let unavailable = 0;
    const reasons: string[] = [];
    let authReason = "";
    try {
      for (const book of unresolved) {
        let outcome = await autoResolveBook(book, httpBookGateway);
        /* Last rung: both databases answered and have nothing — with a
           Claude key, let the model search the open web before giving up.
           A rescue failure is still just "not found"; only the databases'
           own trouble counts as a fetch error. */
        if (outcome.kind === "manual" && hasClaudeKey()) {
          const rescued = await webRescueBook(book, httpWebRescueGateway, httpBookGateway);
          if (rescued.kind === "filled") {
            outcome = rescued;
            webFilled++;
          } else if (rescued.kind === "unavailable") {
            if (!reasons.includes(rescued.reason)) reasons.push(rescued.reason);
            if (rescued.auth) authReason = rescued.reason;
          }
        }
        if (outcome.kind === "filled") {
          dispatch({ type: "upsertBook", book: outcome.book });
          filled++;
        } else if (outcome.kind === "manual") {
          notFound++;
        } else {
          unavailable++;
          if (!reasons.includes(outcome.reason)) reasons.push(outcome.reason);
          if (outcome.auth) authReason = outcome.reason;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (authReason) setBookApiIssue(authReason);
      else clearBookApiIssue();
      recordResolveReport({ at: Date.now(), filled, notFound, unavailable, reasons: reasons.slice(0, 5), auth: !!authReason, webFilled });
      setResolveNote(resolveSummary({ filled, notFound, unavailable }));
    } catch {
      setResolveNote("Error fetching the book — add manually!");
    } finally {
      setResolving(false);
    }
  }

  // AppShell only inspects route[0], so #/library/scan lands here and this
  // screen owns the sub-route — the same way #/todo/board/gantt works.
  const scanning = route[1] === "scan";
  /* #/library/scan/wishlist — the same scanner, filing what it reads under
     "want" instead of "own". Standing in a shop with a book in your hand is
     the moment a wishlist is most easily filled. */
  const scanIntent = route[2] === "wishlist" ? "wishlist" : "shelf";

  const patch = (next: Partial<BookQuery>) => setQuery((q) => ({ ...q, ...next }));
  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const facets = useMemo(() => bookFacets(state.books), [state.books]);
  const visible = useMemo(() => filterBooks(state.books, query), [state.books, query]);
  const unresolved = useMemo(() => unresolvedBooks(state.books), [state.books]);
  // Status has its own always-visible row, so it is not counted here — this
  // badge is about what is hidden inside the panel.
  const activeFacetCount = query.shelves.length + query.tags.length;
  const groups = useMemo(() => groupBooks(visible, group), [visible, group]);
  /* Shift-click ranges must follow what is on screen, and grouping reorders
     that — so the anchor walks the flattened group order, not `visible`. */
  const displayOrder = useMemo(() => groups.flatMap((g) => g.books.map((b) => b.id)), [groups]);
  const dupes = useMemo(() => duplicateCount(state.books), [state.books]);

  // "/" focuses search from anywhere on the screen, matching the mindmap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = (
    <span style={{
      position: "relative", display: "inline-flex", alignItems: "center",
      flex: mobile ? 1 : "none", minWidth: 0,
    }}>
      <input
        ref={searchRef}
        value={query.text}
        onChange={(e) => patch({ text: e.target.value })}
        placeholder={mobile ? "Search books…" : "Search title, author, ISBN…  ( / )"}
        aria-label="Search books"
        className="input"
        style={{ width: mobile ? "100%" : 250, height: 30, fontSize: 13, paddingRight: 22 }}
      />
      {query.text && (
        <button
          onClick={() => patch({ text: "" })}
          aria-label="Clear search"
          style={{ position: "absolute", right: 4, border: "none", background: "none", cursor: "pointer", color: "var(--color-text-3)", display: "flex" }}
        >
          <IX size={13} />
        </button>
      )}
    </span>
  );

  const statusSeg = (
    <Seg
      small
      ink
      ariaLabel="Reading status"
      items={STATUS_TABS.map((t) => ({
        id: t.id,
        label: t.id === "all" ? t.label : `${t.label} ${facets.counts[t.id]}`,
      }))}
      active={query.status}
      onSelect={(id) => { patch({ status: id as BookStatus | "all" }); writeStickyView(STATUS_KEY, id); }}
    />
  );

  const sortSelect = (
    <select
      className="input"
      style={{ height: 30, fontSize: 13, maxWidth: mobile ? undefined : 180, flex: mobile ? 1 : undefined }}
      value={query.sort}
      onChange={(e) => patch({ sort: e.target.value as BookSort })}
      aria-label="Sort books"
    >
      {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );

  const groupSelect = (
    <select
      className="input"
      style={{ height: 30, fontSize: 13, maxWidth: mobile ? undefined : 170, flex: mobile ? 1 : undefined }}
      value={group}
      onChange={(e) => chooseGroup(e.target.value as BookGroup)}
      aria-label="Group books"
    >
      {BOOK_GROUPS.map((g) => (
        <option key={g.id} value={g.id}>{g.id === "none" ? g.label : `Group: ${g.label}`}</option>
      ))}
    </select>
  );

  const layoutSeg = (
    <Seg
      small
      ariaLabel="Layout"
      items={[{ id: "covers", label: "Covers" }, { id: "list", label: "List" }]}
      active={layout}
      onSelect={(id) => chooseLayout(id as "covers" | "list")}
    />
  );

  const facetChips = (
    <>
      {facets.shelves.map((shelf) => (
        <button
          key={`shelf-${shelf}`}
          className={`chip${query.shelves.includes(shelf) ? " on" : ""}`}
          onClick={() => patch({ shelves: toggleIn(query.shelves, shelf) })}
          aria-pressed={query.shelves.includes(shelf)}
        >
          {shelf}
        </button>
      ))}
      {facets.tags.map((tag) => (
        <button
          key={`tag-${tag}`}
          className={`chip${query.tags.includes(tag) ? " on" : ""}`}
          onClick={() => patch({ tags: toggleIn(query.tags, tag) })}
          aria-pressed={query.tags.includes(tag)}
        >
          #{tag}
        </button>
      ))}
    </>
  );

  /* On a 360px phone the desktop toolbar became one long horizontal scroll
     strip — search, status, every shelf, every tag, sort and layout in a
     single line, so most controls were off-screen with no hint they existed.

     Split by how often each control is touched: search always visible on its
     own full-width row, status always visible on a row that scrolls by itself,
     and everything set-once-and-forget (shelves, tags, sort, layout) behind a
     Filters disclosure carrying a count of what is active. */
  const mobileToolbar = (
    <div style={{ borderBottom: "1px solid var(--color-divider)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 6px" }}>
        {search}
        <button
          className={`chip${activeFacetCount > 0 ? " on" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          Filters{activeFacetCount > 0 ? ` ${activeFacetCount}` : ""}
          {/* No transition: an inline style cannot be overridden by the
              prefers-reduced-motion block, and a chevron does not need one. */}
          <span aria-hidden="true" style={{
            display: "inline-block", fontSize: 9, lineHeight: 1,
            transform: filtersOpen ? "rotate(180deg)" : undefined,
          }}>▾</span>
        </button>
      </div>

      {/* Its own scroll container, so the status pills slide without dragging
          the search field off-screen with them. */}
      <div style={{ overflowX: "auto", padding: "0 12px 8px", display: "flex" }}>
        {/* flex:none and nowrap together: without them the pills compress and
            wrap their labels onto two lines instead of the row scrolling. */}
        <span style={{ flex: "none", whiteSpace: "nowrap" }}>{statusSeg}</span>
      </div>

      {filtersOpen && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          padding: "10px 12px", borderTop: "1px solid var(--color-divider-soft)",
          background: "var(--color-surface)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {sortSelect}
            {layoutSeg}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {groupSelect}
          </div>
          {(facets.shelves.length > 0 || facets.tags.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{facetChips}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>
              <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}>{visible.length}</strong>
              {visible.length === state.books.length ? " books" : ` of ${state.books.length}`}
            </span>
            {activeFacetCount > 0 && (
              <button
                className="btn btn-ghost"
                style={{ marginLeft: "auto", padding: "3px 9px", fontSize: 12 }}
                onClick={() => patch({ shelves: [], tags: [] })}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {dupes > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", borderTop: "1px solid var(--color-divider-soft)",
        }}>
          <span style={{ fontSize: 12, color: "var(--color-text-2)", flex: 1, minWidth: 0 }}>
            {dupes} duplicate {dupes === 1 ? "record" : "records"}
          </span>
          <button className="chip" onClick={() => dispatch({ type: "dedupeBooks" })} style={{ flex: "none" }}>
            Merge
          </button>
        </div>
      )}

      {/* Books captured by a scan but never filled in. A banner rather than a
          chip in the strip: after a scanning session this is the next thing to
          do, and it was invisible off the right edge before. */}
      {unresolved.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", borderTop: "1px solid var(--color-divider-soft)",
          background: "var(--accent-wash)",
        }}>
          <span style={{ fontSize: 12, color: "var(--color-text-2)", flex: 1, minWidth: 0 }}>
            {resolveNote || `${unresolved.length} ${unresolved.length === 1 ? "book needs" : "books need"} details`}
          </span>
          <button className="chip" disabled={resolving} onClick={() => void resolveUnfilled()} style={{ flex: "none" }}>
            {resolving ? "Resolving…" : "Resolve"}
          </button>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
      borderBottom: "1px solid var(--color-divider)",
      flexWrap: "wrap",
    }}>
      {search}
      {statusSeg}
      {facetChips}
      {sortSelect}
      {groupSelect}
      {layoutSeg}

      <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        {unresolved.length > 0 && (
          <button
            className="chip"
            disabled={resolving}
            onClick={() => void resolveUnfilled()}
            title="Look these up at Open Library and fill in what is missing"
          >
            {resolving ? "Resolving…" : `Resolve ${unresolved.length}`}
          </button>
        )}
        {dupes > 0 && (
          <button
            className="chip"
            onClick={() => dispatch({ type: "dedupeBooks" })}
            title="Merge records that are the same book — same ISBN, or same title and author"
          >
            Merge {dupes} duplicate{dupes === 1 ? "" : "s"}
          </button>
        )}
        {resolveNote && <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>{resolveNote}</span>}
        <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>
          <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-heading)" }}>{visible.length}</strong>
          {visible.length === state.books.length ? " books" : ` of ${state.books.length}`}
        </span>
      </span>
    </div>
  );

  /** Plain click toggles one; shift-click extends from the last pick across
      the CURRENTLY VISIBLE order, so a range follows what the user can see
      rather than the underlying array. */
  function toggleSelected(id: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const anchor = lastPickedRef.current;
      if (shiftKey && anchor && anchor !== id) {
        const order = displayOrder;
        const from = order.indexOf(anchor);
        const to = order.indexOf(id);
        if (from !== -1 && to !== -1) {
          for (const rangeId of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(rangeId);
          lastPickedRef.current = id;
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      lastPickedRef.current = id;
      return next;
    });
  }

  const clearSelection = () => { setSelected(new Set()); lastPickedRef.current = null; };

  function bulkDelete() {
    dispatch({ type: "deleteBooks", ids: [...selected] });
    clearSelection();
  }
  /** Moving the bookmark. Setting a page on an unread book starts it, since
      that is plainly what putting a bookmark in means. */
  function setPage(book: Book, page: number | undefined) {
    dispatch({
      type: "upsertBook",
      book: {
        ...book,
        currentPage: page,
        status: page !== undefined && book.status === "unread" ? "reading" : book.status,
        startedAt: page !== undefined && book.startedAt === undefined ? Date.now() : book.startedAt,
      },
    });
  }

  function bulkPatch(patch: Partial<Book>) {
    dispatch({ type: "updateBooks", ids: [...selected], patch });
    clearSelection();
  }

  const openBook = openId ? state.books.find((b) => b.id === openId) ?? null : null;
  const editor = (
    <>
      {openBook && <BookEditor book={openBook} onClose={() => setOpenId(null)} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} />}
      {wishlisting && <WishlistAdd onClose={() => setWishlisting(false)} />}
    </>
  );

  if (scanning) return <ScanMode intent={scanIntent} />;

  const filtering = query.text.trim() !== "" || query.status !== "all" || query.tags.length > 0 || query.shelves.length > 0;

  /** One section heading per group, with its own count.

      Rendered even for a single group so the eye has a consistent anchor when
      switching grouping on and off; suppressed entirely when grouping is
      "none", where the label is empty. */
  const groupHeading = (label: string, count: number) => (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      padding: mobile ? "12px 12px 5px" : "16px 20px 6px",
      position: "sticky", top: 0, zIndex: 1,
      background: "var(--color-bg)",
      borderBottom: "1px solid var(--color-divider-soft)",
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-heading)" }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--color-text-2)", fontFamily: "var(--font-mono)" }}>{count}</span>
    </div>
  );

  const covers = (list: Book[]) => (
    <div style={{
      display: "grid",
      // auto-FILL, not auto-fit: with auto-fit a narrow filter result
      // collapses the empty tracks and stretches three books to full width.
      gridTemplateColumns: mobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(150px, 1fr))",
      gap: mobile ? 12 : 16,
      padding: mobile ? "12px" : "14px 20px 18px",
    }}>
      {list.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onOpen={() => setOpenId(book.id)}
          onSetPage={(page) => setPage(book, page)}
        />
      ))}
    </div>
  );

  const grid = visible.length === 0 ? (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-2)", textAlign: "center", margin: 0 }}>
        {query.status === "wishlist" && facets.counts.wishlist === 0
          ? "Nothing on the wishlist yet — paste a link or a title and it will be here next time you're in a shop."
          : state.books.length === 0
            ? "No books yet — scan a barcode or import a CSV to fill the shelf."
            : filtering
              ? "Nothing matches those filters."
              : "Nothing here yet."}
      </p>
    </div>
  ) : (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: mobile ? 84 : 0 }}>
      {groups.map((g) => (
        <section key={g.key || "all"}>
          {g.label && groupHeading(g.label, g.books.length)}
          {layout === "list" ? (
            <BookList
              books={g.books}
              selected={selected}
              onToggle={toggleSelected}
              onOpen={(id) => setOpenId(id)}
              onSetPage={setPage}
              mobile={mobile}
            />
          ) : covers(g.books)}
        </section>
      ))}
    </div>
  );

  /* Appears only when something is selected, floating clear of the content —
     the same shape the desktop Todo list uses for bulk actions. */
  const selectionBar = selected.size === 0 ? null : (
    <div style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)",
      bottom: mobile ? 84 : 22, zIndex: 40,
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "8px 12px", borderRadius: "var(--radius-card)",
      background: "var(--color-card)", border: "1px solid var(--color-divider)",
      boxShadow: "var(--shadow-lg)", maxWidth: "calc(100vw - 24px)",
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 550 }}>{selected.size} selected</span>

      <select
        className="input"
        style={{ height: 28, fontSize: 12 }}
        value=""
        aria-label="Set status for selected books"
        onChange={(e) => { if (e.target.value) bulkPatch({ status: e.target.value as BookStatus }); }}
      >
        <option value="">Set status…</option>
        {(Object.keys(BOOK_STATUS_LABEL) as BookStatus[]).map((s) => (
          <option key={s} value={s}>{BOOK_STATUS_LABEL[s]}</option>
        ))}
      </select>

      <button
        className="btn btn-secondary"
        style={{ padding: "4px 10px", fontSize: 12 }}
        onClick={() => {
          const shelf = window.prompt("Move selected books to which shelf?")?.trim();
          if (shelf !== undefined) bulkPatch({ shelf: shelf || undefined });
        }}
      >
        Set shelf…
      </button>

      {confirmBulkDelete ? (
        <>
          <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>Delete {selected.size}?</span>
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => setConfirmBulkDelete(false)}>Cancel</button>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => { bulkDelete(); setConfirmBulkDelete(false); }}>Delete</button>
        </>
      ) : (
        <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
          onClick={() => setConfirmBulkDelete(true)}>Delete</button>
      )}

      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
        onClick={clearSelection}>Clear</button>
    </div>
  );

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MobileHeader
          title="Library"
          right={
            <span style={{ display: "flex", gap: 6 }}>
              <ExportMenu books={visible} group={group} filtered={filtering} mobile />
              <button className="btn btn-secondary btn-icon" onClick={() => setWishlisting(true)} aria-label="Add to wishlist">
                <IBook size={16} />
              </button>
              <button className="btn btn-secondary btn-icon" onClick={() => setImporting(true)} aria-label="Import from CSV">
                <IUpload size={16} />
              </button>
            </span>
          }
        />
        {mobileToolbar}
        {grid}
        <button className="fab" onClick={() => nav("/library/scan")} aria-label="Scan a book barcode">
          <IScan size={22} />
        </button>
        {selectionBar}
        {editor}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)", fontWeight: 600 }}>Library</h3>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <ExportMenu books={visible} group={group} filtered={filtering} mobile={false} />
          <button className="btn btn-secondary btn-icon" onClick={() => setImporting(true)} aria-label="Import from CSV" title="Import a Goodreads / StoryGraph / LibraryThing export">
            <IUpload size={15} />
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setWishlisting(true)}
            style={{ padding: "5px 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
            title="Add a book you don't own yet — paste a link, search a title, or scan it in the shop"
          >
            <IBook size={15} /> Wishlist
          </button>
          <button className="btn btn-primary" onClick={() => nav("/library/scan")} style={{ padding: "5px 12px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IScan size={15} /> Scan
          </button>
        </span>
      </div>
      {toolbar}
      {grid}
      {selectionBar}
      {editor}
    </div>
  );
}
