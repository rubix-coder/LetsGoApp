import { useEffect, useRef, useState } from "react";
import type { Book } from "../../lib/types";
import { clampPage } from "../../lib/books";

/* A cloth bookmark hanging out of the top of the book, carrying the page you
   are on. Click it and type a new number.

   Shaped like the real thing: a straight tail with a notch cut out of the
   bottom, in a deep library red that is deliberately NOT the rose used for
   "did not finish" — a bookmark marks a place, it does not mark a verdict. */

export function BookmarkRibbon({
  book,
  onSet,
  size = "card",
}: {
  book: Book;
  onSet: (page: number | undefined) => void;
  /** "card" hangs off a cover; "row" sits inline in the dense list. */
  size?: "card" | "row";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function open(e: React.MouseEvent | React.KeyboardEvent) {
    // The whole card is a button; editing the bookmark must not also open the
    // book editor underneath it.
    e.stopPropagation();
    setDraft(book.currentPage !== undefined ? String(book.currentPage) : "");
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onSet(undefined); // clearing the field takes the bookmark out
    } else {
      onSet(clampPage(trimmed, book.pageCount));
    }
    setEditing(false);
  }

  const placed = book.currentPage !== undefined;
  const narrow = size === "row";

  if (editing) {
    return (
      <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", flex: "none" }}>
        <input
          ref={inputRef}
          className="input"
          value={draft}
          inputMode="numeric"
          aria-label={`Page you are on in ${book.title}`}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="page"
          style={{ width: 62, height: 24, fontSize: 12, padding: "0 6px", textAlign: "center" }}
        />
      </span>
    );
  }

  return (
    <button
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(e); }}
      title={placed ? `Page ${book.currentPage} — click to change` : "Set the page you're on"}
      aria-label={placed ? `Page ${book.currentPage}. Change bookmark.` : "Place a bookmark"}
      style={{
        flex: "none", cursor: "pointer", border: "none", padding: 0,
        background: "none", lineHeight: 0,
      }}
    >
      <span style={{
        position: "relative", display: "inline-block",
        width: narrow ? 34 : 30,
        // The tail plus the notch: clip-path cuts the V out of the bottom.
        height: narrow ? 22 : 40,
        background: placed
          ? `linear-gradient(180deg, var(--bookmark) 0%, var(--bookmark-edge) 100%)`
          : "var(--color-divider)",
        clipPath: narrow
          ? "polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)"
          : "polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)",
        boxShadow: placed ? "0 1px 3px rgba(0,0,0,0.35)" : "none",
      }}>
        <span style={{
          position: "absolute", top: narrow ? 3 : 6, left: 0, right: 0,
          textAlign: "center",
          font: `600 ${narrow ? 10 : 11}px var(--font-mono)`,
          color: placed ? "var(--on-bookmark)" : "var(--color-text-2)",
          letterSpacing: "-0.02em",
        }}>
          {placed ? book.currentPage : "+"}
        </span>
      </span>
    </button>
  );
}
