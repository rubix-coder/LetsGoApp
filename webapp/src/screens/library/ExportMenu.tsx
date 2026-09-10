import { useEffect, useRef, useState } from "react";
import { booksToHtml } from "../../lib/bookExport";
import type { BookGroup } from "../../lib/bookFilter";
import type { Book } from "../../lib/types";
import { IDownload } from "../../components/Icons";
import { saveTextFile } from "../../lib/download";
import { isNative } from "../../lib/native/platform";

/** Saves the catalogue, or prints it.

    Both routes render the same document — PDF is just the browser printing
    the HTML, which is why there is no PDF library in this app. The dialogue
    that opens offers "Save as PDF" on every desktop browser and on Android. */
export function ExportMenu({
  books,
  group,
  filtered,
  mobile,
}: {
  books: Book[];
  group: BookGroup;
  filtered: boolean;
  mobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-away, matching how the other popovers on this screen close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function document_() {
    return booksToHtml(books, {
      title: "My Library",
      group,
      generatedAt: new Date(),
      filtered,
    });
  }

  function saveHtml() {
    void saveTextFile(`library-${new Date().toISOString().slice(0, 10)}.html`, "text/html;charset=utf-8", document_());
    setOpen(false);
  }

  /* Printed from a hidden iframe rather than a popup window.

     window.open is blocked by default in most browsers unless the click is
     recognised as a direct gesture, and on Android Chrome it is blocked far
     more aggressively — an iframe has no such problem and needs no new tab.

     The native shell's WebView ignores window.print() entirely, so there the
     document goes through PrinterPlugin → Android's own print dialog, which
     has the same "Save as PDF" destination. */
  function printPdf() {
    if (isNative) {
      void import("../../lib/native/print").then(({ printHtml }) => printHtml(document_(), "LetsGo library"));
      setOpen(false);
      return;
    }
    const frame = window.document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.srcdoc = document_();
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) { frame.remove(); return; }
      win.focus();
      win.print();
      // The dialogue is modal but print() can return before it closes, so the
      // frame is cleared on the next tick rather than immediately.
      win.addEventListener("afterprint", () => frame.remove());
      setTimeout(() => frame.remove(), 60_000);
    };
    window.document.body.appendChild(frame);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "none" }}>
      <button
        className="btn btn-secondary btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export the library"
        title="Export as HTML or PDF"
      >
        <IDownload size={mobile ? 16 : 15} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
            minWidth: 208, padding: 6, display: "flex", flexDirection: "column", gap: 2,
            background: "var(--color-card)", border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-lg)",
          }}
        >
          <span style={{ padding: "5px 9px 3px", fontSize: 11, color: "var(--color-text-2)" }}>
            {books.length} {books.length === 1 ? "book" : "books"}
            {filtered ? " (current filter)" : ""}
            {group !== "none" ? ", grouped" : ""}
          </span>
          <MenuItem label="Save as PDF" hint="Opens your print dialogue" onClick={printPdf} />
          <MenuItem label="Save as HTML" hint="A single self-contained file" onClick={saveHtml} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="popmenu-row"
      style={{
        display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start",
        padding: "7px 9px", border: "none", background: "none", cursor: "pointer",
        borderRadius: "var(--radius-sm)", textAlign: "left", color: "var(--color-text)", width: "100%",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--color-text-2)" }}>{hint}</span>
    </button>
  );
}
