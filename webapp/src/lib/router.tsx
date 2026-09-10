import { useEffect, useState } from "react";

function parse(): string[] {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export function nav(path: string): void {
  window.location.hash = path.startsWith("/") ? `#${path}` : `#/${path}`;
}

/** Hash router: "#/todo/board/kanban" → ["todo", "board", "kanban"]. */
export function useRoute(): string[] {
  const [route, setRoute] = useState<string[]>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** True below the desktop breakpoint (mobile shell: bottom tabs + FAB). */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 800px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 800px)");
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

/** Ticks every `ms` — drives the timer readouts and the schedule now-line. */
export function useNow(ms: number): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return t;
}
