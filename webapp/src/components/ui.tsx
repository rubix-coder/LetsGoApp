import { useState, type CSSProperties, type ReactNode } from "react";
import { STATUS_VAR, type Priority, type TaskStatus } from "../lib/types";
import { IChevronD, IChevronR } from "./Icons";

/** The Industry signature: registration marks on a hairline frame. */
export function Corners() {
  return (
    <>
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />
    </>
  );
}

export function BP({ className = "", style, children, ...rest }: { className?: string; style?: CSSProperties; children?: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`blueprint ${className}`} style={style} {...rest}>
      <Corners />
      {children}
    </div>
  );
}

export function Wordmark({ size = 20, tone = "default", onClick, title }: {
  size?: number;
  /** Sync-health tint on the badge: green syncing / amber needs-reconnect /
      red error. Default keeps the brand gradient. */
  tone?: "default" | "syncing" | "attention" | "error";
  /** When set, the lockup renders as a button (used as the app's sync control). */
  onClick?: () => void;
  title?: string;
}) {
  // The mock's brand lockup: gradient ▸▸ badge + name. Badge scales with size.
  const badge = Math.round(size * 1.4);
  const style: CSSProperties = { fontSize: size, display: "inline-flex", alignItems: "center", gap: Math.max(6, Math.round(size * 0.45)) };
  const inner = (
    <>
      <span
        className="logoBadge"
        data-tone={tone === "default" ? undefined : tone}
        style={{ width: badge, height: badge, fontSize: Math.round(badge * 0.4) }}
        aria-hidden
      >
        &#9656;&#9656;
      </span>
      LET&rsquo;S GO
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="wm wm-btn" style={style} onClick={onClick} title={title} aria-label={title}>
        {inner}
      </button>
    );
  }
  return <span className="wm" style={style}>{inner}</span>;
}

export function Seg({ items, active, onSelect, small, ink, ariaLabel }: {
  items: { id: string; label: ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
  small?: boolean;
  /** Mock's view-filter look: bare pills with a solid-ink active pill. */
  ink?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className={`seg ${small ? "seg-sm" : ""} ${ink ? "seg-ink" : ""}`} role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={it.id === active}
          className={`seg-opt ${it.id === active ? "active" : ""}`}
          onClick={() => onSelect(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

export function Prio({ p }: { p: Priority }) {
  return <span className={`prio p${p}`}>P{p}</span>;
}

export function StatusSq({ status, size = 9, pulse = false }: { status: TaskStatus; size?: number; pulse?: boolean }) {
  const color = STATUS_VAR[status];
  if (status === "paused") {
    // A held task never breathes — `pulse` is deliberately ignored.
    return <span className="stsq paused" style={{ width: size, height: size }} />;
  }
  if (status === "skipped") {
    return (
      <span
        className="stsq"
        style={{
          width: size, height: size,
          border: `1.5px solid ${color}`,
          background: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px 3px)`,
        }}
      />
    );
  }
  return <span className={`stsq${pulse ? " pulse" : ""}`} style={{ width: size, height: size, background: color }} />;
}

/** Quarter-cell progress strip from the kanban card mock. */
export function QuarterBar({ frac }: { frac: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, frac)) * 4);
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < filled ? "var(--accent-gradient-h)" : "var(--color-divider)" }} />
      ))}
    </div>
  );
}

/** A titled section that folds away, for a form long enough that its own
    action buttons fall off the bottom of the dialog.

    The `summary` is the point: a collapsed section that only says "Emoji" makes
    you open it to find out whether you set one, which is worse than the long
    form it replaced. Closed sections state their value on the header line, so
    the folded form is still a complete read of the thing being edited. */
export function Collapse({ title, summary, defaultOpen = false, children }: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 11px", background: "none", border: "none", cursor: "pointer",
          font: "inherit", color: "var(--color-text)", textAlign: "left",
        }}
      >
        <span style={{ color: "var(--color-text-3)", display: "flex" }}>
          {open ? <IChevronD size={14} /> : <IChevronR size={14} />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>
        {/* Hidden while open: the section itself is then saying it, louder. */}
        {!open && summary !== undefined && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--color-text-2)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {summary}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0 11px 11px" }}>{children}</div>}
    </div>
  );
}

export function Modal({ onClose, width = 640, children }: { onClose: () => void; width?: number; children: ReactNode }) {
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal
    >
      <BP style={{ width, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", background: "var(--color-bg)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        {children}
      </BP>
    </div>
  );
}
