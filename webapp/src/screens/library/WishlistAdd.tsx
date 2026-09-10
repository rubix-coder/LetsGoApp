import { useState } from "react";
import { useStore } from "../../lib/store";
import { nav, useMobile } from "../../lib/router";
import { Modal } from "../../components/ui";
import { IScan, ISearch, IX } from "../../components/Icons";
import { httpBookGateway, bookApiMessage } from "../../lib/bookApi";
import { hasClaudeKey, httpBookLinkGateway } from "../../lib/claudeApi";
import { searchTitles, type LookupResult } from "../../lib/bookLookup";
import {
  looksLikeUrl, normalizeBookUrl, resolveBookFromLink, retailerName, wishlistBookFromLookup,
} from "../../lib/bookLink";
import { newBook, bookDisplayAuthor } from "../../lib/books";
import type { Book } from "../../lib/types";

/** Adding a book you do NOT own yet.

    The one box takes either a link or a title, because that is how books
    actually reach you — someone sends an Amazon link, or someone says a name
    across a table. Which one you pasted is worked out here rather than asked
    about.

    Every path ends in the same editable draft, and there is always a way
    forward when the automatic ones fail: paste a link, search a title, scan
    the barcode, or type it in. A wishlist that refuses the book because a
    retailer blocked a fetcher would be worse than a paper note. */
