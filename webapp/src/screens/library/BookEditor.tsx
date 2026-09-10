import { useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { useMobile } from "../../lib/router";
import { BOOK_STATUS_LABEL, type Book, type BookStatus } from "../../lib/types";
import { Modal, Seg } from "../../components/ui";
import { ITrash, IX, ISearch, ICamera, ILink } from "../../components/Icons";
import { httpBookGateway, bookApiMessage } from "../../lib/bookApi";
import { claudeApiMessage, hasClaudeKey, httpVisionGateway, loadImage, toJpegBase64 } from "../../lib/claudeApi";
import { identifyCover } from "../../lib/coverVision";
import { mergeLookupIntoBook, searchTitles, type LookupResult } from "../../lib/bookLookup";
import { bookDisplayAuthor, clampPage, coverUrlFor } from "../../lib/books";
import { markAsBought, retailerName } from "../../lib/bookLink";

const STATUSES: BookStatus[] = ["wishlist", "unread", "reading", "read", "dnf"];

/** Epoch ms ⇄ the yyyy-mm-dd an <input type="date"> wants. Both directions go
    through the local calendar day, so a book finished at 23:00 does not show
    as the next morning. */
function toDateInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function BookEditor({ book, onClose }: { book: Book; onClose: () => void }) {
  const { state, dispatch, readOnly } = useStore();
  const mobile = useMobile();
  const [draft, setDraft] = useState<Book>(book);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (patch: Partial<Book>) => setDraft((d) => ({ ...d, ...patch }));
  const shelves = [...new Set(state.books.map((b) => b.shelf).filter(Boolean))] as string[];

  /* An ISBN that resolved to nothing leaves the title as the ISBN itself.
     That happens a lot with India-only reprints and small regional
     publishers, whose printing-specific ISBN was never indexed even though
     the work is well known — so searching by title rescues them where the
     barcode could not. */
  const unresolved = !!draft.isbn13 && draft.title.trim() === draft.isbn13;
  const [titleQuery, setTitleQuery] = useState(unresolved ? "" : draft.title);
  const [hits, setHits] = useState<LookupResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");

  /* The third rescue, after the barcode and the title search: read the cover.

     Reaches the books the other two cannot — a regional edition whose ISBN
     was never registered is absent from every free database, but its title is
     printed on the front. Off unless a Claude key is set, since it bills the
     user's own account. */
  const photoRef = useRef<HTMLInputElement>(null);
  const [identifying, setIdentifying] = useState(false);

  async function identifyFromPhoto(file: File) {
    setIdentifying(true);
    setSearchNote("");
    setHits(null);
    try {
      const img = await loadImage(file);
      const base64 = await toJpegBase64(img, img.naturalWidth, img.naturalHeight);
      const outcome = await identifyCover(base64, "image/jpeg", httpVisionGateway);

      if (outcome.kind === "not-a-book") {
        setSearchNote("That photo doesn't look like a book — try the front cover.");
      } else if (outcome.kind !== "found" || !outcome.result) {
        setSearchNote(outcome.reason ?? "Couldn't read that cover.");
      } else {
        // Offered as a search hit rather than applied silently: a model
        // reading a cover is a good guess, not an authority, and the user is
        // holding the book.
        setHits([outcome.result]);
        setSearchNote(
          outcome.lowConfidence
            ? "Read from the photo, but the model wasn't confident — check it before saving."
            : "Read from the photo — check it, then apply.",
        );
      }
    } catch (err) {
      setSearchNote(claudeApiMessage(err));
    } finally {
      setIdentifying(false);
    }
  }

  async function runTitleSearch() {
    const q = titleQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchNote("");
    setHits(null);
    try {
      const found = await searchTitles(q, httpBookGateway);
      setHits(found);
      if (found.length === 0) setSearchNote("Nothing found — fill the fields in below.");
    } catch (err) {
      setSearchNote(bookApiMessage(err));
    } finally {
      setSearching(false);
    }
  }

  function applyHit(hit: LookupResult) {
    // The scanned ISBN is the one physically on the shelf, so it wins over
    // whatever edition the search happened to match.
    setDraft((d) => mergeLookupIntoBook({ ...d, title: "", authors: [] }, hit));
    setHits(null);
    setSearchNote("Applied — check it, then save.");
  }

  function save() {
    dispatch({ type: "upsertBook", book: { ...draft, title: draft.title.trim() || "Untitled" } });
    onClose();
  }

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)", fontWeight: 600, flex: 1, minWidth: 0 }}>
          Edit book
        </h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close"><IX size={16} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Shown up front when the barcode found nothing: a title search is
            far less typing than filling every field, and it rescues the very
            common case of an India-only reprint whose ISBN was never indexed
            even though the work itself is well known. */}
        {unresolved && (
          <div style={{
            border: "1px solid var(--color-divider)", borderRadius: "var(--radius)",
            padding: 12, display: "flex", flexDirection: "column", gap: 8,
            background: "var(--color-surface)",
          }}>
            <span style={{ fontSize: 12.5 }}>
              This barcode isn&rsquo;t in Open Library or Google Books. Search by title instead:
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="input"
                autoFocus
                value={titleQuery}
                onChange={(e) => setTitleQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runTitleSearch(); } }}
                placeholder="e.g. Data Structures and Algorithms in Python"
                aria-label="Search for this book by title"
                style={{ flex: 1, height: 32, fontSize: 13 }}
              />
              <button
                className="btn btn-secondary"
                disabled={searching || titleQuery.trim().length < 2}
                onClick={() => void runTitleSearch()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ISearch size={14} /> {searching ? "Searching…" : "Search"}
              </button>
            </div>

            {hits && hits.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {hits.map((hit, i) => (
                  <button
                    key={`${hit.title}-${i}`}
                    onClick={() => applyHit(hit)}
                    style={{
                      textAlign: "left", cursor: "pointer", padding: "6px 8px",
                      border: "1px solid var(--color-divider)", borderRadius: "var(--radius-sm)",
                      background: "var(--color-card)", color: "var(--color-text)",
                      display: "flex", gap: 8, alignItems: "baseline",
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 550, flex: 1, minWidth: 0 }}>{hit.title}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-2)", whiteSpace: "nowrap" }}>
                      {bookDisplayAuthor({ ...draft, authors: hit.authors })}
                      {hit.publishedYear ? ` · ${hit.publishedYear}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Only offered once a key exists — a button that always fails is
                worse than no button. */}
            {hasClaudeKey() && (
              <>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  // On a phone this opens the camera directly.
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void identifyFromPhoto(file);
                  }}
                />
                <button
                  className="btn btn-secondary"
                  disabled={identifying}
                  onClick={() => photoRef.current?.click()}
                  style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <ICamera size={14} /> {identifying ? "Reading the cover…" : "Photograph the cover instead"}
                </button>
              </>
            )}

            {searchNote && (
              <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>{searchNote}</span>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          {coverUrlFor(draft, "M") && (
            <img
              src={coverUrlFor(draft, "M")}
              alt=""
              loading="lazy"
              style={{ width: 78, aspectRatio: "2 / 3", objectFit: "cover", flex: "none", borderRadius: 4 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="field">
              <span>Title</span>
              <input className="input" value={draft.title} disabled={readOnly}
                onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="field">
              <span>Authors</span>
              <input className="input" value={draft.authors.join(", ")} disabled={readOnly}
                placeholder="Comma separated"
                onChange={(e) => set({ authors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </label>
          </div>
        </div>

        <div className="field">
          <span>Status</span>
          <Seg
            small
            ariaLabel="Reading status"
            items={STATUSES.map((s) => ({ id: s, label: BOOK_STATUS_LABEL[s] }))}
            active={draft.status}
            onSelect={(id) => set({ status: id as BookStatus })}
          />
        </div>

        {draft.status === "wishlist" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "10px 12px", borderRadius: "var(--radius)",
            background: "var(--accent-wash)",
          }}>
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 140 }}>
              You don&rsquo;t own this yet.
            </span>
            {draft.sourceUrl && (
              <a
                className="btn btn-secondary"
                href={draft.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <ILink size={13} /> Open at {retailerName(draft.sourceUrl)}
              </a>
            )}
            <button
              className="btn btn-primary"
              disabled={readOnly}
              style={{ padding: "4px 10px", fontSize: 12 }}
              // Moves it onto the shelf and stamps when — `addedAt` keeps
              // meaning "when I first wanted it".
              onClick={() => setDraft((d) => markAsBought(d))}
            >
              Mark as bought
            </button>
          </div>
        )}

        <div className="field">
          <span>Rating</span>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`chip${draft.rating === n ? " on" : ""}`}
                disabled={readOnly}
                aria-pressed={draft.rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                // Clicking the current rating clears it: unrated has to stay
                // reachable, and it is not the same as one star.
                onClick={() => set({ rating: draft.rating === n ? undefined : n })}
              >
                {n}★
              </button>
            ))}
            {draft.rating !== undefined && (
              <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                onClick={() => set({ rating: undefined })}>Clear</button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <label className="field">
            <span>Started</span>
            <input type="date" className="input" value={toDateInput(draft.startedAt)} disabled={readOnly}
              onChange={(e) => set({ startedAt: fromDateInput(e.target.value) })} />
          </label>
          <label className="field">
            <span>Finished</span>
            <input type="date" className="input" value={toDateInput(draft.finishedAt)} disabled={readOnly}
              onChange={(e) => set({ finishedAt: fromDateInput(e.target.value) })} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <label className="field">
            {/* The same bookmark the card and list rows carry, reachable
                without hunting for the ribbon. */}
            <span>Bookmark{draft.pageCount ? ` (of ${draft.pageCount})` : ""}</span>
            <input
              className="input"
              inputMode="numeric"
              disabled={readOnly}
              placeholder="Page you're on"
              value={draft.currentPage ?? ""}
              onChange={(e) => set({ currentPage: clampPage(e.target.value, draft.pageCount) })}
            />
          </label>
          <label className="field">
            <span>Shelf</span>
            <input className="input" list="lg-shelves" value={draft.shelf ?? ""} disabled={readOnly}
              placeholder="Living room, shelf 2"
              onChange={(e) => set({ shelf: e.target.value.trim() || undefined })} />
            <datalist id="lg-shelves">{shelves.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
        </div>

        <label className="field">
          <span>Tags</span>
          <input className="input" value={draft.tags.join(", ")} disabled={readOnly}
            placeholder="Comma separated"
            onChange={(e) => set({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea className="input" rows={3} value={draft.notes ?? ""} disabled={readOnly}
            onChange={(e) => set({ notes: e.target.value || undefined })} />
        </label>

        <div style={{ fontSize: 11, color: "var(--color-text-2)", fontFamily: "var(--font-mono)" }}>
          {draft.isbn13 ? `ISBN ${draft.isbn13}` : "No ISBN"}
          {draft.publisher ? ` · ${draft.publisher}` : ""}
          {draft.publishedYear ? ` · ${draft.publishedYear}` : ""}
          {draft.pageCount ? ` · ${draft.pageCount}pp` : ""}
          {draft.acquiredAt ? ` · bought ${new Date(draft.acquiredAt).toLocaleDateString()}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--color-divider)" }}>
        {confirmDelete ? (
          <>
            <span style={{ fontSize: 12, color: "var(--color-text-2)", flex: 1 }}>Delete this book?</span>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn btn-ghost" onClick={() => { dispatch({ type: "deleteBook", id: draft.id }); onClose(); }}>Delete</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-icon" disabled={readOnly}
              aria-label="Delete book" onClick={() => setConfirmDelete(true)}>
              <ITrash size={15} />
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={readOnly} onClick={save}>Save</button>
          </>
        )}
      </div>
    </>
  );

  // The house split: a full-height sheet on a phone, a modal on a desktop.
  if (mobile) return <div className="sheet">{body}</div>;
  return <Modal onClose={onClose} width={620}>{body}</Modal>;
}
