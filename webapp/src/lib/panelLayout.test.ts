// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_PANEL_H,
  defaultLayout,
  dropSide,
  isDefaultLayout,
  movePanel,
  resizePanel,
  resolveLayout,
  spanFromDrag,
  type PanelDef,
  type PanelSpan,
} from "./panelLayout";

const DEFS: PanelDef[] = [
  { id: "done", title: "Completed", w: 1, h: 1 },
  { id: "tracked", title: "Tracked", w: 1, h: 1 },
  { id: "donut", title: "Status", w: 1, h: 2, minW: 1, minH: 2 },
  { id: "upnext", title: "Up next", w: 3, h: 2, minW: 2 },
];

const ids = (layout: readonly PanelSpan[]) => layout.map((p) => p.id);

describe("defaultLayout", () => {
  it("is the declared order and footprints", () => {
    expect(defaultLayout(DEFS, 3)).toEqual([
      { id: "done", w: 1, h: 1 },
      { id: "tracked", w: 1, h: 1 },
      { id: "donut", w: 1, h: 2 },
      { id: "upnext", w: 3, h: 2 },
    ]);
  });

  it("narrows a wide panel to fit a narrower grid", () => {
    expect(defaultLayout(DEFS, 2).find((p) => p.id === "upnext")).toEqual({ id: "upnext", w: 2, h: 2 });
    expect(defaultLayout(DEFS, 1).find((p) => p.id === "upnext")).toEqual({ id: "upnext", w: 1, h: 2 });
  });
});

describe("resolveLayout", () => {
  it("is the default when nothing is saved", () => {
    expect(resolveLayout(DEFS, undefined, 3)).toEqual(defaultLayout(DEFS, 3));
  });

  it("keeps the saved order and footprints", () => {
    const saved: PanelSpan[] = [
      { id: "upnext", w: 2, h: 3 },
      { id: "donut", w: 1, h: 2 },
      { id: "done", w: 1, h: 1 },
      { id: "tracked", w: 1, h: 1 },
    ];
    expect(resolveLayout(DEFS, saved, 3)).toEqual(saved);
  });

  it("drops panels that no longer exist", () => {
    // A dashboard card disappears with its plugin; an Events section
    // disappears when its last event does.
    const saved: PanelSpan[] = [{ id: "reading", w: 2, h: 2 }, { id: "done", w: 1, h: 1 }];
    expect(ids(resolveLayout(DEFS, saved, 3))).toEqual(["done", "tracked", "donut", "upnext"]);
  });

  it("appends panels the saved layout never heard of, so nothing goes invisible", () => {
    const saved: PanelSpan[] = [{ id: "upnext", w: 3, h: 2 }];
    const resolved = resolveLayout(DEFS, saved, 3);
    expect(ids(resolved)).toEqual(["upnext", "done", "tracked", "donut"]);
    expect(resolved[1]).toEqual({ id: "done", w: 1, h: 1 });
  });

  it("ignores a duplicated id rather than rendering the panel twice", () => {
    const saved: PanelSpan[] = [{ id: "done", w: 1, h: 1 }, { id: "done", w: 2, h: 2 }];
    expect(ids(resolveLayout(DEFS, saved, 3))).toEqual(["done", "tracked", "donut", "upnext"]);
  });

  it("clamps a layout saved on a wider screen", () => {
    const saved: PanelSpan[] = [{ id: "upnext", w: 3, h: 2 }];
    expect(resolveLayout(DEFS, saved, 2)[0]).toEqual({ id: "upnext", w: 2, h: 2 });
  });

  it("honours each panel's own minimum", () => {
    const saved: PanelSpan[] = [{ id: "donut", w: 1, h: 1 }, { id: "upnext", w: 1, h: 2 }];
    const resolved = resolveLayout(DEFS, saved, 3);
    expect(resolved[0]).toEqual({ id: "donut", w: 1, h: 2 }); // minH 2
    expect(resolved[1]).toEqual({ id: "upnext", w: 2, h: 2 }); // minW 2
  });

  it("caps runaway heights and repairs junk", () => {
    const saved: PanelSpan[] = [{ id: "done", w: 99, h: 99 }, { id: "tracked", w: NaN, h: 0 }];
    const resolved = resolveLayout(DEFS, saved, 3);
    expect(resolved[0]).toEqual({ id: "done", w: 3, h: MAX_PANEL_H });
    expect(resolved[1]).toEqual({ id: "tracked", w: 1, h: 1 }); // falls back to the def
  });

  it("survives a zero column count", () => {
    expect(resolveLayout(DEFS, undefined, 0).every((p) => p.w === 1)).toBe(true);
  });
});