export function WishlistAdd({ onClose }: { onClose: () => void }) {
  const { dispatch, readOnly } = useStore();
  const mobile = useMobile();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [hits, setHits] = useState<LookupResult[] | null>(null);
  /* Non-null once there is something to add. Editable to the end: a fetched
     record is a good guess, and the person holding the phone is the
     authority on what they actually want. */
  const [draft, setDraft] = useState<Book | null>(null);

  const isLink = looksLikeUrl(input);
  const set = (patch: Partial<Book>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  /** The keyboard rung. Offered up front and after every failure, never as an
      error state — typing a title is a perfectly good way to use a wishlist. */
  function typeItIn(seed: Partial<Book> = {}) {
    const sourceUrl = isLink ? normalizeBookUrl(input) ?? undefined : undefined;
    setHits(null);
    setDraft(newBook({
      status: "wishlist",
      title: isLink ? "" : input.trim(),
      sourceUrl,
      source: sourceUrl ? `link:${retailerName(sourceUrl)}` : "wishlist",
      ...seed,
    }));
  }

  async function fromLink() {
    setBusy(true);
    setNote("");
    setHits(null);
    try {
      const outcome = await resolveBookFromLink(input, httpBookLinkGateway, httpBookGateway);
      if (outcome.kind === "filled") {
        setDraft(outcome.book);
        setNote(`Found it at ${retailerName(input)} — check it, then add.`);
        return;
      }
      if (outcome.kind === "not-a-book") setNote("That link isn't a book — type the title in instead.");
      else if (outcome.kind === "unusable") setNote(outcome.reason);
      else if (outcome.kind === "unavailable") setNote(outcome.reason);
      else setNote("Couldn't read that page — type in what you know instead.");
      // A dead end still has to leave a way forward, so the fields open with
      // the link already attached.
      typeItIn();
    } finally {
      setBusy(false);
    }
  }

  async function fromTitle() {
    const query = input.trim();
    if (query.length < 2) return;
    setBusy(true);
    setNote("");
    setHits(null);
    try {
      const found = await searchTitles(query, httpBookGateway);
      setHits(found);
      if (found.length === 0) {
        setNote("Nothing found — add it as typed, or fill in the details below.");
        typeItIn();
      }
    } catch (err) {
      setNote(bookApiMessage(err));
      typeItIn();
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!draft) return;
    dispatch({
      type: "upsertBook",
      book: { ...draft, title: draft.title.trim() || "Untitled", status: "wishlist" },
    });
    onClose();
  }

  const canSubmit = input.trim().length >= 2 && !busy;

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)", fontWeight: 600, flex: 1, minWidth: 0 }}>
          Add to wishlist
        </h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close"><IX size={16} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="field">
            <span>Link or title</span>
            <input
              className="input"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !canSubmit) return;
                e.preventDefault();
                void (isLink ? fromLink() : fromTitle());
              }}
              placeholder="Paste an Amazon link, or type a title"
              aria-label="Book link or title"
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={!canSubmit}
              onClick={() => void (isLink ? fromLink() : fromTitle())}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <ISearch size={14} />
              {busy
                ? (isLink ? "Reading the page…" : "Searching…")
                : (isLink ? `Fetch from ${retailerName(input)}` : "Search")}
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => { onClose(); nav("/library/scan/wishlist"); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Scan the barcode in the shop and keep it for later"
            >
              <IScan size={14} /> Scan a barcode
            </button>

            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => typeItIn()}>
              Type it in
            </button>
          </div>

          {/* Said before the attempt, not after it fails: reading a retailer
              page bills the user's own Claude account, and a link with an
              ISBN in it never needs one. */}
          {isLink && !hasClaudeKey() && (
            <span style={{ fontSize: 11.5, color: "var(--color-text-2)" }}>
              Links without an ISBN in them need a Claude API key (Settings → Library).
              Searching by title and scanning are always free.
            </span>
          )}

          {note && <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>{note}</span>}
        </div>

        {hits && hits.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {hits.map((hit, i) => (
              <button
                key={`${hit.title}-${i}`}
                onClick={() => {
                  setDraft(wishlistBookFromLookup(hit));
                  setHits(null);
                  setNote("Check it, then add.");
                }}
                style={{
                  textAlign: "left", cursor: "pointer", padding: "6px 8px",
                  border: "1px solid var(--color-divider)", borderRadius: "var(--radius-sm)",
                  background: "var(--color-card)", color: "var(--color-text)",
                  display: "flex", gap: 8, alignItems: "baseline",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 550, flex: 1, minWidth: 0 }}>{hit.title}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-2)", whiteSpace: "nowrap" }}>
                  {bookDisplayAuthor({ ...newBook(), authors: hit.authors })}
                  {hit.publishedYear ? ` · ${hit.publishedYear}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {draft && (
          <div style={{
            border: "1px solid var(--color-divider)", borderRadius: "var(--radius)",
            padding: 12, display: "flex", flexDirection: "column", gap: 10,
            background: "var(--color-surface)",
          }}>
            <label className="field">
              <span>Title</span>
              <input className="input" value={draft.title} disabled={readOnly}
                autoFocus={!draft.title}
                onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="field">
              <span>Authors</span>
              <input className="input" value={draft.authors.join(", ")} disabled={readOnly}
                placeholder="Comma separated"
                onChange={(e) => set({ authors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10 }}>
              <label className="field">
                <span>ISBN</span>
                <input className="input" value={draft.isbn13 ?? ""} disabled={readOnly}
                  inputMode="numeric" placeholder="Helps you find it in the shop"
                  onChange={(e) => set({ isbn13: e.target.value.trim() || undefined })} />
              </label>
              <label className="field">
                <span>Tags</span>
                <input className="input" value={draft.tags.join(", ")} disabled={readOnly}
                  placeholder="gift, birthday"
                  onChange={(e) => set({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </label>
            </div>

            <label className="field">
              {/* The thing you will actually want in the shop: why this book,
                  and who said so. */}
              <span>Note</span>
              <textarea className="input" rows={2} value={draft.notes ?? ""} disabled={readOnly}
                placeholder="Recommended by…, paperback only, wait for the reprint"
                onChange={(e) => set({ notes: e.target.value || undefined })} />
            </label>

            {draft.sourceUrl && (
              <a
                href={draft.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ fontSize: 11.5, color: "var(--color-text-2)", wordBreak: "break-all" }}
              >
                {draft.sourceUrl}
              </a>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--color-divider)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={readOnly || !draft} onClick={add}>
          Add to wishlist
        </button>
      </div>
    </>
  );

  if (mobile) return <div className="sheet">{body}</div>;
  return <Modal onClose={onClose} width={560}>{body}</Modal>;
}
