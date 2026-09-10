/* A drawn cover for books that have no image.

   Not every ISBN has a cover on file, and small or regional publishers almost
   never do — so on a real shelf this is a common state, not an edge case. A
   flat tint made those look like loading errors. This draws something
   deliberate instead: a spine, a couple of bands and a quiet geometric mark,
   all derived from the book's own title so two fallbacks never look alike and
   the same book always looks the same.

   Pure SVG over theme tokens — no image assets, no network, and it inherits
   dark/light automatically. */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic pseudo-random stream from one seed. */
function stream(seed: string) {
  let n = hash(seed) || 1;
  return () => {
    n = (n * 1664525 + 1013904223) % 4294967296;
    return n / 4294967296;
  };
}

export function CoverArt({ seed, title, caption }: { seed: string; title?: string; caption?: string }) {
  const rand = stream(seed);
  // Hue offset only — saturation and lightness stay in the app's range so a
  // wall of these still reads as one family rather than a fruit salad.
  const hue = Math.floor(rand() * 360);
  const variant = Math.floor(rand() * 3);
  const bandY = 60 + rand() * 25;

  const ink = `hsl(${hue} 45% 55%)`;
  const inkSoft = `hsl(${hue} 40% 62%)`;

  return (
    <span style={{ position: "absolute", inset: 0, display: "block" }} aria-hidden="true">
      <svg viewBox="0 0 100 150" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
        <rect x="0" y="0" width="100" height="150" fill={ink} opacity="0.16" />

        {/* The spine — the one element every book on a shelf actually shows. */}
        <rect x="0" y="0" width="7" height="150" fill={ink} opacity="0.5" />
        <rect x="7" y="0" width="1.2" height="150" fill={ink} opacity="0.28" />

        {/* A quiet mark, so the covers differ from each other at a glance. */}
        {variant === 0 && (
          <>
            <circle cx="62" cy="46" r="20" fill={inkSoft} opacity="0.28" />
            <circle cx="46" cy="60" r="13" fill={ink} opacity="0.22" />
          </>
        )}
        {variant === 1 && (
          <>
            <rect x="26" y="26" width="48" height="48" fill={inkSoft} opacity="0.26" />
            <rect x="38" y="38" width="24" height="24" fill={ink} opacity="0.24" />
          </>
        )}
        {variant === 2 && (
          <>
            <path d="M22 74 L52 22 L82 74 Z" fill={inkSoft} opacity="0.26" />
            <path d="M38 74 L52 48 L66 74 Z" fill={ink} opacity="0.22" />
          </>
        )}

        {/* Publisher-style rules near the foot. */}
        <rect x="18" y={bandY + 22} width="64" height="1.6" fill={ink} opacity="0.4" />
        <rect x="18" y={bandY + 28} width="40" height="1.6" fill={ink} opacity="0.26" />
      </svg>

      {(title || caption) && (
        <span style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 5,
          padding: "10px 12px 26px 16px", textAlign: "center",
        }}>
          {title && (
            <span style={{
              font: "600 12.5px var(--font-heading)", color: "var(--color-text)",
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              {title}
            </span>
          )}
          {caption && (
            <span style={{ font: "400 10px var(--font-mono)", color: "var(--color-text-2)" }}>
              {caption}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
