/* Side-by-side placement for one day column of the Schedule view.

   Cards that overlap in time have to share the column's width, and the only
   question is how many ways to split it. The answer must be local: a card is
   narrowed by the cards it ACTUALLY collides with and by nothing else.

   The earlier version counted lanes once per day and applied that count to
   every card in it, so a single overlapping pair — two routines bumping into
   each other at 21:00 — cut every card in that column in half from 06:00
   onwards, most of them sitting beside an empty half-column.

   So: partition the day into CLUSTERS of transitively overlapping cards, and
   size each cluster on its own. A cluster ends the moment a card starts at or
   after every earlier card has finished, because nothing later can then reach
   back across that boundary. Touching is not overlapping — a 10:00 card
   follows a 09:00–10:00 card at full width. */

export interface Span {
  /** Epoch ms. */
  start: number;
  /** Epoch ms, exclusive. */
  end: number;
}

export interface Lane {
  /** Zero-based column within this card's cluster. */
  lane: number;
  /** Columns in that cluster — the denominator for the card's width. */
  lanes: number;
}

export function assignLanes<T extends Span>(items: readonly T[]): (T & Lane)[] {
  // Ties broken by the longer card first, so a long span takes lane 0 and the
  // short ones stack to its right — the conventional calendar reading.
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);

  const out: (T & Lane)[] = [];
  let cluster: (T & Lane)[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  /** Freeze the finished cluster: every card in it shares its column count. */
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const item of cluster) out.push({ ...item, lanes });
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    // Starts after everything so far has ended: nothing can overlap backwards
    // past this point, so the previous cluster is complete.
    if (cluster.length && item.start >= clusterEnd) flush();

    // First lane free at this card's start, else a new one.
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }

    cluster.push({ ...item, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();

  return out;
}
