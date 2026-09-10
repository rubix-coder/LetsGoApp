import { useState } from "react";
import { bookDisplayAuthor, coverUrlFor, readingFraction } from "../../lib/books";
import { BOOK_STATUS_AS_TASK, BOOK_STATUS_LABEL, type Book } from "../../lib/types";
import { StatusSq } from "../../components/ui";
import { CoverArt } from "./CoverArt";
import { BookmarkRibbon } from "./BookmarkRibbon";
import { BP } from "../../components/ui";

/** One book in the grid. A 2:3 cover with the title and author beneath.

    Not every ISBN has a cover on file at Open Library, so the fallback has to
    look deliberate rather than broken: a tinted panel derived from the title,
    carrying the title itself. A shelf of fallbacks then reads as a row of
    different spines instead of one grey block. */
export function BookCard({ book, onOpen, onSetPage }: {
  book: Book;
  onOpen: () => void;
  onSetPage: (page: number | undefined) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverUrlFor(book, "M");
  const showCover = cover && !coverFailed;
  // A scan whose lookup found nothing keeps its ISBN as the title. Showing a
  // 13-digit number where a title belongs reads as a broken card; saying what
  // it actually needs turns it into a to-do the user can act on.
  const needsDetails = !!book.isbn13 && book.title.trim() === book.isbn13;

  return (
    <BP
      className="lift"
      // BP renders a div, so the button semantics have to be added by hand.
      role="button"
      tabIndex={0}
      aria-label={`${book.title}, ${bookDisplayAuthor(book)}, ${BOOK_STATUS_LABEL[book.status]}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
      style={{ background: "var(--color-card)", padding: 0, cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "relative", aspectRatio: "2 / 3", background: "var(--color-surface)", overflow: "hidden" }}>
        {showCover ? (
          <img
            src={cover}
            alt=""
            // 400 cards would hammer covers.openlibrary.org and trip its
            // per-IP rate limit; lazy keeps it to what is on screen.
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <CoverArt
            seed={book.title || book.isbn13 || book.id}
            title={needsDetails ? "Tap to add details" : (book.title || "Untitled")}
            caption={needsDetails ? book.isbn13 : undefined}
          />
        )}
        {book.rating !== undefined && (
          <span className="tag tag-accent" style={{ position: "absolute", top: 6, right: 6, padding: "1px 6px" }}>
            {book.rating}★
          </span>
        )}
        {/* Hangs from the top edge like a real bookmark. Every book gets one:
            unplaced it shows a muted "+" invite, placed it carries the page. */}
        <span style={{ position: "absolute", top: 0, left: 10 }}>
          <BookmarkRibbon book={book} onSet={onSetPage} />
        </span>
        {readingFraction(book) !== null && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, height: 3,
              background: "var(--color-divider)",
            }}
          >
            <span style={{
              display: "block", height: "100%",
              width: `${(readingFraction(book) ?? 0) * 100}%`,
              background: "var(--bookmark)",
            }} />
          </span>
        )}
      </div>

      <div style={{ padding: "8px 9px 9px", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{
          fontWeight: 550, lineHeight: 1.25,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          fontSize: needsDetails ? 11 : 12.5,
          color: needsDetails ? "var(--color-text-2)" : undefined,
          fontFamily: needsDetails ? "var(--font-mono)" : undefined,
        }}>
          {needsDetails ? `ISBN ${book.isbn13}` : (book.title || "Untitled")}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <StatusSq status={BOOK_STATUS_AS_TASK[book.status]} size={7} />
          <span style={{ fontSize: 11, color: "var(--color-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {needsDetails ? "Needs title & author" : bookDisplayAuthor(book)}
          </span>
        </span>
      </div>
    </BP>
  );
}
