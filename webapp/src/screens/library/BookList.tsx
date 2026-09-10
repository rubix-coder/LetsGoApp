import { bookDisplayAuthor, coverFallbackTint, coverUrlFor } from "../../lib/books";
import { BOOK_STATUS_AS_TASK, BOOK_STATUS_LABEL, type Book } from "../../lib/types";
import { StatusSq } from "../../components/ui";
import { BookmarkRibbon } from "./BookmarkRibbon";

/** The dense counterpart to the cover grid.

    A cover wall is good for browsing and bad for finding: at 400 books you see
    about a dozen at a time and sorting by author or year buys you nothing you
    can actually read. This shows roughly twice as many rows per screen with
    the sorted-on field always visible, and carries the selection checkboxes
    that make cleaning up a large import bearable. */
export function BookList({
  books,
  selected,
  onToggle,
  onOpen,
  onSetPage,
  mobile,
}: {
  books: Book[];
  selected: Set<string>;
  onToggle: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  onSetPage: (book: Book, page: number | undefined) => void;
  mobile: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {books.map((book) => {
        const needsDetails = !!book.isbn13 && book.title.trim() === book.isbn13;
        const isSelected = selected.has(book.id);
        return (
          <div
            key={book.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: mobile ? "7px 12px" : "6px 14px",
              borderBottom: "1px solid var(--color-divider-soft)",
              background: isSelected ? "var(--accent-wash)" : undefined,
              minWidth: 0,
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              // Shift-click extends from the last selection, the way every
              // list of this kind behaves.
              onChange={(e) => onToggle(book.id, (e.nativeEvent as MouseEvent).shiftKey)}
              aria-label={`Select ${book.title}`}
              style={{ flex: "none", cursor: "pointer" }}
            />

            <button
              onClick={() => onOpen(book.id)}
              style={{
                flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10,
                background: "none", border: "none", padding: 0, textAlign: "left",
                cursor: "pointer", color: "var(--color-text)",
              }}
            >
              <img
                src={coverUrlFor(book, "S")}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                // Too small for the drawn cover art, but a per-book tint
                // still beats a row of identical grey rectangles.
                style={{
                  width: 24, height: 36, objectFit: "cover", flex: "none",
                  borderRadius: 2, background: coverFallbackTint(book.title || book.id),
                }}
              />

              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: needsDetails ? "var(--color-text-2)" : undefined,
                  fontFamily: needsDetails ? "var(--font-mono)" : undefined,
                }}>
                  {needsDetails ? `ISBN ${book.isbn13}` : (book.title || "Untitled")}
                </span>
                <span style={{
                  fontSize: 11, color: "var(--color-text-2)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {needsDetails ? "Needs title & author" : bookDisplayAuthor(book)}
                  {book.publishedYear ? ` · ${book.publishedYear}` : ""}
                  {book.shelf ? ` · ${book.shelf}` : ""}
                </span>
              </span>

              {book.rating !== undefined && (
                <span className="tag tag-neutral" style={{ flex: "none", padding: "1px 6px" }}>
                  {book.rating}★
                </span>
              )}

              <span style={{ display: "flex", alignItems: "center", gap: 5, flex: "none" }}>
                <StatusSq status={BOOK_STATUS_AS_TASK[book.status]} size={7} />
                {!mobile && (
                  <span style={{ fontSize: 11, color: "var(--color-text-2)", width: 58 }}>
                    {BOOK_STATUS_LABEL[book.status]}
                  </span>
                )}
              </span>
            </button>

            <BookmarkRibbon book={book} size="row" onSet={(page) => onSetPage(book, page)} />
          </div>
        );
      })}
    </div>
  );
}
