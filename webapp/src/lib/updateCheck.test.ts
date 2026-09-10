import { describe, expect, it } from "vitest";
import { entryScriptOf } from "./updateCheck";

describe("entryScriptOf", () => {
  it("finds the hashed module entry in a built index.html", () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-C3xQmVqf.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/index-D2aK9pQr.css">
    </head><body><div id="root"></div></body></html>`;
    expect(entryScriptOf(html)).toBe("/assets/index-C3xQmVqf.js");
  });

  it("tolerates attribute order and a base path", () => {
    const html = `<script src="/letsgo/assets/index-Bv7wq.js" type="module"></script>`;
    expect(entryScriptOf(html)).toBe("/letsgo/assets/index-Bv7wq.js");
  });

  it("returns null for the dev server's unhashed entry", () => {
    const html = `<script type="module" src="/src/main.tsx"></script>`;
    expect(entryScriptOf(html)).toBeNull();
  });

  it("returns null for html with no module script at all", () => {
    expect(entryScriptOf("<html><body>hi</body></html>")).toBeNull();
  });

  it("two different builds compare as different", () => {
    const a = entryScriptOf(`<script type="module" src="/assets/index-AAA1.js"></script>`);
    const b = entryScriptOf(`<script type="module" src="/assets/index-BBB2.js"></script>`);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });
});