describe("movePanel", () => {
  const layout = defaultLayout(DEFS, 3);

  it("drops a panel before a target", () => {
    expect(ids(movePanel(layout, "upnext", "done", "before"))).toEqual(["upnext", "done", "tracked", "donut"]);
  });

  it("drops a panel after a target", () => {
    expect(ids(movePanel(layout, "done", "donut", "after"))).toEqual(["tracked", "donut", "done", "upnext"]);
  });

  it("lands where asked when moving forward past the target", () => {
    // The target's index shifts once the dragged panel is lifted out; getting
    // this wrong puts the panel one slot off, which reads as "drag is broken".
    expect(ids(movePanel(layout, "done", "tracked", "after"))).toEqual(["tracked", "done", "donut", "upnext"]);
    expect(ids(movePanel(layout, "done", "upnext", "before"))).toEqual(["tracked", "donut", "done", "upnext"]);
  });

  it("leaves the layout alone on a self-drop or an unknown target", () => {
    expect(ids(movePanel(layout, "done", "done", "before"))).toEqual(ids(layout));
    expect(ids(movePanel(layout, "done", "ghost", "after"))).toEqual(ids(layout));
    expect(ids(movePanel(layout, "ghost", "done", "after"))).toEqual(ids(layout));
  });

  it("keeps footprints through a move", () => {
    const moved = movePanel(layout, "upnext", "done", "before");
    expect(moved[0]).toEqual({ id: "upnext", w: 3, h: 2 });
  });
});

describe("resizePanel", () => {
  const layout = defaultLayout(DEFS, 3);

  it("sets a new footprint", () => {
    expect(resizePanel(layout, DEFS, "done", 2, 3, 3)[0]).toEqual({ id: "done", w: 2, h: 3 });
  });

  it("clamps to the grid, the cap and the panel's own minimum", () => {
    expect(resizePanel(layout, DEFS, "done", 9, 9, 3)[0]).toEqual({ id: "done", w: 3, h: MAX_PANEL_H });
    expect(resizePanel(layout, DEFS, "donut", 1, 1, 3)[2]).toEqual({ id: "donut", w: 1, h: 2 });
    expect(resizePanel(layout, DEFS, "upnext", 1, 1, 3)[3]).toEqual({ id: "upnext", w: 2, h: 1 });
  });

  it("touches nothing else", () => {
    const resized = resizePanel(layout, DEFS, "done", 3, 2, 3);
    expect(resized.slice(1)).toEqual(layout.slice(1));
  });

  it("ignores an unknown panel", () => {
    expect(resizePanel(layout, DEFS, "ghost", 2, 2, 3)).toEqual(layout);
  });
});

describe("isDefaultLayout", () => {
  it("is true for the untouched layout", () => {
    expect(isDefaultLayout(defaultLayout(DEFS, 3), DEFS, 3)).toBe(true);
  });

  it("is false once anything moved or resized", () => {
    expect(isDefaultLayout(movePanel(defaultLayout(DEFS, 3), "done", "donut", "after"), DEFS, 3)).toBe(false);
    expect(isDefaultLayout(resizePanel(defaultLayout(DEFS, 3), DEFS, "done", 2, 1, 3), DEFS, 3)).toBe(false);
  });
});

describe("dropSide", () => {
  it("splits on the target's horizontal midpoint", () => {
    const rect = { left: 100, width: 200 };
    expect(dropSide(140, rect)).toBe("before");
    expect(dropSide(260, rect)).toBe("after");
    expect(dropSide(200, rect)).toBe("after"); // exactly the middle
  });
});

describe("spanFromDrag", () => {
  const cell = { width: 200, height: 120 };

  it("grows a cell at a time", () => {
    expect(spanFromDrag({ w: 1, h: 1 }, 200, 0, cell)).toEqual({ w: 2, h: 1 });
    expect(spanFromDrag({ w: 1, h: 1 }, 0, 240, cell)).toEqual({ w: 1, h: 3 });
  });

  it("snaps at the halfway point rather than on the first pixel", () => {
    expect(spanFromDrag({ w: 1, h: 1 }, 80, 0, cell)).toEqual({ w: 1, h: 1 });
    expect(spanFromDrag({ w: 1, h: 1 }, 120, 0, cell)).toEqual({ w: 2, h: 1 });
  });

  it("shrinks on a backwards drag", () => {
    expect(spanFromDrag({ w: 3, h: 3 }, -200, -120, cell)).toEqual({ w: 2, h: 2 });
  });

  it("survives a grid that has not been measured yet", () => {
    expect(spanFromDrag({ w: 2, h: 2 }, 500, 500, { width: 0, height: 0 })).toEqual({ w: 2, h: 2 });
  });
});
