/* Device-local record of the last book-lookup auth/quota failure.

   The shelf is the wrong place to explain a key problem — there the answer
   is always just "add the book by hand". The place it IS fixable is
   Settings → Library, so the failure is flagged there and cleared the moment
   a key is saved or a resolve run completes without auth trouble. Kept in
   localStorage beside the keys themselves (lib/apiKeys.ts), never the vault. */

const KEY = "lg:bookApiIssue";

export function bookApiIssue(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setBookApiIssue(reason: string): void {
  try {
    localStorage.setItem(KEY, reason);
  } catch {
    /* private-mode Safari — the flag just doesn't persist */
  }
}

export function clearBookApiIssue(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/* The last resolve run, in full — what filled, what is genuinely absent,
   what errored and WHY. The shelf keeps its one-liner; anyone asking "what
   actually failed?" finds the answer in Settings → Library. */

export interface ResolveReport {
  at: number;
  filled: number;
  /** Both databases answered and neither has the book — not an error. */
  notFound: number;
  /** Lookups that failed to complete (network, timeouts, quota, …). */
  unavailable: number;
  /** Distinct failure reasons from this run, capped small. */
  reasons: string[];
  auth: boolean;
  /** Of `filled`, how many the Claude web-search rescue found (absent on
      reports recorded before the rescue existed). */
  webFilled?: number;
}

const REPORT_KEY = "lg:bookResolveReport";

export function recordResolveReport(report: ResolveReport): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch {
    /* the report just doesn't persist */
  }
}

export function lastResolveReport(): ResolveReport | null {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as ResolveReport;
    if (typeof r?.at !== "number") return null;
    return { ...r, reasons: Array.isArray(r.reasons) ? r.reasons.filter((x) => typeof x === "string") : [] };
  } catch {
    return null;
  }
}
