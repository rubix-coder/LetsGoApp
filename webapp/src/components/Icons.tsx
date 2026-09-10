import type { ReactNode, SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function make(children: ReactNode, fill = false) {
  return function Icon({ size = 19, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth={1.5}
        aria-hidden
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const ITodo = make(<><rect x="3" y="3" width="18" height="18" /><path d="M8 12l3 3 5-6" /></>);
// Stopwatch (top cap + stem + side button) — deliberately distinct from IClock
// (a wall clock) so the Timer feature never reads as a plain scheduled-time icon.
export const ITimer = make(<><path d="M10 2h4" /><path d="M12 2v5" /><circle cx="12" cy="14" r="7" /><path d="M12 14V10" /><path d="M18.4 8.6l1.4-1.4" /></>);
export const INotes = make(<><path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2Z" /><path d="M8 4v16" /></>);
export const IMindmap = make(<><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 7l4 9M17 7l-4 9" /></>);
export const IDashboard = make(<><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>);
// Repeat arrows (Lucide "repeat") — a habit is the loop itself, distinct from
// ITimer's one-shot stopwatch and ITodo's single checked box.
export const IHabit = make(<><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>);
// A toothed cog (Lucide "settings"), not a spoked circle — the old spoked
// version read as a near-twin of ISun (the theme toggle). A gear has teeth.
export const IGear = make(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>);
export const IPlus = make(<path d="M12 5v14M5 12h14" />);
export const IMinus = make(<path d="M5 12h14" />);
export const IX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const ICheck = make(<path d="M5 12l4 4 10-10" />);
export const IChevronL = make(<path d="M15 6l-6 6 6 6" />);
export const IChevronR = make(<path d="M9 6l6 6-6 6" />);
export const IChevronD = make(<path d="M6 9l6 6 6-6" />);
// A full left arrow (with shaft) — a "back" action, deliberately distinct from
// IChevronL (a bare "<" stepper), which rendered identically before.
export const IBack = make(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const IClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></>);
export const ICalendar = make(<><rect x="3" y="4" width="18" height="17" /><path d="M3 9h18M8 2v4M16 2v4" /></>);
// Flag (pennant) for deadlines — the design's 🏁. A flag, not another clock,
// so a card's "scheduled" (IClock) and "deadline" (this) never look identical.
export const IDeadline = make(<><path d="M5 21V4" /><path d="M5 4h11l-2 3 2 3H6" /></>);
export const INoteLines = make(<path d="M4 6h11M4 12h9M4 18h13" />);
export const IGrab = make(<><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>, true);
export const IEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);
export const ILock = make(<><rect x="4" y="10" width="16" height="11" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>);
export const IUnlock = make(<><rect x="4" y="10" width="16" height="11" /><path d="M8 10V7a4 4 0 0 1 7.7-1.5" /></>);
export const IKebab = make(<><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></>, true);
// Counter-clockwise restart arrow (Lucide rotate-ccw) — the old hand-drawn
// arc ended in a bare L-corner that read as a shapeless hook at button size.
export const IReset = make(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>);
export const IPause = make(<><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></>, true);
export const IPlay = make(<path d="M7 4l13 8-13 8Z" />, true);
export const ITrash = make(<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />);
export const ILink = make(<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />);
export const IFocus = make(<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />);
export const IFolder = make(<path d="M3 7h6l2 2h10v9H3Z" />);
// Document with a visible dog-ear fold — the old subtle corner made it read
// as a plain rounded rect, too close to INotes at small sizes.
export const IFile = make(<><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v4h4" /></>);
export const IFilter = make(<path d="M3 5h18l-7 8v5l-4 2v-7Z" />);
/** Page layout — a sheet split into a header band and stacked sections. Used
    for "change this page's layout" in Notes. */
export const ILayout = make(<><rect x="3" y="4" width="18" height="16" /><path d="M3 9h18M9 9v11" /></>);
export const IAppearance = make(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" /></>);
export const IDatabase = make(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /></>);
export const IInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
// Puzzle piece for Plugins — the old even 2x2 grid was a near-twin of
// IDashboard's bento grid at nav size.
export const IPluginGrid = make(<path d="M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4H4a2 2 0 1 1 0-4h1V6a1 1 0 0 1 1-1h4Z" />);
export const ISun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>);
export const IUpload = make(<path d="M12 16V4M6 10l6-6 6 6M4 20h16" />);
export const IDownload = make(<path d="M12 4v12M6 10l6 6 6-6M4 20h16" />);
// A camera body with a lens — distinct from IScan, which is a barcode
// reticle, because they sit next to each other in the scanner.
export const ICamera = make(<><path d="M3 8a2 2 0 0 1 2-2h2.5l1.2-2h6.6l1.2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><circle cx="12" cy="12.5" r="3.5" /></>);
export const IRepeat = make(<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />);
// An OPEN book with a visible centre gutter — INotes is a closed notebook with
// a single spine line, and at nav size the two are otherwise indistinguishable.
export const IBook = make(<><path d="M12 6.5C10.5 5 8.5 4.5 3 4.5v13c5.5 0 7.5.5 9 2 1.5-1.5 3.5-2 9-2v-13c-5.5 0-7.5.5-9 2Z" /><path d="M12 6.5v15" /></>);
// Scanner reticle: four corner brackets and a scanline.
export const IScan = make(<><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M3 12h18" /></>);
