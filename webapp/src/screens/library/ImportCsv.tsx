import { useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { useMobile } from "../../lib/router";
import { mergeImportedBooks, parseBookCsv, type CsvFlavor, type CsvImport } from "../../lib/bookCsv";
import { bookDisplayAuthor } from "../../lib/books";
import { BOOK_STATUS_LABEL } from "../../lib/types";
import { Modal } from "../../components/ui";
import { IUpload, IX } from "../../components/Icons";

const FLAVOR_LABEL: Record<CsvFlavor, string> = {
  goodreads: "Goodreads export",
  storygraph: "StoryGraph export",
  librarything: "LibraryThing export",
  generic: "CSV",
};

/** Import a shelf from a reading-tracker export.

    Nothing is committed until the counts have been shown. A 400-row file that
    silently merged the wrong way would be miserable to unpick by hand, so the
    preview names the flavour it detected, shows the first few rows as they
    were actually parsed, and states how many are new versus already known. */
export function ImportCsv({ onClose }: { onClose: () => void }) {
  const { state, dispatch, readOnly } = useStore();
  const mobile = useMobile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<(CsvImport & { name: string }) | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const result = parseBookCsv(await file.text(), file.name);
      if (result.books.length === 0) {
        setError("No books found in that file — is it a library export?");
        setParsed(null);
        return;
      }
      setParsed({ ...result, name: file.name });
    } catch {
      setError("That file could not be read as CSV.");
      setParsed(null);
    }
  }

  // Counted against the real shelf, so the numbers shown are the numbers that
  // will happen — not an estimate.
  const preview = parsed ? mergeImportedBooks(state.books, parsed.books) : null;

  function commit() {
    if (!parsed) return;
    dispatch({ type: "importBooks", books: parsed.books });
    onClose();
  }

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--color-divider)" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)", fontWeight: 600, flex: 1 }}>Import books</h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close"><IX size={16} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]); }}
          style={{
            border: `1px dashed ${dragging ? "var(--color-accent)" : "var(--color-divider)"}`,
            background: dragging ? "var(--accent-wash)" : "transparent",
            borderRadius: "var(--radius)", padding: "22px 16px", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}
        >
          <IUpload size={20} style={{ color: "var(--color-text-3)" }} />
          <span style={{ fontSize: 13, color: "var(--color-text-2)" }}>
            Drop a Goodreads, StoryGraph or LibraryThing CSV here
          </span>
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Choose a file</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>

        {error && <p style={{ margin: 0, fontSize: 13, color: "var(--st-skipped)" }}>{error}</p>}

        {parsed && preview && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="tag tag-accent">{FLAVOR_LABEL[parsed.flavor]}</span>
              <span style={{ fontSize: 13 }}>
                <strong>{preview.added}</strong> new
                {preview.updated > 0 && <> · <strong>{preview.updated}</strong> already on the shelf</>}
                {parsed.skipped > 0 && <> · <strong>{parsed.skipped}</strong> skipped</>}
              </span>
            </div>

            {parsed.flavor === "generic" && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-2)" }}>
                The columns weren&rsquo;t recognised as a known export, so only Title, Author and ISBN
                were read. Check the preview below before importing.
              </p>
            )}

            <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {parsed.books.slice(0, 5).map((book) => (
                <div key={book.id} style={{
                  display: "flex", gap: 8, alignItems: "baseline", padding: "7px 10px",
                  borderBottom: "1px solid var(--color-divider-soft)", fontSize: 12.5,
                }}>
                  <span style={{ fontWeight: 550, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {book.title}
                  </span>
                  <span style={{ color: "var(--color-text-2)", whiteSpace: "nowrap" }}>{bookDisplayAuthor(book)}</span>
                  <span style={{ marginLeft: "auto", color: "var(--color-text-3)", fontFamily: "var(--font-mono)", fontSize: 10.5, whiteSpace: "nowrap" }}>
                    {BOOK_STATUS_LABEL[book.status]}{book.isbn13 ? "" : " · no ISBN"}
                  </span>
                </div>
              ))}
              {parsed.books.length > 5 && (
                <div style={{ padding: "7px 10px", fontSize: 12, color: "var(--color-text-2)" }}>
                  and {parsed.books.length - 5} more…
                </div>
              )}
            </div>

            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-2)" }}>
              Books already on the shelf keep the rating, notes, shelf and tags you set — an import
              only fills in what is missing.
            </p>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--color-divider)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!parsed || readOnly} onClick={commit}>
          {preview ? `Import ${preview.added + preview.updated} books` : "Import"}
        </button>
      </div>
    </>
  );

  if (mobile) return <div className="sheet">{body}</div>;
  return <Modal onClose={onClose} width={560}>{body}</Modal>;
}
