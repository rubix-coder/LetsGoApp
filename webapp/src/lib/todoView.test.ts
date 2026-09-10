import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_VIEW, TODO_VIEWS, rememberTodoView, resolveTodoView, todoViewLabel } from "./todoView";

// Node has no localStorage; a Map-backed stand-in is enough for these tests
// (same approach as apiKeys.test.ts).
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("resolveTodoView", () => {
  it("falls back to the kanban board when nothing is set or remembered", () => {
    expect(resolveTodoView(undefined)).toEqual(["board", "kanban"]);
  });

  it("honours a pinned view regardless of what was visited last", () => {
    rememberTodoView(["todo", "calendar"]);
    expect(resolveTodoView("todo/board/gantt")).toEqual(["board", "gantt"]);
  });

  it("returns the last visited view when set to remember", () => {
    rememberTodoView(["todo", "board", "eisenhower"]);
    expect(resolveTodoView(LAST_VIEW)).toEqual(["board", "eisenhower"]);
  });

  it("remembers a non-board view too", () => {
    rememberTodoView(["todo", "schedule"]);
    expect(resolveTodoView(LAST_VIEW)).toEqual(["schedule", "kanban"]);
  });

  it("uses kanban until something has actually been visited", () => {
    expect(resolveTodoView(LAST_VIEW)).toEqual(["board", "kanban"]);
  });

  it("ignores a remembered route that is no longer a real view", () => {
    localStorage.setItem("lg:todoView", "todo/board/burndown");
    expect(resolveTodoView(LAST_VIEW)).toEqual(["board", "kanban"]);
  });

  it("ignores a pinned route that is no longer a real view", () => {
    expect(resolveTodoView("todo/timeline")).toEqual(["board", "kanban"]);
  });
});

describe("rememberTodoView", () => {
  it("stores nothing for a bare /todo route — there is no view to remember", () => {
    rememberTodoView(["todo", "calendar"]);
    rememberTodoView(["todo"]);
    expect(resolveTodoView(LAST_VIEW)).toEqual(["calendar", "kanban"]);
  });

  it("stores nothing for a route outside todo", () => {
    rememberTodoView(["notes", "abc"]);
    expect(localStorage.getItem("lg:todoView")).toBe(null);
  });

  it("normalises a bare board route to its default lens", () => {
    rememberTodoView(["todo", "board"]);
    expect(resolveTodoView(LAST_VIEW)).toEqual(["board", "kanban"]);
  });

  it("survives localStorage throwing, as it does in private-mode Safari", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => rememberTodoView(["todo", "schedule"])).not.toThrow();
    expect(resolveTodoView(LAST_VIEW)).toEqual(["board", "kanban"]);
  });
});

describe("TODO_VIEWS", () => {
  it("offers every switcher destination, with 'last used' first", () => {
    expect(TODO_VIEWS[0].id).toBe(LAST_VIEW);
    expect(TODO_VIEWS.map((v) => v.id)).toContain("todo/board/kanban");
    expect(TODO_VIEWS.map((v) => v.id)).toContain("todo/events");
  });

  it("labels a route for the settings summary", () => {
    expect(todoViewLabel("todo/board/gantt")).toBe("Board · Gantt");
    expect(todoViewLabel(LAST_VIEW)).toBe("Last used view");
  });
});
