/* The day notch — an all-day event hung off a date.

   Collapsed it is just the emoji in a small sand-tinted tag, notched upward
   into the date above it. Hovering (or focusing) unfurls it into the full
   name plus its repeat, e.g. "🎂 Priya's birthday · yearly".

   Why the unfurled tag is portalled instead of simply growing in place: the
   month cells, the schedule day headers and the gantt axis all clip their
   overflow, so an in-flow tag would be cut off — worst of all in the last
   column, which is exactly where a Saturday birthday lives. The floating copy
   is drawn at the nub's own coordinates and grows rightward from there, so it
   looks identical to growing in place while being immune to every ancestor's
   overflow.

   The sand tint is deliberately none of the four status colours (pending
   amber / in-progress violet / done green / skipped rose): an event is not a
   state, and must never be read as one. */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "../App";
import { eventAriaLabel, type DayEvent } from "../lib/dayEvents";

/** How many notches fit on one row before the rest roll into "+n". The row
    must never wrap — it would push the day's task chips down. */
const MAX_NOTCHES_PER_DAY = 3;

interface OpenTag {
  event: DayEvent;
  left: number;
  top: number;
}

export function DayNotch({ events, max = MAX_NOTCHES_PER_DAY }: { events: DayEvent[]; max?: number }) {
  const { openTask } = useEditor();
  const [open, setOpen] = useState<OpenTag | null>(null);
  // Closing on scroll rather than repositioning: a tag anchored to a cell that
  // has since scrolled away would otherwise float over unrelated content.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (events.length === 0) return null;
  const shown = events.slice(0, max);
  const hidden = events.length - shown.length;

  function reveal(event: DayEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setOpen({ event, left: rect.left, top: rect.top });
  }

  return (
    <div className="day-notch-row">
      {shown.map((event) => (
        <button
          key={event.task.id}
          type="button"
          className="day-notch"
          aria-label={eventAriaLabel(event)}
          onMouseEnter={(e) => reveal(event, e.currentTarget)}
          onMouseLeave={() => setOpen(null)}
          onFocus={(e) => reveal(event, e.currentTarget)}
          onBlur={() => setOpen(null)}
          onClick={(e) => {
            // Day cells open a "new task here" editor on their own click —
            // a notch click means "edit THIS event".
            e.stopPropagation();
            openTask(event.task.id);
          }}
        >
          <span className="day-notch-emoji" aria-hidden="true">{event.emoji}</span>
        </button>
      ))}
      {hidden > 0 && (
        <span className="day-notch-more" aria-label={`${hidden} more event${hidden === 1 ? "" : "s"}`}>
          +{hidden}
        </span>
      )}
      {open &&
        createPortal(
          <div
            className="day-notch-tag"
            style={{ left: open.left, top: open.top }}
            role="presentation"
          >
            <span className="day-notch-emoji" aria-hidden="true">{open.event.emoji}</span>
            <span className="day-notch-label">{open.event.title}</span>
            {open.event.repeatLabel && (
              <span className="day-notch-meta">{open.event.repeatLabel}</span>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
